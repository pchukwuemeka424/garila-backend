import {
	citeYear,
	formatApa7Reference,
	formatParentheticalCite,
	isNumberedCitationStyle,
	paperCiteKey,
	paperFamilyNames,
	paperIsCitable,
	parseCitationStyleLabel,
	cleanReferenceTitle,
} from "../lib/citation-bank.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";
import type { RetrievalProtocol } from "./alphaxiv.service.js";
import { sanitizeReviewMethodology } from "./review-methods-sanitize.service.js";

const REFERENCES_HEADING = /^(?:#{1,6}\s+|\*\*)References(?:\*\*)?\s*$/im;
const AUTHOR_YEAR_CITE =
	/\(([^()]*?\b(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*[^()]*?\b(?:19|20)\d{2}[a-z]?)*[^()]*)\)/g;
const NUMBERED_CITE = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;

function splitBodyAndReferences(content: string): { body: string; heading: string; refs: string } {
	const match = content.match(REFERENCES_HEADING);
	if (!match || match.index === undefined) {
		return { body: content, heading: "**References**", refs: "" };
	}
	return {
		body: content.slice(0, match.index).trimEnd(),
		heading: match[0]!.trim(),
		refs: content.slice(match.index + match[0].length),
	};
}

function lastNameFromCiteToken(token: string): string | null {
	const cleaned = token.replace(/\bet al\.?/gi, "").replace(/[&]/g, " ").trim();
	const first = cleaned.split(/[,;]/)[0]?.trim() ?? "";
	const parts = first.split(/\s+/).filter(Boolean);
	if (parts.length === 0) return null;
	const last = parts[parts.length - 1]!.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, "");
	if (last.length <= 2) {
		if (parts.length < 2) return null;
		const family = parts[0]!.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, "");
		return family.length > 2 ? family : null;
	}
	return last;
}

function yearFromCiteToken(token: string): string | null {
	const match = token.match(/\b((?:19|20)\d{2})[a-z]?\b/);
	return match?.[1] ?? null;
}

function titleTokens(title: string): string[] {
	return cleanReferenceTitle(title)
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token.length >= 4);
}

function paperMatchesAuthorYear(paper: AlphaXivPaper, author: string, year: string): boolean {
	const names = paperFamilyNames(paper.authors).map((name) => name.toLowerCase());
	const paperYearValue = citeYear(paper);
	if (paperYearValue !== year) return false;
	const needle = author.toLowerCase();
	if (needle.length <= 2) return false;
	return names.some(
		(name) => name === needle || name.startsWith(needle) || needle.startsWith(name),
	);
}

function paperMatchesCite(paper: AlphaXivPaper, author: string, year: string, inner: string): boolean {
	if (paperMatchesAuthorYear(paper, author, year)) return true;
	if (citeYear(paper) !== year) return false;
	const innerTokens = titleTokens(inner);
	if (innerTokens.length === 0) return false;
	const paperTokens = new Set(titleTokens(paper.title));
	return innerTokens.some((token) => paperTokens.has(token));
}

function rebuildReferences(papers: AlphaXivPaper[], numbered: boolean): string {
	const complete = papers.filter(paperIsCitable);
	const sorted = [...complete].sort((a, b) => {
		const familyA = (paperFamilyNames(a.authors)[0] ?? "").toLowerCase();
		const familyB = (paperFamilyNames(b.authors)[0] ?? "").toLowerCase();
		if (familyA !== familyB) return familyA.localeCompare(familyB);
		return citeYear(a).localeCompare(citeYear(b));
	});
	return sorted
		.map((paper, index) => {
			const entry = formatApa7Reference(paper);
			if (!numbered) return entry;
			return `[${index + 1}] ${entry}`;
		})
		.join("\n\n");
}

function collectCitedPapersFromBody(
	body: string,
	papers: AlphaXivPaper[],
	numbered: boolean,
): { body: string; cited: AlphaXivPaper[] } {
	const cited: AlphaXivPaper[] = [];
	const seen = new Set<string>();

	const addPaper = (paper: AlphaXivPaper | undefined) => {
		if (!paper) return;
		const key = paperCiteKey(paper);
		if (seen.has(key)) return;
		seen.add(key);
		cited.push(paper);
	};

	let nextBody = body;

	if (numbered) {
		nextBody = nextBody.replace(NUMBERED_CITE, (_full, inner: string) => {
			const indexes = String(inner)
				.split(/[,–-]/)
				.map((part) => Number.parseInt(part.trim(), 10))
				.filter((n) => Number.isFinite(n));
			const kept: number[] = [];
			for (const n of indexes) {
				const paper = papers[n - 1];
				if (!paper || !paperIsCitable(paper)) continue;
				addPaper(paper);
				kept.push(n);
			}
			if (kept.length === 0) return "";
			return `[${kept.join(", ")}]`;
		});
		return { body: nextBody.replace(/[ \t]{2,}/g, " "), cited };
	}

	const findDatedPaperByAuthor = (author: string): AlphaXivPaper | undefined => {
		const needle = author.toLowerCase();
		if (needle.length <= 2) return undefined;
		return papers.find((candidate) => {
			if (!paperIsCitable(candidate)) return false;
			return paperFamilyNames(candidate.authors).some((name) => {
				const family = name.toLowerCase();
				return family === needle || family.startsWith(needle) || needle.startsWith(family);
			});
		});
	};

	nextBody = nextBody.replace(/\(([^()]*?\bn\.d\.[^()]*)\)/gi, (_full, inner: string) => {
		const author = lastNameFromCiteToken(String(inner).replace(/\bn\.d\./gi, ""));
		if (!author) return "";
		const paper = findDatedPaperByAuthor(author);
		if (!paper) return "";
		addPaper(paper);
		return formatParentheticalCite(paper, papers.indexOf(paper), false);
	});

	nextBody = nextBody.replace(AUTHOR_YEAR_CITE, (_full, inner: string) => {
		const parts = String(inner)
			.split(/\s*;\s*/)
			.map((part) => part.replace(/^\(+/, "").replace(/\)+$/, "").trim())
			.filter(Boolean);
		const kept: string[] = [];
		for (const part of parts) {
			const year = yearFromCiteToken(part);
			const author = lastNameFromCiteToken(part.replace(/\b(?:19|20)\d{2}[a-z]?\b/g, ""));
			if (!year || !author) continue;
			const paper =
				papers.find((candidate) => paperMatchesCite(candidate, author, year, part) && paperIsCitable(candidate)) ??
				findDatedPaperByAuthor(author);
			if (!paper) continue;
			addPaper(paper);
			const canonical = formatParentheticalCite(paper, papers.indexOf(paper), false).replace(
				/^\(|\)$/g,
				"",
			);
			kept.push(canonical);
		}
		if (kept.length === 0) return "";
		return `(${kept.join("; ")})`;
	});

	return {
		body: nextBody.replace(/[ \t]{2,}/g, " ").replace(/ +\./g, ".").replace(/\(\s*\(/g, "(").replace(/\)\s*\)/g, ")"),
		cited,
	};
}

const FACTCHECK_ASIDE =
	/\s*—\s*(?:this point is not clearly supported by the cited abstract and is therefore stated cautiously|the previously cited source is from a different scholarly field and is not treated as evidence for this claim)\.?/gi;

function stripFactCheckAsides(text: string): string {
	return text.replace(FACTCHECK_ASIDE, "").replace(/[ \t]{2,}/g, " ");
}

export async function alignCitationsAndFactCheck(
	content: string,
	papers: AlphaXivPaper[],
	userPrompt: string,
	options?: {
		signal?: AbortSignal;
		protocol?: RetrievalProtocol;
		topic?: string | null;
	},
): Promise<string> {
	if (!content.trim() || papers.length === 0) return content;

	const styleLabel = parseCitationStyleLabel(userPrompt);
	const numbered = isNumberedCitationStyle(styleLabel);
	const sanitized = stripFactCheckAsides(
		sanitizeReviewMethodology(content, papers, {
			protocol: options?.protocol,
			topic: options?.topic ?? userPrompt,
		}),
	);
	const { body, heading } = splitBodyAndReferences(sanitized);
	const citable = papers.filter(paperIsCitable);
	const bank = citable.length > 0 ? citable : papers;
	const aligned = collectCitedPapersFromBody(body, bank, numbered);
	const cited =
		aligned.cited.filter(paperIsCitable).length > 0
			? aligned.cited.filter(paperIsCitable)
			: bank.slice(0, Math.min(bank.length, 12));

	const referenceBlock = `${heading}\n\n${rebuildReferences(cited, numbered)}`;
	return `${stripFactCheckAsides(aligned.body).trim()}\n\n${referenceBlock}`.trim();
}
