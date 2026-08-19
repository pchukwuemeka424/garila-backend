export type NotebookPage = {
	id: string;
	title: string;
	html: string;
	updatedAt: string;
};

export type NotebookLabEntry = {
	id: string;
	at: string;
	title: string;
	body: string;
	imageDocumentIds: string[];
};

export type ResearchNotebookData = {
	pages: NotebookPage[];
	labEntries: NotebookLabEntry[];
};

const MAX_PAGES = 50;
const MAX_LAB = 200;
const MAX_TITLE = 200;
const MAX_HTML = 2_000_000;
const MAX_BODY = 20_000;
const MAX_IMAGES_PER_ENTRY = 8;

function asString(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value.slice(0, max);
}

function asId(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, 64);
}

function asIso(value: unknown): string {
	if (typeof value !== "string") return new Date().toISOString();
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export function emptyNotebookData(): ResearchNotebookData {
	return { pages: [], labEntries: [] };
}

export function sanitizeNotebookData(raw: unknown): ResearchNotebookData {
	if (!raw || typeof raw !== "object") return emptyNotebookData();
	const input = raw as { pages?: unknown; labEntries?: unknown };
	const pagesIn = Array.isArray(input.pages) ? input.pages : [];
	const labsIn = Array.isArray(input.labEntries) ? input.labEntries : [];

	const pages: NotebookPage[] = [];
	for (const row of pagesIn.slice(0, MAX_PAGES)) {
		if (!row || typeof row !== "object") continue;
		const item = row as Record<string, unknown>;
		const id = asId(item.id);
		if (!id) continue;
		pages.push({
			id,
			title: asString(item.title, MAX_TITLE) || "Untitled note",
			html: asString(item.html, MAX_HTML),
			updatedAt: asIso(item.updatedAt),
		});
	}

	const labEntries: NotebookLabEntry[] = [];
	for (const row of labsIn.slice(0, MAX_LAB)) {
		if (!row || typeof row !== "object") continue;
		const item = row as Record<string, unknown>;
		const id = asId(item.id);
		if (!id) continue;
		const imageIds = Array.isArray(item.imageDocumentIds)
			? item.imageDocumentIds.map(asId).filter(Boolean).slice(0, MAX_IMAGES_PER_ENTRY)
			: [];
		labEntries.push({
			id,
			at: asIso(item.at),
			title: asString(item.title, MAX_TITLE) || "Lab entry",
			body: asString(item.body, MAX_BODY),
			imageDocumentIds: imageIds,
		});
	}

	return { pages, labEntries };
}

function tokenize(text: string): string[] {
	return text
		.replace(/<[^>]+>/g, " ")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s'-]/gu, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1);
}

function htmlToPlainText(html: string): string {
	return html
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}

function clampScore(n: number): number {
	return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Same formula as lib/research-notebook-effort.ts:
 * 5% per captured item (non-empty page, file, survey, dataset, picture, non-empty lab)
 * + 1% per 100 words in pages, labs, and surveys.
 */
export function computeNotebookProgress(
	rawNotebook: unknown,
	counts: {
		datasets: number;
		questionnaires: number;
		pictures: number;
		files?: number;
		surveyTexts?: string[];
	},
): number {
	const notebook = sanitizeNotebookData(rawNotebook);
	const pageWords = notebook.pages.map((p) => tokenize(htmlToPlainText(p.html)).length);
	const labWords = notebook.labEntries.map((e) => tokenize(e.body).length);
	const surveyTexts = counts.surveyTexts ?? [];
	const surveyWordCount = surveyTexts.reduce((sum, text) => sum + tokenize(text).length, 0);
	const wordCount = pageWords.reduce((sum, n) => sum + n, 0) + labWords.reduce((sum, n) => sum + n, 0) + surveyWordCount;
	const pageCount = pageWords.filter((n) => n > 0).length;
	const labCount = labWords.filter((n) => n > 0).length;
	const fileCount = Math.max(0, counts.files ?? 0);
	const captureItems =
		pageCount + fileCount + counts.questionnaires + counts.datasets + counts.pictures + labCount;
	const captureScore = clampScore(captureItems * 5);
	const writingScore = wordCount > 0 ? clampScore(Math.ceil(wordCount / 100)) : 0;
	return clampScore(captureScore + writingScore);
}
