import {
	getAlphaXivApiBase,
	getAlphaXivApiKey,
	getAlphaXivMcpUrl,
	isAlphaXivEnabled,
	isPaperLibraryEnabled,
} from "../config/env.js";
import { searchArxivPapers } from "./arxiv.service.js";
import {
	libraryHasEnoughHits,
	mergeUniquePapers,
	searchPaperLibrary,
	upsertPapersIntoLibrary,
} from "./paper-library.service.js";
import { searchTavilyPapers } from "./tavily.service.js";

export type AlphaXivPaper = {
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

type RawSearchPaper = {
	id?: string;
	paper_group_id?: string;
	title?: string;
	abstract?: string;
	universal_paper_id?: string;
	authors?: string[];
	first_publication_date?: string;
	publication_date?: string;
	topics?: string[];
};

const DEFAULT_LIMIT = 8;
const REQUEST_TIMEOUT_MS = 20_000;

export const ALPHAXIV_RESEARCH_WORKFLOWS = new Set([
	"chat-paper",
	"lit",
	"deepresearch",
	"draft",
	"compare",
	"autoresearch",
	"review",
	"summarize",
	"watch",
	"audit",
	"recipe",
	"replicate",
]);

function normalizePaper(raw: RawSearchPaper): AlphaXivPaper | null {
	const title = raw.title?.trim();
	if (!title) return null;

	const arxivId = raw.universal_paper_id?.trim() || null;
	const id = raw.id?.trim() || raw.paper_group_id?.trim() || arxivId || title;
	const paperGroupId = raw.paper_group_id?.trim() || id;

	return {
		id,
		paperGroupId,
		title,
		abstract: raw.abstract?.trim() || "",
		arxivId,
		authors: Array.isArray(raw.authors) ? raw.authors.filter(Boolean) : [],
		publicationDate: raw.first_publication_date?.trim() || raw.publication_date?.trim() || null,
		url: arxivId ? `https://arxiv.org/abs/${arxivId}` : `https://alphaxiv.org/abs/${arxivId ?? id}`,
		topics: Array.isArray(raw.topics) ? raw.topics.filter(Boolean) : [],
	};
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit = {},
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	const signal = init.signal
		? AbortSignal.any([init.signal, controller.signal])
		: controller.signal;

	try {
		return await fetch(url, { ...init, signal });
	} finally {
		clearTimeout(timeout);
	}
}

export async function searchPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const limit = options?.limit ?? DEFAULT_LIMIT;
	const base = getAlphaXivApiBase();
	const url = new URL("/v1/search/paper", base);
	url.searchParams.set("q", trimmed);

	const response = await fetchWithTimeout(url.toString(), { signal: options?.signal });
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`AlphaXiv search failed (${response.status}): ${body.slice(0, 300)}`);
	}

	const payload = (await response.json()) as RawSearchPaper[];
	if (!Array.isArray(payload)) return [];

	return payload
		.map(normalizePaper)
		.filter((paper): paper is AlphaXivPaper => paper !== null)
		.slice(0, limit);
}

async function mcpCallTool(
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<unknown> {
	const apiKey = getAlphaXivApiKey();
	if (!apiKey) {
		throw new Error("ALPHAXIV_API_KEY is not configured.");
	}

	const response = await fetchWithTimeout(
		getAlphaXivMcpUrl(),
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: toolName, arguments: args },
			}),
			signal,
		},
		REQUEST_TIMEOUT_MS,
	);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`AlphaXiv MCP failed (${response.status}): ${body.slice(0, 300)}`);
	}

	const payload = (await response.json()) as {
		result?: { content?: Array<{ type?: string; text?: string }> };
		error?: { message?: string };
	};

	if (payload.error?.message) {
		throw new Error(payload.error.message);
	}

	const text = payload.result?.content?.find((block) => block.type === "text")?.text;
	if (text) {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	return payload.result;
}

async function searchPapersViaMcp(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const apiKey = getAlphaXivApiKey();
	if (!apiKey) return [];

	const limit = options?.limit ?? DEFAULT_LIMIT;
	const toolCandidates = ["full_text_papers_search", "embedding_similarity_search"] as const;

	for (const toolName of toolCandidates) {
		try {
			const result = await mcpCallTool(
				toolName,
				{ query, limit },
				options?.signal,
			);

			if (Array.isArray(result)) {
				return result
					.map((item) => normalizePaper(item as RawSearchPaper))
					.filter((paper): paper is AlphaXivPaper => paper !== null)
					.slice(0, limit);
			}
		} catch {
			/* try next MCP tool */
		}
	}

	return [];
}

export function formatPapersForContext(
	papers: AlphaXivPaper[],
	query: string,
	sourceLabel = "AlphaXiv/arXiv",
): string {
	if (papers.length === 0) {
		return `No papers were found via ${sourceLabel} for "${query}". Use cautious language and cite well-known sources in the field.`;
	}

	const lines = papers.map((paper, index) => {
		const authorLine =
			paper.authors.length > 0
				? paper.authors.slice(0, 6).join(", ") + (paper.authors.length > 6 ? ", et al." : "")
				: "Authors unavailable";
		const year = paper.publicationDate ? new Date(paper.publicationDate).getFullYear() : "n.d.";
		const title = paper.title.replace(/\*/g, "");
		const abstract = paper.abstract
			? paper.abstract.replace(/\s+/g, " ").slice(0, 600)
			: "Abstract unavailable.";

		return [
			`${index + 1}. **${title}**`,
			`   Authors: ${authorLine}`,
			`   Year: ${year}`,
			`   Reference format: ${authorLine} (${year}). [*${title}*](${paper.url})`,
			`   Abstract: ${abstract}`,
		].join("\n");
	});

	return [
		`${sourceLabel} retrieved ${papers.length} real paper(s) for the query "${query}".`,
		"Use these as primary literature sources. Cite by author and year in the body.",
		"In the References section, embed each title as [*Title*](url). Never mention preprint servers, repository names, or paper ID numbers.",
		"Do not invent papers outside this list unless clearly marked as general background.",
		"",
		...lines,
	].join("\n");
}

export type PaperSearchSource =
	| "library"
	| "hybrid"
	| "alphaxiv"
	| "arxiv"
	| "alphaxiv-mcp"
	| "tavily"
	| "none";

const PAPER_SOURCE_LABELS: Record<PaperSearchSource, string> = {
	library: "Paper library (RAG)",
	hybrid: "Paper library + live literature",
	alphaxiv: "AlphaXiv",
	arxiv: "arXiv",
	"alphaxiv-mcp": "AlphaXiv MCP",
	tavily: "Tavily",
	none: "AlphaXiv/arXiv/Tavily",
};

export type PaperSearchResult = {
	papers: AlphaXivPaper[];
	source: PaperSearchSource;
};

async function fetchPapersFromExternalApis(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<PaperSearchResult> {
	let papers: AlphaXivPaper[] = [];
	let source: PaperSearchSource = "none";

	if (isAlphaXivEnabled()) {
		try {
			papers = await searchPapers(query, options);
			if (papers.length > 0) source = "alphaxiv";
		} catch {
			/* fall through to arXiv / Tavily */
		}
	}

	if (papers.length === 0) {
		try {
			papers = await searchArxivPapers(query, options);
			if (papers.length > 0) source = "arxiv";
		} catch {
			/* fall through */
		}
	}

	if (papers.length === 0 && getAlphaXivApiKey()) {
		try {
			papers = await searchPapersViaMcp(query, options);
			if (papers.length > 0) source = "alphaxiv-mcp";
		} catch {
			/* fall through */
		}
	}

	if (papers.length === 0) {
		try {
			papers = await searchTavilyPapers(query, options);
			if (papers.length > 0) source = "tavily";
		} catch {
			/* no papers */
		}
	}

	return { papers, source };
}

export async function fetchPapersForQueryDetailed(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<PaperSearchResult> {
	const trimmed = query.trim();
	if (!trimmed) return { papers: [], source: "none" };

	const limit = options?.limit ?? DEFAULT_LIMIT;

	/** 1) Library-first RAG — reuse previously retrieved publications. */
	const libraryPapers = isPaperLibraryEnabled()
		? await searchPaperLibrary(trimmed, { limit })
		: [];

	if (libraryHasEnoughHits(libraryPapers.length, limit)) {
		return {
			papers: libraryPapers.slice(0, limit),
			source: "library",
		};
	}

	/** 2) Live APIs when the local library does not cover the query. */
	const external = await fetchPapersFromExternalApis(trimmed, { ...options, limit });

	if (
		external.source !== "none" &&
		external.source !== "library" &&
		external.source !== "hybrid" &&
		external.papers.length > 0
	) {
		void upsertPapersIntoLibrary(external.papers, trimmed, external.source).catch(() => {
			/* non-blocking library write */
		});
	}

	if (libraryPapers.length === 0) {
		return external;
	}

	const merged = mergeUniquePapers(libraryPapers, external.papers, limit);
	return {
		papers: merged,
		source: external.papers.length > 0 ? "hybrid" : "library",
	};
}

export async function fetchPapersForQuery(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const result = await fetchPapersForQueryDetailed(query, options);
	return result.papers;
}

export async function buildPaperSearchContext(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<{ context: string; papers: AlphaXivPaper[]; source: PaperSearchSource } | null> {
	const trimmed = query.trim();
	if (!trimmed) return null;

	const { papers, source } = await fetchPapersForQueryDetailed(trimmed, options);
	const sourceLabel = PAPER_SOURCE_LABELS[source];

	return {
		papers,
		source,
		context: formatPapersForContext(papers, trimmed, sourceLabel),
	};
}

export function shouldUseAlphaXiv(workflow?: string | null): boolean {
	if (!workflow) return false;
	return ALPHAXIV_RESEARCH_WORKFLOWS.has(workflow.replace(/^\//, ""));
}
