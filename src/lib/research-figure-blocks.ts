export const MAX_PAPER_FIGURES = 8;
/** Skip a single figure whose data URL would dominate the saved-paper document. */
export const MAX_FIGURE_DATA_URL_CHARS = 1_500_000;

export function isImageFile(fileName: string, mime: string): boolean {
	if ((mime ?? "").toLowerCase().startsWith("image/")) return true;
	return /\.(jpe?g|png|gif|webp|bmp)$/i.test(fileName ?? "");
}

export function figureMime(fileName: string, mime: string): string {
	const trimmed = (mime ?? "").trim().toLowerCase();
	if (trimmed.startsWith("image/")) return trimmed === "image/jpg" ? "image/jpeg" : trimmed;
	const lower = (fileName ?? "").toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	return "image/png";
}

export function buildResearchFigureBlock(input: {
	index: number;
	title: string;
	caption?: string;
	fileName?: string;
	mime: string;
	dataUrl: string;
}): string {
	const label = input.title.trim() || input.fileName?.trim() || "Research figure";
	const title = /^figure\s+\d+/i.test(label) ? label : `Figure ${input.index}: ${label}`;
	const caption =
		input.caption?.trim() ||
		(input.fileName?.trim() ? `From notebook file “${input.fileName.trim()}”.` : "From research notebook.");
	const payload = {
		type: "research-figure",
		title,
		caption,
		mime: figureMime(input.fileName ?? "", input.mime),
		dataUrl: input.dataUrl.trim(),
	};
	return ["```research-figure", JSON.stringify(payload), "```"].join("\n");
}

const RESULTS_HEADING =
	/^(?:#{1,3}\s+|\*\*)(?:(?:Chapter\s+(?:Five|5)[:\s]+)?(?:Testing\s+and\s+)?Results?|Findings(?:\s*\/\s*Results)?|Results(?:\s*(?:\/|and)\s*Analysis)?)\b(?:\*\*)?.*$/im;
const METHODOLOGY_HEADING =
	/^(?:#{1,3}\s+|\*\*)(?:(?:Chapter\s+(?:Three|3)[:\s]+)?(?:System\s+Analysis\s+and\s+)?Methodology|Methods)\b(?:\*\*)?.*$/im;
const REFERENCES_HEADING = /^(?:#{1,3}\s+|\*\*)References(?:\*\*)?\s*$/im;
const NEXT_SECTION_HEADING = /^(?:#{1,3}\s+|\*\*)[A-Za-z][^*\n]*?(?:\*\*)?\s*$/m;

function insertIntoHeading(content: string, blocks: string, heading: RegExp): string | null {
	const body = content.trimEnd();
	const match = heading.exec(body);
	if (!match || match.index == null) return null;
	const afterStart = match.index + match[0].length;
	const rest = body.slice(afterStart);
	const nextHeading = rest.search(NEXT_SECTION_HEADING);
	if (nextHeading >= 0) {
		const insertAt = afterStart + nextHeading;
		return `${body.slice(0, insertAt).trimEnd()}\n\n${blocks}\n\n${body.slice(insertAt)}`;
	}
	return `${body.slice(0, afterStart).trimEnd()}\n\n${blocks}\n`;
}

/**
 * Insert saved figure blocks into Results/Findings (or Methodology for proposals),
 * else before References — never after bibliography.
 */
export function injectSavedFiguresIntoPaper(content: string, figureMarkdown: string): string {
	const blocks = figureMarkdown.trim();
	if (!blocks) return content;
	const intoResults = insertIntoHeading(content, blocks, RESULTS_HEADING);
	if (intoResults != null) return intoResults;
	const intoMethods = insertIntoHeading(content, blocks, METHODOLOGY_HEADING);
	if (intoMethods != null) return intoMethods;
	const body = content.trimEnd();
	const refs = REFERENCES_HEADING.exec(body);
	if (refs && refs.index != null) {
		return `${body.slice(0, refs.index).trimEnd()}\n\n${blocks}\n\n${body.slice(refs.index)}`;
	}
	return `${body}\n\n${blocks}\n`;
}
