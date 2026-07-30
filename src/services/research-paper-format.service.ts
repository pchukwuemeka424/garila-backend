import {
	standardizeResearchSectionHeadings,
	stripArxivMetaPreserveLayout,
} from "./research-paper-sections.js";

const REFERENCES_HEADING = /^(?:\#{1,6}\s+|\*\*)References(?:\*\*)?\s*$/im;
const ARXIV_ID = /[\d]{4}\.[\d]{4,5}(?:v\d+)?[a-z]?/i;
const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi;

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

/** Keep link labels; drop URLs — used on the paper body so sources only appear under References. */
function stripMarkdownLinksKeepLabel(text: string): string {
	return text
		.replace(MD_LINK, "$1")
		.replace(/(?<!\]\()https?:\/\/[^\s)\],]+/gi, "")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\s+\./g, ".")
		.replace(/\.\s*\./g, ".")
		.trim();
}

function hasSourceLink(text: string): boolean {
	return /\[Source\]\(https?:\/\/[^)]+\)/i.test(text) || /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text);
}

function extractSourceUrl(text: string): string | null {
	const sourceLink = text.match(/\[Source\]\((https?:\/\/[^)]+)\)/i);
	if (sourceLink?.[1]) return sourceLink[1].replace(/[.,;:]+$/, "");

	const anyLink = text.match(/\]\((https?:\/\/[^)]+)\)/i);
	if (anyLink?.[1]) return anyLink[1].replace(/[.,;:]+$/, "");

	const urlMatch = text.match(/https?:\/\/[^\s)\],]+/i);
	if (urlMatch?.[0]) return urlMatch[0].replace(/[.,;:]+$/, "");

	const idMatch = text.match(new RegExp(`\\barXiv:\\s*(${ARXIV_ID.source})`, "i"));
	if (idMatch?.[1]) return `https://arxiv.org/abs/${idMatch[1]}`;

	const absMatch = text.match(new RegExp(`arxiv\\.org/abs/(${ARXIV_ID.source})`, "i"));
	if (absMatch?.[1]) return `https://arxiv.org/abs/${absMatch[1]}`;

	return null;
}

function removeBareUrls(text: string): string {
	return text.replace(/(?<!\]\()https?:\/\/[^\s)\],]+/gi, "").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Split a References block into one entry per source.
 * Handles blank lines and run-on paragraphs (no blank lines between entries).
 */
export function splitReferenceEntries(text: string): string[] {
	const trimmed = text.replace(/\r/g, "").trim();
	if (!trimmed) return [];

	const byBlank = trimmed
		.split(/\n\s*\n+/)
		.map((chunk) => chunk.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	if (byBlank.length > 1) {
		return byBlank.flatMap((chunk) => splitReferenceEntries(chunk));
	}

	const single = byBlank[0] ?? trimmed.replace(/\s+/g, " ").trim();

	const afterUrl = single.split(
		/(?<=https?:\/\/[^\s]+)\.?\s+(?=[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ''\-.,\s]{1,80}?\(\d{4}[a-z]?\))/,
	);
	if (afterUrl.length > 1) {
		return afterUrl.map((c) => c.trim()).filter(Boolean);
	}

	const afterSentence = single.split(
		/(?<=\.)\s+(?=[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ''\-]+(?:,|\s|&|et\s+al)[^()]{0,100}?\(\d{4}[a-z]?\))/,
	);
	if (afterSentence.length > 1) {
		return afterSentence.map((c) => c.trim()).filter(Boolean);
	}

	return [single];
}

function finalizeReferenceLine(line: string): string {
	let result = stripArxivMeta(line);
	result = removeBareUrls(result);
	return result
		.replace(/\s+\[Source\]/gi, " [Source]")
		.replace(/\s+\./g, ".")
		.replace(/\.\s*\./g, ".")
		.replace(/\.\s*\[Source\]/i, ". [Source]")
		.trim();
}

/**
 * Normalize a reference entry to:
 *   Author (Year). Title. [Source](url).
 */
function formatReferenceEntry(line: string): string {
	const trimmed = line.trim();
	if (!trimmed || REFERENCES_HEADING.test(trimmed)) return trimmed;

	const sourceUrl = extractSourceUrl(trimmed);
	let working = stripArxivMeta(trimmed);

	// Drop existing markdown links but keep their labels (title text, "Source", etc.).
	working = working.replace(MD_LINK, "$1");
	working = working.replace(/https?:\/\/[^\s)\],]+/gi, "").replace(/\barXiv:\s*[\d.]+[a-z]?\b/gi, "");
	working = working.replace(/[ \t]{2,}/g, " ").trim();
	working = working.replace(/\bSource\.?\s*$/i, "").trim();

	const numbered = working.match(/^(\d+\.\s+|\[\d+\]\s+)([\s\S]+)$/);
	const prefixNum = numbered?.[1] ?? "";
	let body = (numbered?.[2] ?? working).trim();

	// Ensure single trailing period before Source link.
	body = body.replace(/\s+/g, " ").replace(/[:.,;\s]+$/g, "").trim();

	if (!sourceUrl) {
		return finalizeReferenceLine(`${prefixNum}${body}.`);
	}

	return finalizeReferenceLine(`${prefixNum}${body}. [Source](${sourceUrl}).`);
}

function isReferenceEntryStart(line: string): boolean {
	const t = line.trim();
	if (!t) return false;
	if (/^\d+\.\s+/.test(t) || /^\[\d+\]/.test(t)) return true;
	if (/\(\d{4}[a-z]?\)/.test(t) && t.length > 12) return true;
	if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(t) && t.length > 20) return true;
	return false;
}

/** Group wrapped reference lines into entries; each gets a Source link. */
function formatReferencesBlock(section: string): string {
	const lines = section.split("\n");
	const headingIndex = lines.findIndex((line) => REFERENCES_HEADING.test(line.trim()));
	if (headingIndex < 0) return stripArxivMeta(section);

	const head = lines.slice(0, headingIndex + 1);
	const rawBody = lines.slice(headingIndex + 1);
	const entries: string[] = [];
	let current = "";

	for (const line of rawBody) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (current) {
				entries.push(current);
				current = "";
			}
			continue;
		}
		if (isReferenceEntryStart(trimmed) && current) {
			entries.push(current);
			current = trimmed;
		} else {
			current = current ? `${current} ${trimmed}` : trimmed;
		}
	}
	if (current) entries.push(current);

	const exploded = entries.flatMap((entry) => splitReferenceEntries(entry));
	const formatted = exploded.map((entry) => formatReferenceEntry(entry)).filter(Boolean);

	// Double newline between entries so Markdown/PDF treat each as its own block.
	return [...head, "", ...formatted.flatMap((entry, i) => (i === 0 ? [entry] : ["", entry]))]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();
}

/**
 * Strip source URLs/links from the paper body; embed [Source](url) on References entries only.
 */
export function formatResearchPaperReferences(content: string): string {
	const trimmed = normalizeResearchPaperMarkdown(content);
	if (!trimmed) return trimmed;

	const headingMatch = trimmed.match(REFERENCES_HEADING);
	if (!headingMatch || headingMatch.index === undefined) {
		return stripMarkdownLinksKeepLabel(stripArxivMeta(trimmed));
	}

	const body = stripMarkdownLinksKeepLabel(
		stripArxivMeta(trimmed.slice(0, headingMatch.index).trimEnd()),
	);
	const references = trimmed.slice(headingMatch.index);

	return `${body}\n\n${formatReferencesBlock(references)}`.trim();
}

export function referenceHasSourceLink(line: string): boolean {
	return hasSourceLink(line);
}
