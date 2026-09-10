import {
	citeYear,
	formatNarrativeCite,
	formatParentheticalCite,
	formatReferenceEntryByStyle,
	isNumberedCitationStyle,
	paperCiteKey,
	paperFamilyNames,
	paperIsCitable,
	parseCitationStyleLabel,
	cleanReferenceTitle,
} from "../lib/citation-bank.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";
import type { RetrievalProtocol } from "./alphaxiv.service.js";
import { factCheckCitedClaims, type CitedClaim } from "./huggingface.service.js";
import { sanitizeReviewMethodology } from "./review-methods-sanitize.service.js";

const REFERENCES_HEADING = /^(?:#{1,6}\s+|\*\*)References(?:\*\*)?\s*$/im;
const AUTHOR_YEAR_CITE =
	/\(([^()]*[A-Za-zÀ-ÖØ-öø-ÿ][^()]*?\b(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*[^()]*?\b(?:19|20)\d{2}[a-z]?)*[^()]*)\)/g;
const NUMBERED_CITE = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;
/** Narrative Author (Year) / Author et al. (Year) / Author and Author (Year). */
const NARRATIVE_CITE =
	/\b([A-ZÀ-Ö][A-Za-zÀ-ÖØ-öø-ÿ'-]+(?:\s+et\s+al\.?|\s+and\s+[A-ZÀ-Ö][A-Za-zÀ-ÖØ-öø-ÿ'-]+)?)\s*\(\s*((?:19|20)\d{2})[a-z]?\s*\)/g;
const CLAIM_NLI_CAP = 16;

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
	if (last.length <= 1) {
		if (parts.length < 2) return null;
		const family = parts[0]!.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'-]/g, "");
		return family.length > 1 ? family : null;
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
	if (needle.length < 2) return false;
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

function findPaperByAuthorYear(
	papers: AlphaXivPaper[],
	author: string,
	year: string,
	inner = "",
): AlphaXivPaper | undefined {
	return papers.find(
		(candidate) => paperMatchesCite(candidate, author, year, inner) && paperIsCitable(candidate),
	);
}

function rebuildReferences(
	papers: AlphaXivPaper[],
	styleLabel: string,
	bank: AlphaXivPaper[] = [],
): string {
	const complete = papers.filter(paperIsCitable);
	const numbered = isNumberedCitationStyle(styleLabel);
	const sorted = [...complete];
	if (!numbered) {
		sorted.sort((a, b) => {
			const familyA = (paperFamilyNames(a.authors)[0] ?? "").toLowerCase();
			const familyB = (paperFamilyNames(b.authors)[0] ?? "").toLowerCase();
			if (familyA !== familyB) return familyA.localeCompare(familyB);
			return citeYear(a).localeCompare(citeYear(b));
		});
	} else if (bank.length > 0) {
		sorted.sort((a, b) => bank.indexOf(a) - bank.indexOf(b));
	}
	return sorted
		.map((paper, index) => {
			const itemIndex = numbered && bank.length > 0 ? bank.indexOf(paper) : index;
			return formatReferenceEntryByStyle(paper, styleLabel, itemIndex);
		})
		.join("\n\n");
}

const EDUCATION_FIELD =
	/\b(?:educat|pedagog|curricul|classroom|lectur|undergrad|universit|tertiary|school(?:ing)?|student|teacher|faculty|learning|teaching)\w*/i;
const FINANCE_FIELD =
	/\b(?:financ(?:e|ial)?|fintech|banking|bank(?:s)?|credit|loan|remittance|digital inclusion|financial inclusion|microfinanc)\w*/i;
const CLINICAL_FIELD =
	/\b(?:clinic(?:al)?|hospital|patient|therap(?:y|eutic)|diagnos|biomedic|pharmaceut|nurs(?:e|ing))\w*/i;

function paperFieldBlob(paper: AlphaXivPaper): string {
	return `${paper.title ?? ""} ${paper.abstract ?? ""}`;
}

/** Decorative cite: claim is about education (etc.) but the paper is clearly another domain. */
function isOffTopicCiteForClaim(
	paper: AlphaXivPaper,
	claim: string,
	topic?: string | null,
): boolean {
	const claimBlob = `${claim} ${topic ?? ""}`;
	const paperBlob = paperFieldBlob(paper);
	if (!paperBlob.trim()) return false;

	const claimEdu = EDUCATION_FIELD.test(claimBlob);
	const paperEdu = EDUCATION_FIELD.test(paperBlob);
	const paperFin = FINANCE_FIELD.test(paperBlob);
	const paperClin = CLINICAL_FIELD.test(paperBlob);

	// Education/HE claim citing a finance- or clinical-only paper.
	if (claimEdu && !paperEdu && (paperFin || paperClin)) return true;
	return false;
}

/**
 * Drop parenthetical cites whose bank abstract is clearly off-field for the sentence
 * (e.g. finance paper used to support education ethics).
 */
function stripOffTopicParentheticals(
	body: string,
	papers: AlphaXivPaper[],
	topic?: string | null,
): string {
	const citeRe =
		/\(([^()]*[A-Za-zÀ-ÖØ-öø-ÿ][^()]*?\b(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*[^()]*?\b(?:19|20)\d{2}[a-z]?)*[^()]*)\)/g;

	return splitSentences(body)
		.map((sentence) => {
			const next = sentence.replace(citeRe, (_full, inner: string) => {
				const parts = String(inner)
					.split(/\s*;\s*/)
					.map((part) => part.trim())
					.filter(Boolean);
				const kept: string[] = [];
				for (const part of parts) {
					const year = yearFromCiteToken(part);
					const author = lastNameFromCiteToken(part.replace(/\b(?:19|20)\d{2}[a-z]?\b/g, ""));
					if (!year || !author) {
						kept.push(part);
						continue;
					}
					const paper = findPaperByAuthorYear(papers, author, year, part);
					if (paper && isOffTopicCiteForClaim(paper, sentence, topic)) {
						continue; // drop decorative off-field cite
					}
					kept.push(part);
				}
				if (kept.length === 0) return "";
				return `(${kept.join("; ")})`;
			});
			return next.replace(/[ \t]{2,}/g, " ").replace(/ +\./g, ".").trim();
		})
		.join(" ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function narrativeBlobToParenthetical(authorBlob: string, year: string): string {
	const blob = authorBlob.replace(/\s+/g, " ").trim();
	if (/\bet\s+al\.?\b/i.test(blob)) {
		const lead = blob.replace(/\s+et\s+al\.?/i, "").trim();
		const family = lastNameFromCiteToken(lead) ?? lead;
		return `(${family} et al., ${year})`;
	}
	if (/\s+and\s+/i.test(blob)) {
		const parts = blob.split(/\s+and\s+/i).map((p) => lastNameFromCiteToken(p.trim()) ?? p.trim());
		if (parts.length === 2 && parts[0] && parts[1]) {
			return `(${parts[0]} & ${parts[1]}, ${year})`;
		}
	}
	const family = lastNameFromCiteToken(blob) ?? blob;
	return `(${family}, ${year})`;
}

function collectCitedPapersFromBody(
	body: string,
	papers: AlphaXivPaper[],
	numbered: boolean,
	options?: { preferParenthetical?: boolean; styleLabel?: string },
): { body: string; cited: AlphaXivPaper[] } {
	const cited: AlphaXivPaper[] = [];
	const seen = new Set<string>();
	const preferParenthetical = Boolean(options?.preferParenthetical);
	const styleLabel = options?.styleLabel ?? (numbered ? "IEEE" : "APA 7th edition");

	const addPaper = (paper: AlphaXivPaper | undefined) => {
		if (!paper) return;
		const key = paperCiteKey(paper);
		if (seen.has(key)) return;
		seen.add(key);
		cited.push(paper);
	};

	let nextBody = body;

	const findDatedPaperByAuthor = (author: string): AlphaXivPaper | undefined => {
		const needle = author.toLowerCase();
		if (needle.length < 2) return undefined;
		return papers.find((candidate) => {
			if (!paperIsCitable(candidate)) return false;
			return paperFamilyNames(candidate.authors).some((name) => {
				const family = name.toLowerCase();
				return family === needle || family.startsWith(needle) || needle.startsWith(family);
			});
		});
	};

	if (numbered) {
		nextBody = nextBody.replace(NUMBERED_CITE, (full, inner: string) => {
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
			if (kept.length === 0) return full; // keep original numbered cite
			return `[${kept.join(", ")}]`;
		});

		// Also convert accidental author-year cites (Smith, 2021) or narrative Smith (2021) to [n]
		nextBody = nextBody.replace(NARRATIVE_CITE, (full, authorBlob: string, year: string) => {
			const author = lastNameFromCiteToken(String(authorBlob));
			if (!author) return full;
			const paper = findPaperByAuthorYear(papers, author, year, String(authorBlob));
			if (!paper) return full;
			addPaper(paper);
			const idx = papers.indexOf(paper);
			return `[${idx + 1}]`;
		});

		nextBody = nextBody.replace(AUTHOR_YEAR_CITE, (full, inner: string) => {
			const parts = String(inner)
				.split(/\s*;\s*/)
				.map((part) => part.replace(/^\(+/, "").replace(/\)+$/, "").trim())
				.filter(Boolean);
			const keptIdxs: number[] = [];
			for (const part of parts) {
				const year = yearFromCiteToken(part);
				const author = lastNameFromCiteToken(part.replace(/\b(?:19|20)\d{2}[a-z]?\b/g, ""));
				if (!year || !author) continue;
				const paper = findPaperByAuthorYear(papers, author, year, part);
				if (!paper) {
					const byAuthor = findDatedPaperByAuthor(author);
					if (byAuthor) {
						addPaper(byAuthor);
						keptIdxs.push(papers.indexOf(byAuthor) + 1);
					}
					continue;
				}
				addPaper(paper);
				keptIdxs.push(papers.indexOf(paper) + 1);
			}
			if (keptIdxs.length === 0) return full;
			return `[${keptIdxs.join(", ")}]`;
		});

		return { body: nextBody.replace(/[ \t]{2,}/g, " "), cited };
	}

	// n.d. → remap to a dated bank paper by author (year unknown).
	nextBody = nextBody.replace(/\(([^()]*?\bn\.d\.[^()]*)\)/gi, (full, inner: string) => {
		const author = lastNameFromCiteToken(String(inner).replace(/\bn\.d\./gi, ""));
		if (!author) return full;
		const paper = findDatedPaperByAuthor(author);
		if (!paper) return full;
		addPaper(paper);
		return formatParentheticalCite(paper, papers.indexOf(paper), styleLabel);
	});

	// Narrative Author (Year) — for assignments convert to (Author, Year) brackets.
	nextBody = nextBody.replace(NARRATIVE_CITE, (full, authorBlob: string, year: string) => {
		const author = lastNameFromCiteToken(String(authorBlob));
		if (!author) return full;
		const paper = findPaperByAuthorYear(papers, author, year, String(authorBlob));
		if (!paper) {
			return preferParenthetical ? narrativeBlobToParenthetical(String(authorBlob), year) : full;
		}
		addPaper(paper);
		if (preferParenthetical) {
			return formatParentheticalCite(paper, papers.indexOf(paper), styleLabel);
		}
		return formatNarrativeCite(paper, papers.indexOf(paper), styleLabel);
	});

	// Parenthetical (Author, Year) — year must match; no author-only wrong-year remap.
	nextBody = nextBody.replace(AUTHOR_YEAR_CITE, (full, inner: string) => {
		const parts = String(inner)
			.split(/\s*;\s*/)
			.map((part) => part.replace(/^\(+/, "").replace(/\)+$/, "").trim())
			.filter(Boolean);
		const kept: string[] = [];
		let matchedAny = false;
		for (const part of parts) {
			const year = yearFromCiteToken(part);
			const author = lastNameFromCiteToken(part.replace(/\b(?:19|20)\d{2}[a-z]?\b/g, ""));
			if (!year || !author) {
				kept.push(part);
				continue;
			}
			const paper = findPaperByAuthorYear(papers, author, year, part);
			if (!paper) {
				kept.push(part); // preserve unmatched cite text
				// Still attach an author-matched bank paper so References is not wiped
				// when the model hallucinates a year (e.g. 2026) that is not in the bank.
				const byAuthor = findDatedPaperByAuthor(author);
				if (byAuthor) addPaper(byAuthor);
				continue;
			}
			matchedAny = true;
			addPaper(paper);
			const canonical = formatParentheticalCite(paper, papers.indexOf(paper), styleLabel).replace(
				/^\(|\)$/g,
				"",
			);
			kept.push(canonical);
		}
		if (kept.length === 0) return full;
		if (!matchedAny) return full;
		return `(${kept.join("; ")})`;
	});

	return {
		body: nextBody
			.replace(/[ \t]{2,}/g, " ")
			.replace(/ +\./g, ".")
			.replace(/\(\s*\(/g, "(")
			.replace(/\)\s*\)/g, ")"),
		cited,
	};
}

const FACTCHECK_ASIDE =
	/\s*—\s*(?:this point is not clearly supported by the cited abstract and is therefore stated cautiously|the previously cited source is from a different scholarly field and is not treated as evidence for this claim|this source is a perspective\/agenda paper rather than an empirical measurement)\.?/gi;

function stripFactCheckAsides(text: string): string {
	return text.replace(FACTCHECK_ASIDE, "").replace(/[ \t]{2,}/g, " ");
}

function splitSentences(text: string): string[] {
	const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
	return parts?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function papersCitedInSentence(sentence: string, papers: AlphaXivPaper[]): AlphaXivPaper[] {
	const found: AlphaXivPaper[] = [];
	const seen = new Set<string>();
	const add = (paper: AlphaXivPaper | undefined) => {
		if (!paper || !paperIsCitable(paper)) return;
		const key = paperCiteKey(paper);
		if (seen.has(key)) return;
		seen.add(key);
		found.push(paper);
	};

	for (const match of sentence.matchAll(AUTHOR_YEAR_CITE)) {
		const inner = match[1] ?? "";
		const year = yearFromCiteToken(inner);
		const author = lastNameFromCiteToken(inner.replace(/\b(?:19|20)\d{2}[a-z]?\b/g, ""));
		if (year && author) add(findPaperByAuthorYear(papers, author, year, inner));
	}
	for (const match of sentence.matchAll(NARRATIVE_CITE)) {
		const author = lastNameFromCiteToken(match[1] ?? "");
		const year = match[2] ?? "";
		if (author && year) add(findPaperByAuthorYear(papers, author, year, match[1] ?? ""));
	}
	return found;
}

function extractCitedClaims(body: string, papers: AlphaXivPaper[]): CitedClaim[] {
	const claims: CitedClaim[] = [];
	for (const sentence of splitSentences(body)) {
		if (claims.length >= CLAIM_NLI_CAP) break;
		const cited = papersCitedInSentence(sentence, papers);
		if (cited.length === 0) continue;
		const paper = cited[0]!;
		claims.push({
			sentence,
			paper: {
				title: paper.title ?? "",
				abstract: paper.abstract ?? "",
			},
		});
	}
	return claims;
}

function removeContradictedSentences(body: string, contradicted: Set<string>): string {
	if (contradicted.size === 0) return body;
	const sentences = splitSentences(body);
	// Drop contradicted sentences that assert quantitative, causal, or specific
	// institutional/country claims — avoid wiping ordinary cited prose on noisy NLI.
	const kept = sentences.filter((sentence) => {
		let isBad = false;
		for (const bad of contradicted) {
			if (sentence === bad || sentence.includes(bad) || bad.includes(sentence)) {
				isBad = true;
				break;
			}
		}
		if (!isBad) return true;
		const hasHardClaim =
			/\d[\d,]*(?:\.\d+)?\s*%|\b(?:p\s*[<=>]\s*0\.\d+|n\s*=\s*\d+)/i.test(sentence) ||
			/\b(?:Nigeria|Nigerian|university|universities|undergraduates?|faculty|significantly|increased|decreased|improved)\b/i.test(
				sentence,
			);
		return !hasHardClaim;
	});
	return kept
		.join(" ")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function factCheckAssignmentBody(
	body: string,
	papers: AlphaXivPaper[],
	signal?: AbortSignal,
): Promise<string> {
	const claims = extractCitedClaims(body, papers);
	if (claims.length === 0) return body;
	const results = await factCheckCitedClaims(claims, { signal });
	const contradicted = new Set(
		results.filter((result) => result.contradicted).map((result) => result.sentence),
	);
	if (contradicted.size === 0) return body;
	return removeContradictedSentences(body, contradicted);
}

export async function alignCitationsAndFactCheck(
	content: string,
	papers: AlphaXivPaper[],
	userPrompt: string,
	options?: {
		signal?: AbortSignal;
		protocol?: RetrievalProtocol;
		topic?: string | null;
		scope?: string | null;
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
	const { body, heading, refs: originalRefs } = splitBodyAndReferences(sanitized);
	const citable = papers.filter(paperIsCitable);
	const bank = citable.length > 0 ? citable : papers;
	const isAssignment = (options?.scope ?? "").toLowerCase() === "assignment";
	const collectOpts = {
		preferParenthetical: isAssignment && !numbered,
		styleLabel,
	};
	let workingBody = body;
	if (isAssignment && !numbered) {
		workingBody = stripOffTopicParentheticals(workingBody, bank, options?.topic ?? userPrompt);
	}
	let aligned = collectCitedPapersFromBody(workingBody, bank, numbered, collectOpts);

	if (isAssignment && !numbered) {
		const checked = await factCheckAssignmentBody(aligned.body, bank, options?.signal);
		const scrubbed =
			checked !== aligned.body
				? stripOffTopicParentheticals(checked, bank, options?.topic ?? userPrompt)
				: stripOffTopicParentheticals(aligned.body, bank, options?.topic ?? userPrompt);
		if (scrubbed !== aligned.body) {
			aligned = collectCitedPapersFromBody(scrubbed, bank, numbered, collectOpts);
		}
	}

	const cited = aligned.cited.filter(paperIsCitable);
	let refsBody = cited.length > 0 ? rebuildReferences(cited, styleLabel, bank) : "";
	// If bank matching found nothing, keep the model-written References instead of
	// saving a bare "**References**" heading (looks like the list was cut off).
	if (!refsBody.trim()) {
		refsBody = originalRefs.replace(/^\s*\n+/, "").trim();
	}
	const referenceBlock = refsBody ? `${heading}\n\n${refsBody}` : heading;
	return `${stripFactCheckAsides(aligned.body).trim()}\n\n${referenceBlock}`.trim();
}
