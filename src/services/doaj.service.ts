import { getDoajApiBase, isDoajEnabled } from "../config/env.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "GARIL-AI/0.2 (research assistant; mailto:support@garilai.com)";

type DoajAuthor = { name?: string | null };
type DoajIdentifier = { type?: string | null; id?: string | null };
type DoajLink = { type?: string | null; url?: string | null };
type DoajBibjson = {
	title?: string | null;
	abstract?: string | null;
	author?: DoajAuthor[] | null;
	year?: string | number | null;
	month?: string | number | null;
	identifier?: DoajIdentifier[] | null;
	link?: DoajLink[] | null;
	keywords?: string[] | null;
	subject?: Array<{ term?: string | null } | string> | null;
	journal?: { title?: string | null } | null;
};

type DoajResult = {
	id?: string;
	bibjson?: DoajBibjson | null;
};

type DoajSearchResponse = {
	results?: DoajResult[];
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

function doiFromIdentifiers(identifiers: DoajIdentifier[] | null | undefined): string | null {
	for (const item of identifiers ?? []) {
		const type = (item.type ?? "").toLowerCase();
		const id = item.id?.trim();
		if (!id) continue;
		if (type === "doi" || id.startsWith("10.")) {
			return id.replace(/^https?:\/\/doi\.org\//i, "");
		}
	}
	return null;
}

function bestUrl(bib: DoajBibjson, doi: string | null): string {
	const links = bib.link ?? [];
	const fulltext = links.find((l) => (l.type ?? "").toLowerCase().includes("fulltext"))?.url?.trim();
	if (fulltext) return fulltext;
	const anyLink = links.find((l) => l.url?.trim())?.url?.trim();
	if (anyLink) return anyLink;
	if (doi) return `https://doi.org/${doi}`;
	return "";
}

function normalizeResult(raw: DoajResult, index: number): AlphaXivPaper | null {
	const bib = raw.bibjson;
	const title = bib?.title?.trim();
	if (!title) return null;

	const doi = doiFromIdentifiers(bib?.identifier);
	const authors = (bib?.author ?? [])
		.map((a) => a.name?.trim())
		.filter((name): name is string => Boolean(name));

	const year = bib?.year != null ? String(bib.year) : "";
	const month = bib?.month != null ? String(bib.month).padStart(2, "0") : "";
	const publicationDate = year ? (month ? `${year}-${month}` : year) : null;

	const keywords = (bib?.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
	const subjects = (bib?.subject ?? [])
		.map((s) => (typeof s === "string" ? s : s.term?.trim() ?? ""))
		.filter(Boolean);
	const topics = [...keywords, ...subjects].slice(0, 8);
	if (bib?.journal?.title?.trim()) topics.unshift(bib.journal.title.trim());

	const id = raw.id?.trim() || doi || `doaj-${index}-${title.slice(0, 40)}`;

	return {
		id,
		paperGroupId: id,
		title,
		abstract: (bib?.abstract ?? "").trim().slice(0, 2000),
		arxivId: null,
		authors,
		publicationDate,
		url: bestUrl(bib ?? {}, doi),
		topics,
	};
}

export async function searchDoajPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed || !isDoajEnabled()) return [];

	const limit = Math.min(Math.max(options?.limit ?? 8, 1), 100);
	const base = getDoajApiBase().replace(/\/$/, "");
	const encoded = encodeURIComponent(trimmed.slice(0, 400));
	const url = new URL(`${base}/search/articles/${encoded}`);
	url.searchParams.set("pageSize", String(limit));
	url.searchParams.set("page", "1");

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
		throw new Error(`DOAJ search failed (${response.status}): ${body.slice(0, 300)}`);
	}

	const payload = (await response.json()) as DoajSearchResponse;
	if (!Array.isArray(payload.results)) return [];

	return payload.results
		.map((row, index) => normalizeResult(row, index))
		.filter((paper): paper is AlphaXivPaper => paper !== null)
		.slice(0, limit);
}
