import { getTavilyApiKey, isTavilyEnabled } from "../config/env.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 20_000;

/** Domains biased toward scholarly / preprint sources for literature fallback. */
const SCHOLARLY_DOMAINS = [
	"arxiv.org",
	"scholar.google.com",
	"semanticscholar.org",
	"pubmed.ncbi.nlm.nih.gov",
	"ncbi.nlm.nih.gov",
	"ieee.org",
	"acm.org",
	"springer.com",
	"nature.com",
	"sciencedirect.com",
	"wiley.com",
	"researchgate.net",
	"doi.org",
];

type TavilyResult = {
	title?: string;
	url?: string;
	content?: string;
	score?: number;
	published_date?: string;
};

type TavilySearchResponse = {
	results?: TavilyResult[];
};

function extractArxivId(url: string): string | null {
	const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#\s]+)/i);
	if (!match?.[1]) return null;
	return match[1].replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
}

function extractAuthorsFromSnippet(snippet: string): string[] {
	const etAl = snippet.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:\s+et al\.?)?)/);
	if (etAl?.[1] && etAl[1].length < 80) {
		return etAl[1]
			.replace(/\s+et al\.?$/i, "")
			.split(/\s+and\s+|,\s*/)
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return [];
}

function normalizeTavilyResult(raw: TavilyResult, index: number): AlphaXivPaper | null {
	const title = raw.title?.trim();
	const url = raw.url?.trim();
	if (!title || !url) return null;

	const arxivId = extractArxivId(url);
	const id = arxivId ?? url;
	const abstract = raw.content?.replace(/\s+/g, " ").trim() || "";

	return {
		id: id || `tavily-${index}`,
		paperGroupId: id || `tavily-${index}`,
		title,
		abstract: abstract.slice(0, 1200),
		arxivId,
		authors: extractAuthorsFromSnippet(abstract),
		publicationDate: raw.published_date?.trim() || null,
		url: arxivId ? `https://arxiv.org/abs/${arxivId}` : url,
		topics: [],
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

async function runTavilySearch(
	apiKey: string,
	searchQuery: string,
	limit: number,
	init: { searchDepth: "advanced" | "basic"; scholarlyOnly: boolean },
	signal?: AbortSignal,
): Promise<AlphaXivPaper[]> {
	const body: Record<string, unknown> = {
		query: searchQuery,
		max_results: limit,
		search_depth: init.searchDepth,
		include_raw_content: false,
	};
	if (init.scholarlyOnly) {
		body.include_domains = SCHOLARLY_DOMAINS;
	}

	const response = await fetchWithTimeout(
		TAVILY_SEARCH_URL,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
			signal,
		},
	);

	if (!response.ok) {
		const errBody = await response.text();
		throw new Error(`Tavily search failed (${response.status}): ${errBody.slice(0, 300)}`);
	}

	const payload = (await response.json()) as TavilySearchResponse;
	if (!Array.isArray(payload.results)) return [];

	return payload.results
		.map((item, index) => normalizeTavilyResult(item, index))
		.filter((paper): paper is AlphaXivPaper => paper !== null)
		.slice(0, limit);
}

export async function searchTavilyPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed || !isTavilyEnabled()) return [];

	const apiKey = getTavilyApiKey();
	if (!apiKey) return [];

	const limit = Math.min(Math.max(options?.limit ?? 8, 1), 20);
	const searchQuery =
		trimmed.length > 360 ? `${trimmed.slice(0, 360)} scholarly research` : `${trimmed} scholarly research paper`;

	const attempts: Array<{ searchDepth: "advanced" | "basic"; scholarlyOnly: boolean }> = [
		{ searchDepth: "advanced", scholarlyOnly: true },
		{ searchDepth: "basic", scholarlyOnly: true },
		{ searchDepth: "basic", scholarlyOnly: false },
	];

	for (const attempt of attempts) {
		try {
			const papers = await runTavilySearch(apiKey, searchQuery, limit, attempt, options?.signal);
			if (papers.length > 0) return papers;
		} catch {
			/* try next Tavily configuration */
		}
	}

	return [];
}
