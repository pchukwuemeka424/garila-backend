import {
	getPubmedApiBase,
	getPubmedApiKey,
	isPubmedEnabled,
} from "../config/env.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "GARIL-AI/0.2 (research assistant; mailto:support@garilai.com)";

type ESearchResponse = {
	esearchresult?: {
		idlist?: string[];
		count?: string;
	};
};

type ESummaryArticle = {
	uid?: string;
	title?: string;
	sortpubdate?: string;
	pubdate?: string;
	source?: string;
	authors?: Array<{ name?: string }>;
	elocationid?: string;
};

type ESummaryResponse = {
	result?: {
		uids?: string[];
		[uid: string]: ESummaryArticle | string[] | undefined;
	};
};

function decodeXml(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/gi, "'");
}

function extractAbstractFromMedline(xml: string, pmid: string): string {
	const articleMatch = xml.match(
		new RegExp(`<PubmedArticle>[\\s\\S]*?<PMID[^>]*>${pmid}<\\/PMID>[\\s\\S]*?<\\/PubmedArticle>`, "i"),
	);
	const block = articleMatch?.[0] ?? xml;
	const abstracts = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)].map(
		(match) => decodeXml(match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()),
	);
	return abstracts.filter(Boolean).join(" ").slice(0, 2000);
}

function parsePubDate(article: ESummaryArticle): string | null {
	const raw = article.sortpubdate?.trim() || article.pubdate?.trim() || "";
	if (!raw) return null;
	const iso = raw.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/);
	if (iso) {
		return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
	}
	const year = raw.match(/\b(19|20)\d{2}\b/);
	return year?.[0] ?? raw;
}

function normalizeSummary(article: ESummaryArticle, abstract: string): AlphaXivPaper | null {
	const pmid = article.uid?.trim();
	const title = article.title?.replace(/\s+/g, " ").trim();
	if (!pmid || !title) return null;

	const authors = (article.authors ?? [])
		.map((author) => author.name?.trim())
		.filter((name): name is string => Boolean(name));

	const doiMatch = article.elocationid?.match(/doi:\s*(\S+)/i);
	const doi = doiMatch?.[1]?.replace(/\.$/, "") || null;

	return {
		id: `pmid:${pmid}`,
		paperGroupId: `pmid:${pmid}`,
		title: title.replace(/\.$/, ""),
		abstract,
		arxivId: null,
		authors,
		publicationDate: parsePubDate(article),
		url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
		topics: article.source?.trim() ? [article.source.trim()] : [],
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

function withApiKey(url: URL, apiKey: string | null): void {
	if (apiKey) url.searchParams.set("api_key", apiKey);
}

export async function searchPubmedPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed || !isPubmedEnabled()) return [];

	const apiKey = getPubmedApiKey();
	if (!apiKey) return [];

	const limit = Math.min(Math.max(options?.limit ?? 8, 1), 50);
	const base = getPubmedApiBase().replace(/\/$/, "");

	const searchUrl = new URL(`${base}/esearch.fcgi`);
	searchUrl.searchParams.set("db", "pubmed");
	searchUrl.searchParams.set("term", trimmed.slice(0, 400));
	searchUrl.searchParams.set("retmax", String(limit));
	searchUrl.searchParams.set("retmode", "json");
	searchUrl.searchParams.set("sort", "relevance");
	withApiKey(searchUrl, apiKey);

	const searchResponse = await fetchWithTimeout(
		searchUrl.toString(),
		{
			headers: {
				Accept: "application/json",
				"User-Agent": USER_AGENT,
			},
			signal: options?.signal,
		},
	);

	if (!searchResponse.ok) {
		const body = await searchResponse.text();
		throw new Error(`PubMed esearch failed (${searchResponse.status}): ${body.slice(0, 300)}`);
	}

	const searchPayload = (await searchResponse.json()) as ESearchResponse;
	const ids = (searchPayload.esearchresult?.idlist ?? []).filter(Boolean).slice(0, limit);
	if (ids.length === 0) return [];

	const summaryUrl = new URL(`${base}/esummary.fcgi`);
	summaryUrl.searchParams.set("db", "pubmed");
	summaryUrl.searchParams.set("id", ids.join(","));
	summaryUrl.searchParams.set("retmode", "json");
	withApiKey(summaryUrl, apiKey);

	const summaryResponse = await fetchWithTimeout(
		summaryUrl.toString(),
		{
			headers: {
				Accept: "application/json",
				"User-Agent": USER_AGENT,
			},
			signal: options?.signal,
		},
	);

	if (!summaryResponse.ok) {
		const body = await summaryResponse.text();
		throw new Error(`PubMed esummary failed (${summaryResponse.status}): ${body.slice(0, 300)}`);
	}

	const summaryPayload = (await summaryResponse.json()) as ESummaryResponse;
	const result = summaryPayload.result ?? {};

	let abstractsXml = "";
	try {
		const fetchUrl = new URL(`${base}/efetch.fcgi`);
		fetchUrl.searchParams.set("db", "pubmed");
		fetchUrl.searchParams.set("id", ids.join(","));
		fetchUrl.searchParams.set("retmode", "xml");
		fetchUrl.searchParams.set("rettype", "abstract");
		withApiKey(fetchUrl, apiKey);

		const fetchResponse = await fetchWithTimeout(
			fetchUrl.toString(),
			{
				headers: {
					Accept: "application/xml",
					"User-Agent": USER_AGENT,
				},
				signal: options?.signal,
			},
		);
		if (fetchResponse.ok) {
			abstractsXml = await fetchResponse.text();
		}
	} catch {
		/* abstracts are optional — metadata alone is still useful */
	}

	const papers: AlphaXivPaper[] = [];
	for (const pmid of ids) {
		const article = result[pmid];
		if (!article || Array.isArray(article)) continue;
		const abstract = abstractsXml ? extractAbstractFromMedline(abstractsXml, pmid) : "";
		const paper = normalizeSummary(article, abstract);
		if (paper) papers.push(paper);
	}

	return papers.slice(0, limit);
}
