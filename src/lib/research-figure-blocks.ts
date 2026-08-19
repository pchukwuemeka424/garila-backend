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

const RESULTS_HEADING = /^#{1,3}\s+(results?|findings?|testing)\b.*$/im;

/** Insert saved figure blocks after Results/Findings, or append if that heading is missing. */
export function injectSavedFiguresIntoPaper(content: string, figureMarkdown: string): string {
	const blocks = figureMarkdown.trim();
	if (!blocks) return content;
	const body = content.trimEnd();
	const match = RESULTS_HEADING.exec(body);
	if (!match || match.index == null) {
		return `${body}\n\n${blocks}\n`;
	}
	const afterStart = match.index + match[0].length;
	const rest = body.slice(afterStart);
	const nextHeading = rest.search(/^#{1,3}\s+\S/m);
	if (nextHeading < 0) {
		return `${body}\n\n${blocks}\n`;
	}
	const insertAt = afterStart + nextHeading;
	return `${body.slice(0, insertAt).trimEnd()}\n\n${blocks}\n\n${body.slice(insertAt)}`;
}
