import {
	standardizeResearchSectionHeadings,
	stripArxivMetaPreserveLayout,
} from "./research-paper-sections.js";

const REFERENCES_HEADING = /^(?:\#{1,6}\s+|\*\*)References(?:\*\*)?\s*$/im;
const ARXIV_ID = /[\d]{4}\.[\d]{4,5}(?:v\d+)?[a-z]?/i;

export function normalizeResearchPaperMarkdown(content: string): string {
	return standardizeResearchSectionHeadings(
		content
			.replace(/^(\#{1,6}\s+)\*\*([^*\n]+)\*\*\s*$/gm, "**$2**")
			.replace(/^(\#{1,6}\s+)\*([^*\n]+)\*\s*$/gm, "**$2**")
			.replace(/^(\#{1,6}\s+)(.+?)\s*$/gm, "**$2**")
			.replace(/^[\s]*(-{2,}|_{2,}|\*{2,})[\s]*$/gm, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);
}

/** Remove visible arXiv labels, IDs, and bare repository URLs from text. */
export function stripArxivMeta(text: string): string {
	return stripArxivMetaPreserveLayout(text);
}

function hasEmbeddedTitleLink(text: string): boolean {
	return /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text);
}

function extractSourceUrl(text: string): string | null {
	const urlMatch = text.match(/https?:\/\/[^\s)\],]+/i);
	if (urlMatch?.[0]) return urlMatch[0];

	const idMatch = text.match(new RegExp(`\\barXiv:\\s*(${ARXIV_ID.source})`, "i"));
	if (idMatch?.[1]) return `https://arxiv.org/abs/${idMatch[1]}`;

	const absMatch = text.match(new RegExp(`arxiv\\.org/abs/(${ARXIV_ID.source})`, "i"));
	if (absMatch?.[1]) return `https://arxiv.org/abs/${absMatch[1]}`;

	return null;
}

function removeBareUrls(text: string): string {
	return text.replace(/(?<!\]\()https?:\/\/[^\s)\],]+/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

function finalizeReferenceLine(line: string): string {
	let result = stripArxivMeta(line);
	result = removeBareUrls(result);
	return result.replace(/\s+\./g, ".").replace(/\.\s*\./g, ".").trim();
}

function embedTitleLinkInReferenceLine(line: string): string {
	const trimmed = line.trim();
	if (!trimmed || REFERENCES_HEADING.test(trimmed)) return trimmed;

	const sourceUrl = extractSourceUrl(trimmed);
	let working = stripArxivMeta(trimmed);

	if (hasEmbeddedTitleLink(working)) {
		return finalizeReferenceLine(working);
	}

	if (!sourceUrl) {
		return finalizeReferenceLine(working);
	}

	working = working.replace(/https?:\/\/[^\s)\],]+/gi, "").replace(/\barXiv:\s*[\d.]+[a-z]?\b/gi, "");
	working = working.replace(/[ \t]{2,}/g, " ").trim();

	const numbered = working.match(/^(\d+\.\s+)([\s\S]+)$/);
	const prefixNum = numbered?.[1] ?? "";
	const body = numbered?.[2] ?? working;

	const afterYear = body.match(/^(.+?\(\d{4}[a-z]?\)\.\s+)([\s\S]+)$/);
	if (!afterYear) {
		const titleOnly = body.replace(/\*([^*]+)\*/g, "$1").replace(/\.\s*$/, "").trim();
		if (!titleOnly) return finalizeReferenceLine(trimmed);
		return finalizeReferenceLine(`${prefixNum}[*${titleOnly}*](${sourceUrl}).`);
	}

	const authorPart = afterYear[1]!;
	const remainder = afterYear[2]!.trim().replace(/\.\s*$/, "");

	const splitAtJournal = remainder.match(
		/^(.+?)(\.\s+(?:In |Journal|Proceedings|Vol\.|Volume|pp\.|pp\s|doi:|DOI:|Retrieved|Available).*)$/i,
	);
	const title = (splitAtJournal?.[1] ?? remainder).replace(/\*([^*]+)\*/g, "$1").trim();
	const suffix = splitAtJournal?.[2] ? stripArxivMeta(splitAtJournal[2]) : "";

	if (!title) return finalizeReferenceLine(`${prefixNum}${authorPart}${remainder}.`);

	const titleLink = `[*${title}*](${sourceUrl})`;
	const entry = `${prefixNum}${authorPart}${titleLink}${suffix ? suffix : "."}`;
	return finalizeReferenceLine(entry);
}

function formatReferencesBlock(section: string): string {
	const lines = section.split("\n");
	const headingIndex = lines.findIndex((line) => REFERENCES_HEADING.test(line.trim()));
	if (headingIndex < 0) return stripArxivMeta(section);

	const head = lines.slice(0, headingIndex + 1);
	const body = lines.slice(headingIndex + 1).map((line) => embedTitleLinkInReferenceLine(line));

	return [...head, ...body].join("\n");
}

export function formatResearchPaperReferences(content: string): string {
	const trimmed = normalizeResearchPaperMarkdown(content);
	if (!trimmed) return trimmed;

	const headingMatch = trimmed.match(REFERENCES_HEADING);
	if (!headingMatch || headingMatch.index === undefined) {
		return stripArxivMeta(trimmed);
	}

	const body = trimmed.slice(0, headingMatch.index).trimEnd();
	const references = trimmed.slice(headingMatch.index);

	return `${stripArxivMeta(body)}\n\n${formatReferencesBlock(references)}`.trim();
}
