import {
	getAlphaXivApiBase,
	getAlphaXivApiKey,
	getAlphaXivMcpUrl,
	getOpenAlexApiKey,
	getPubmedApiKey,
	getTavilyApiKey,
	isAlphaXivEnabled,
	isOpenAlexEnabled,
	isPaperLibraryEnabled,
	isPubmedEnabled,
	isTavilyEnabled,
} from "../config/env.js";
import { searchArxivPapers } from "./arxiv.service.js";
import { searchOpenAlexPapers } from "./openalex.service.js";
import {
	libraryHasEnoughHits,
	mergeUniquePapers,
	searchPaperLibrary,
	upsertPapersIntoLibrary,
} from "./paper-library.service.js";
import { searchPubmedPapers } from "./pubmed.service.js";
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

	const abstractBudget = papers.length >= 25 ? 320 : 600;
	const lines = papers.map((paper, index) => {
		const authorLine =
			paper.authors.length > 0
				? paper.authors.slice(0, 6).join(", ") + (paper.authors.length > 6 ? ", et al." : "")
				: "Authors unavailable";
		const year = paper.publicationDate ? new Date(paper.publicationDate).getFullYear() : "n.d.";
		const title = paper.title.replace(/\*/g, "");
		const abstract = paper.abstract
			? paper.abstract.replace(/\s+/g, " ").slice(0, abstractBudget)
			: "Abstract unavailable.";

		return [
			`${index + 1}. **${title}**`,
			`   Authors: ${authorLine}`,
			`   Year: ${year}`,
			`   Reference format: ${authorLine} (${year}). [*${title}*](${paper.url})`,
			`   Abstract: ${abstract}`,
		].join("\n");
	});

	const minRefsInstruction =
		papers.length >= 25
			? `Cite and write from at least 25 of these papers throughout Introduction, Literature Review, Discussion, and other body sections (prefer more when the bank is larger). References must list every bank paper cited in the body (≥25 entries).`
			: `Cite and write from all ${papers.length} of these papers in the body when possible. References must list every bank paper cited in the body. Do not invent filler references.`;

	return [
		`${sourceLabel} retrieved ${papers.length} real paper(s) for the query "${query}".`,
		"Use these as primary literature sources. Cite by author and year in the body.",
		minRefsInstruction,
		"Paraphrase and synthesize bank abstracts into literature claims — do not pad the References list without in-text cites.",
		"In the References section, embed each title as [*Title*](url). Never mention preprint servers, repository names, or paper ID numbers.",
		"Do not invent papers outside this list.",
		"",
		...lines,
	].join("\n");
}

export type PaperSearchSource =
	| "library"
	| "hybrid"
	| "alphaxiv"
	| "arxiv"
	| "openalex"
	| "pubmed"
	| "alphaxiv-mcp"
	| "tavily"
	| "none";

const PAPER_SOURCE_LABELS: Record<PaperSearchSource, string> = {
	library: "Paper library (RAG)",
	hybrid: "Paper library + live literature",
	alphaxiv: "AlphaXiv",
	arxiv: "arXiv",
	openalex: "OpenAlex",
	pubmed: "PubMed",
	"alphaxiv-mcp": "AlphaXiv MCP",
	tavily: "Tavily",
	none: "OpenAlex/PubMed/AlphaXiv/arXiv/Tavily",
};

export type PaperSearchResult = {
	papers: AlphaXivPaper[];
	source: PaperSearchSource;
};

type LivePaperSource = Exclude<PaperSearchSource, "library" | "hybrid" | "none">;

type LiteratureProvider = {
	source: LivePaperSource;
	available: () => boolean;
	search: (
		query: string,
		options?: { limit?: number; signal?: AbortSignal },
	) => Promise<AlphaXivPaper[]>;
};

const LITERATURE_PROVIDERS: LiteratureProvider[] = [
	{
		source: "alphaxiv",
		available: () => isAlphaXivEnabled(),
		search: searchPapers,
	},
	{
		source: "arxiv",
		available: () => true,
		search: searchArxivPapers,
	},
	{
		source: "openalex",
		available: () => isOpenAlexEnabled() && Boolean(getOpenAlexApiKey()),
		search: searchOpenAlexPapers,
	},
	{
		source: "pubmed",
		available: () => isPubmedEnabled() && Boolean(getPubmedApiKey()),
		search: searchPubmedPapers,
	},
	{
		source: "alphaxiv-mcp",
		available: () => isAlphaXivEnabled() && Boolean(getAlphaXivApiKey()),
		search: searchPapersViaMcp,
	},
	{
		source: "tavily",
		available: () => isTavilyEnabled() && Boolean(getTavilyApiKey()),
		search: searchTavilyPapers,
	},
];

/** Core scholarly APIs — mixed into every citation bank when available. */
const CORE_SCHOLARLY_SOURCES = new Set<LivePaperSource>([
	"alphaxiv",
	"arxiv",
	"openalex",
	"pubmed",
]);

function shuffleProviders<T>(items: T[]): T[] {
	const next = [...items];
	for (let i = next.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = next[i]!;
		next[i] = next[j]!;
		next[j] = tmp;
	}
	return next;
}

function availableProviders(): LiteratureProvider[] {
	return LITERATURE_PROVIDERS.filter((provider) => provider.available());
}

function paperDedupKey(paper: AlphaXivPaper): string {
	if (paper.arxivId?.trim()) return `arxiv:${paper.arxivId.trim().toLowerCase()}`;
	const title = paper.title
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (title) return `title:${title}`;
	return `id:${paper.id}`;
}

/** Round-robin merge so one API cannot dominate references / in-text cites. */
function interleaveUniquePapers(
	batches: Array<{ source: LivePaperSource; papers: AlphaXivPaper[] }>,
	limit: number,
): { papers: AlphaXivPaper[]; sourcesUsed: LivePaperSource[] } {
	const seen = new Set<string>();
	const out: AlphaXivPaper[] = [];
	const sourcesUsed: LivePaperSource[] = [];
	const queues = batches
		.filter((batch) => batch.papers.length > 0)
		.map((batch) => ({ source: batch.source, papers: [...batch.papers] }));

	while (out.length < limit && queues.length > 0) {
		for (let i = 0; i < queues.length && out.length < limit; ) {
			const queue = queues[i]!;
			const next = queue.papers.shift();
			if (!next) {
				queues.splice(i, 1);
				continue;
			}
			const key = paperDedupKey(next);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			out.push(next);
			if (!sourcesUsed.includes(queue.source)) sourcesUsed.push(queue.source);
			i += 1;
		}
	}

	return { papers: out, sourcesUsed };
}

/**
 * Mix randomly ordered research APIs into the citation bank (references + in-text cites).
 * Always samples multiple scholarly sources when available — never fills the whole bank from one API.
 */
async function fetchPapersFromExternalApis(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<PaperSearchResult> {
	const limit = options?.limit ?? DEFAULT_LIMIT;
	const all = availableProviders();
	if (all.length === 0) {
		return { papers: [], source: "none" };
	}

	const started = Date.now();
	const core = shuffleProviders(all.filter((p) => CORE_SCHOLARLY_SOURCES.has(p.source)));
	const fallbacks = shuffleProviders(all.filter((p) => !CORE_SCHOLARLY_SOURCES.has(p.source)));

	/** Use every available core API (random order). Fall back to a single provider only if that is all we have. */
	const mixTargets =
		core.length > 0
			? core
			: shuffleProviders(all).slice(0, Math.min(2, all.length));

	const perProviderLimit = Math.max(
		Math.ceil(limit / Math.max(mixTargets.length, 1)) + 2,
		Math.min(limit, 12),
	);

	const settled = await Promise.all(
		mixTargets.map((provider) =>
			provider
				.search(query, { ...options, limit: perProviderLimit })
				.then((papers) => ({ source: provider.source, papers }))
				.catch(() => ({ source: provider.source, papers: [] as AlphaXivPaper[] })),
		),
	);

	let { papers, sourcesUsed } = interleaveUniquePapers(settled, limit);

	console.info(
		`[literature] mix-apis query="${query.slice(0, 80)}" limit=${limit} cores=${mixTargets.map((p) => p.source).join("+")} hits=${settled.map((s) => `${s.source}:${s.papers.length}`).join(",")} mixed=${papers.length}`,
	);

	if (papers.length < limit && fallbacks.length > 0) {
		const fill = await Promise.all(
			fallbacks.map((provider) =>
				provider
					.search(query, { ...options, limit: limit - papers.length })
					.then((hits) => ({ source: provider.source, papers: hits }))
					.catch(() => ({ source: provider.source, papers: [] as AlphaXivPaper[] })),
			),
		);
		const seen = new Set(papers.map(paperDedupKey));
		for (const batch of fill) {
			if (batch.papers.length === 0) continue;
			if (!sourcesUsed.includes(batch.source)) sourcesUsed.push(batch.source);
			for (const paper of batch.papers) {
				if (papers.length >= limit) break;
				const key = paperDedupKey(paper);
				if (seen.has(key)) continue;
				seen.add(key);
				papers.push(paper);
			}
		}
	}

	const source: PaperSearchSource =
		sourcesUsed.length > 1 ? "hybrid" : (sourcesUsed[0] ?? "none");
	console.info(
		`[literature] mixed-api query="${query.slice(0, 80)}" limit=${limit} got=${papers.length} source=${source} used=${sourcesUsed.join("+")} ms=${Date.now() - started}`,
	);
	return { papers, source };
}

export async function fetchPapersForQueryDetailed(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<PaperSearchResult> {
	const trimmed = query.trim();
	if (!trimmed) return { papers: [], source: "none" };

	const limit = options?.limit ?? DEFAULT_LIMIT;
	/** Large citation banks must mix live APIs — library alone is usually one historical source. */
	const requireLiveMix = limit >= 25;

	/** 1) Library-first RAG — reuse previously retrieved publications (small banks only). */
	const libraryPapers = isPaperLibraryEnabled()
		? await searchPaperLibrary(trimmed, { limit })
		: [];

	if (!requireLiveMix && libraryHasEnoughHits(libraryPapers.length, limit)) {
		return {
			papers: libraryPapers.slice(0, limit),
			source: "library",
		};
	}

	/** 2) Live APIs — always for large banks; otherwise when the library is thin. */
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

	const merged = mergeUniquePapers(
		requireLiveMix ? external.papers : libraryPapers,
		requireLiveMix ? libraryPapers : external.papers,
		limit,
	);
	return {
		papers: merged,
		source: external.papers.length > 0 ? (libraryPapers.length > 0 ? "hybrid" : external.source) : "library",
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
