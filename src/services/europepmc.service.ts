import { getEuropePmcApiBase, isEuropePmcEnabled } from "../config/env.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "GARIL-AI/0.2 (research assistant; mailto:support@garilai.com)";

type EuropePmcResult = {
	id?: string;
	source?: string;
	pmid?: string;
	pmcid?: string;
	doi?: string;
	title?: string;
	authorString?: string;
	pubYear?: string | number;
	abstractText?: string;
	isOpenAccess?: string;
	journalTitle?: string;
	fullTextUrlList?: {
		fullTextUrl?: Array<{ url?: string; availability?: string; documentStyle?: string }>;
	};
};

type EuropePmcSearchResponse = {
	hitCount?: number;
	resultList?: {
		result?: EuropePmcResult[];
	};
};

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

function splitAuthors(authorString: string | undefined): string[] {
	if (!authorString?.trim()) return [];
	return authorString
		.split(/,|;|\band\b/i)
		.map((part) => part.trim())
		.filter(Boolean)
		.slice(0, 20);
}

function bestUrl(raw: EuropePmcResult): string {
	const doi = raw.doi?.trim().replace(/^https?:\/\/doi\.org\//i, "");
	if (doi) return `https://doi.org/${doi}`;

	const urls = raw.fullTextUrlList?.fullTextUrl ?? [];
	const open = urls.find((u) => u.url && /open|free|html|pdf/i.test(`${u.availability ?? ""} ${u.documentStyle ?? ""}`));
	if (open?.url) return open.url.trim();
	const any = urls.find((u) => u.url?.trim());
	if (any?.url) return any.url.trim();

	const source = (raw.source ?? "MED").trim() || "MED";
	const id = (raw.pmcid || raw.pmid || raw.id || "").trim();
	if (id) return `https://europepmc.org/article/${source}/${id}`;
	return "";
}

function normalizeResult(raw: EuropePmcResult, index: number): AlphaXivPaper | null {
	const title = raw.title?.trim();
	if (!title) return null;

	const id =
		raw.pmcid?.trim() ||
		raw.pmid?.trim() ||
		raw.doi?.trim() ||
		raw.id?.trim() ||
		`europepmc-${index}-${title.slice(0, 40)}`;

	const topics: string[] = [];
	if (raw.journalTitle?.trim()) topics.push(raw.journalTitle.trim());
	if (raw.isOpenAccess === "Y") topics.push("open-access");

	return {
		id,
		paperGroupId: id,
		title,
		abstract: (raw.abstractText ?? "").trim().slice(0, 2000),
		arxivId: null,
		authors: splitAuthors(raw.authorString),
		publicationDate: raw.pubYear != null ? String(raw.pubYear) : null,
		url: bestUrl(raw),
		topics,
	};
}

export async function searchEuropePmcPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed || !isEuropePmcEnabled()) return [];

	const limit = Math.min(Math.max(options?.limit ?? 8, 1), 50);
	const base = getEuropePmcApiBase().replace(/\/$/, "");
	const url = new URL(`${base}/search`);
	url.searchParams.set("query", trimmed.slice(0, 400));
	url.searchParams.set("format", "json");
	url.searchParams.set("resultType", "core");
	url.searchParams.set("pageSize", String(limit));
	url.searchParams.set("sort", "RELEVANCE");

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
		throw new Error(`Europe PMC search failed (${response.status}): ${body.slice(0, 300)}`);
	}

	const payload = (await response.json()) as EuropePmcSearchResponse;
	const results = payload.resultList?.result;
	if (!Array.isArray(results)) return [];

	return results
		.map((row, index) => normalizeResult(row, index))
		.filter((paper): paper is AlphaXivPaper => paper !== null)
		.slice(0, limit);
}
