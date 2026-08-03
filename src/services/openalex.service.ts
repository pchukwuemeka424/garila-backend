import {
	getOpenAlexApiBase,
	getOpenAlexApiKey,
	isOpenAlexEnabled,
} from "../config/env.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "GARIL-AI/0.2 (research assistant; mailto:support@garilai.com)";

type OpenAlexAuthorship = {
	author?: { display_name?: string | null } | null;
};

type OpenAlexTopic = {
	display_name?: string | null;
};

type OpenAlexIds = {
	arxiv?: string | null;
	doi?: string | null;
	pmid?: string | null;
	openalex?: string | null;
};

type OpenAlexLocation = {
	landing_page_url?: string | null;
	pdf_url?: string | null;
};

type OpenAlexWork = {
	id?: string;
	doi?: string | null;
	display_name?: string | null;
	title?: string | null;
	publication_date?: string | null;
	authorships?: OpenAlexAuthorship[] | null;
	abstract_inverted_index?: Record<string, number[]> | null;
	primary_location?: OpenAlexLocation | null;
	topics?: OpenAlexTopic[] | null;
	ids?: OpenAlexIds | null;
};

type OpenAlexWorksResponse = {
	results?: OpenAlexWork[];
};

function reconstructAbstract(inverted: Record<string, number[]> | null | undefined): string {
	if (!inverted || typeof inverted !== "object") return "";
	const positions: Array<{ word: string; index: number }> = [];
	for (const [word, indexes] of Object.entries(inverted)) {
		if (!Array.isArray(indexes)) continue;
		for (const index of indexes) {
			if (typeof index === "number" && Number.isFinite(index)) {
				positions.push({ word, index });
			}
		}
	}
	positions.sort((a, b) => a.index - b.index);
	return positions
		.map((row) => row.word)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractArxivId(raw: string | null | undefined): string | null {
	if (!raw?.trim()) return null;
	const value = raw.trim();
	const fromUrl = value.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#\s]+)/i);
	if (fromUrl?.[1]) {
		return fromUrl[1].replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
	}
	const bare = value.match(/^(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i);
	if (bare?.[1]) return bare[1].replace(/v\d+$/i, "");
	return null;
}

function normalizeOpenAlexId(id: string | undefined): string | null {
	if (!id?.trim()) return null;
	const match = id.trim().match(/W\d+/i);
	return match?.[0]?.toUpperCase() ?? id.trim();
}

function normalizeWork(raw: OpenAlexWork, index: number): AlphaXivPaper | null {
	const title = (raw.display_name || raw.title || "").trim();
	if (!title) return null;

	const openAlexId = normalizeOpenAlexId(raw.id) || normalizeOpenAlexId(raw.ids?.openalex ?? undefined);
	const arxivId =
		extractArxivId(raw.ids?.arxiv) ||
		extractArxivId(raw.primary_location?.landing_page_url) ||
		extractArxivId(raw.primary_location?.pdf_url);
	const doi = (raw.doi || raw.ids?.doi || "").replace(/^https?:\/\/doi\.org\//i, "").trim() || null;
	const id = openAlexId || arxivId || doi || `openalex-${index}`;

	const authors = (raw.authorships ?? [])
		.map((row) => row.author?.display_name?.trim())
		.filter((name): name is string => Boolean(name));

	const topics = (raw.topics ?? [])
		.map((topic) => topic.display_name?.trim())
		.filter((name): name is string => Boolean(name))
		.slice(0, 8);

	const landing =
		raw.primary_location?.landing_page_url?.trim() ||
		(doi ? `https://doi.org/${doi}` : null) ||
		(openAlexId ? `https://openalex.org/${openAlexId}` : null) ||
		(arxivId ? `https://arxiv.org/abs/${arxivId}` : null) ||
		"";

	return {
		id,
		paperGroupId: id,
		title,
		abstract: reconstructAbstract(raw.abstract_inverted_index).slice(0, 2000),
		arxivId,
		authors,
		publicationDate: raw.publication_date?.trim() || null,
		/** Prefer publisher/DOI/OpenAlex links so mixed banks are not all arXiv URLs. */
		url: landing,
		topics,
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

export async function searchOpenAlexPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed || !isOpenAlexEnabled()) return [];

	const apiKey = getOpenAlexApiKey();
	if (!apiKey) return [];

	const limit = Math.min(Math.max(options?.limit ?? 8, 1), 50);
	const url = new URL(`${getOpenAlexApiBase().replace(/\/$/, "")}/works`);
	url.searchParams.set("search", trimmed.slice(0, 400));
	url.searchParams.set("per_page", String(limit));
	url.searchParams.set("sort", "relevance_score:desc");
	url.searchParams.set(
		"select",
		[
			"id",
			"doi",
			"display_name",
			"title",
			"publication_date",
			"authorships",
			"abstract_inverted_index",
			"primary_location",
			"topics",
			"ids",
		].join(","),
	);
	url.searchParams.set("api_key", apiKey);

	const response = await fetchWithTimeout(
		url.toString(),
		{
			headers: {
				Accept: "application/json",
				"User-Agent": USER_AGENT,
			},
			signal: options?.signal,
		},
	);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`OpenAlex search failed (${response.status}): ${body.slice(0, 300)}`);
	}

	const payload = (await response.json()) as OpenAlexWorksResponse;
	if (!Array.isArray(payload.results)) return [];

	return payload.results
		.map((work, index) => normalizeWork(work, index))
		.filter((paper): paper is AlphaXivPaper => paper !== null)
		.slice(0, limit);
}
