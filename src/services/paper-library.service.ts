import {
	getPaperLibraryMinHits,
	isPaperLibraryEnabled,
} from "../config/env.js";
import { PaperLibraryModel } from "../db/models/PaperLibrary.js";

/** Shared paper shape used by literature retrieval + library RAG. */
export type LibraryPaper = {
	id: string;
	paperGroupId: string;
	title: string;
	abstract: string;
	arxivId: string | null;
	authors: string[];
	publicationDate: string | null;
	url: string;
	topics: string[];
};

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"by",
	"for",
	"from",
	"in",
	"into",
	"of",
	"on",
	"or",
	"the",
	"to",
	"with",
	"via",
	"using",
	"based",
	"study",
	"research",
]);

export function normalizePaperTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function tokenizeQuery(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paperKey(paper: Pick<LibraryPaper, "arxivId" | "title" | "id">): string {
	if (paper.arxivId?.trim()) return `arxiv:${paper.arxivId.trim().toLowerCase()}`;
	const normalized = normalizePaperTitle(paper.title);
	if (normalized) return `title:${normalized}`;
	return `id:${paper.id}`;
}

function toLibraryPaper(row: {
	externalId?: string | null;
	arxivId?: string | null;
	title: string;
	abstract?: string | null;
	authors?: string[] | null;
	publicationDate?: string | null;
	url?: string | null;
	topics?: string[] | null;
	_id: { toString(): string };
}): LibraryPaper {
	const arxivId = row.arxivId?.trim() || null;
	const id = row.externalId?.trim() || arxivId || row._id.toString();
	return {
		id,
		paperGroupId: id,
		title: row.title,
		abstract: row.abstract?.trim() || "",
		arxivId,
		authors: Array.isArray(row.authors) ? row.authors.filter(Boolean) : [],
		publicationDate: row.publicationDate ?? null,
		url:
			row.url?.trim() ||
			(arxivId ? `https://arxiv.org/abs/${arxivId}` : `https://alphaxiv.org/abs/${id}`),
		topics: Array.isArray(row.topics) ? row.topics.filter(Boolean) : [],
	};
}

function scoreCandidate(paper: LibraryPaper, tokens: string[]): number {
	if (tokens.length === 0) return 0;
	const haystack = `${paper.title} ${paper.abstract} ${paper.topics.join(" ")}`.toLowerCase();
	let score = 0;
	for (const token of tokens) {
		if (haystack.includes(token)) score += 1;
		if (paper.title.toLowerCase().includes(token)) score += 1;
	}
	return score;
}

export function mergeUniquePapers(
	primary: LibraryPaper[],
	secondary: LibraryPaper[],
	limit: number,
): LibraryPaper[] {
	const seen = new Set<string>();
	const out: LibraryPaper[] = [];
	for (const paper of [...primary, ...secondary]) {
		const key = paperKey(paper);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(paper);
		if (out.length >= limit) break;
	}
	return out;
}

export async function searchPaperLibrary(
	query: string,
	options?: { limit?: number },
): Promise<LibraryPaper[]> {
	if (!isPaperLibraryEnabled()) return [];

	const trimmed = query.trim();
	if (!trimmed) return [];

	const limit = options?.limit ?? 8;
	const tokens = tokenizeQuery(trimmed);
	const textQuery = tokens.length > 0 ? tokens.join(" ") : trimmed;

	try {
		const textHits = await PaperLibraryModel.find(
			{ $text: { $search: textQuery } },
			{ score: { $meta: "textScore" } },
		)
			.sort({ score: { $meta: "textScore" } })
			.limit(limit)
			.lean();

		if (textHits.length > 0) {
			const ids = textHits.map((row) => row._id);
			await PaperLibraryModel.updateMany(
				{ _id: { $in: ids } },
				{ $inc: { hitCount: 1 }, $set: { lastRetrievedAt: new Date() } },
			);
			return textHits.map((row) => toLibraryPaper(row));
		}
	} catch {
		/* text index may not exist yet — fall through to keyword search */
	}

	if (tokens.length === 0) return [];

	const orClauses = tokens.slice(0, 10).flatMap((token) => {
		const pattern = new RegExp(escapeRegex(token), "i");
		return [{ title: pattern }, { abstract: pattern }, { queryTags: token }];
	});

	const candidates = await PaperLibraryModel.find({ $or: orClauses })
		.sort({ hitCount: -1, lastRetrievedAt: -1 })
		.limit(Math.max(limit * 5, 20))
		.lean();

	const ranked = candidates
		.map((row) => {
			const paper = toLibraryPaper(row);
			return { paper, score: scoreCandidate(paper, tokens), id: row._id };
		})
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	if (ranked.length === 0) return [];

	await PaperLibraryModel.updateMany(
		{ _id: { $in: ranked.map((row) => row.id) } },
		{ $inc: { hitCount: 1 }, $set: { lastRetrievedAt: new Date() } },
	);

	return ranked.map((row) => row.paper);
}

export async function upsertPapersIntoLibrary(
	papers: LibraryPaper[],
	query: string,
	source: "alphaxiv" | "arxiv" | "alphaxiv-mcp" | "tavily",
): Promise<void> {
	if (!isPaperLibraryEnabled() || papers.length === 0) return;

	const tags = tokenizeQuery(query).slice(0, 16);
	const now = new Date();

	for (const paper of papers) {
		const title = paper.title.trim();
		if (!title) continue;

		const arxivId = paper.arxivId?.trim() || null;
		const normalizedTitle = normalizePaperTitle(title);

		try {
			const existing = arxivId
				? await PaperLibraryModel.findOne({ arxivId })
				: await PaperLibraryModel.findOne({ normalizedTitle });

			if (existing) {
				await PaperLibraryModel.updateOne(
					{ _id: existing._id },
					{
						$set: {
							externalId: paper.id,
							arxivId: arxivId ?? existing.arxivId,
							normalizedTitle,
							title,
							abstract: paper.abstract?.trim() || existing.abstract || "",
							authors: paper.authors?.length ? paper.authors : existing.authors,
							publicationDate: paper.publicationDate ?? existing.publicationDate,
							url: paper.url || existing.url,
							topics: paper.topics?.length ? paper.topics : existing.topics,
							source,
							lastRetrievedAt: now,
						},
						$addToSet: { queryTags: { $each: tags } },
					},
				);
				continue;
			}

			await PaperLibraryModel.create({
				externalId: paper.id,
				arxivId,
				normalizedTitle,
				title,
				abstract: paper.abstract?.trim() || "",
				authors: paper.authors ?? [],
				publicationDate: paper.publicationDate,
				url: paper.url,
				topics: paper.topics ?? [],
				queryTags: tags,
				source,
				hitCount: 1,
				lastRetrievedAt: now,
			});
		} catch {
			/* ignore duplicate-key races between concurrent upserts */
		}
	}
}

export function libraryHasEnoughHits(count: number, limit: number): boolean {
	const minHits = Math.min(getPaperLibraryMinHits(), limit);
	return count >= minHits;
}
