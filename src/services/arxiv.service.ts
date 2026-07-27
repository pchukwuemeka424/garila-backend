import { getArxivApiUrl } from "../config/env.js";
import type { AlphaXivPaper } from "./alphaxiv.service.js";

const REQUEST_TIMEOUT_MS = 25_000;
/** arXiv API policy: at most one request every 3 seconds. */
const ARXIV_MIN_INTERVAL_MS = 3_100;
const ARXIV_MAX_RETRIES = 4;
const ARXIV_USER_AGENT = "GARIL-AI/0.2 (research assistant; mailto:support@example.com)";

let lastArxivRequestAt = 0;
let arxivRequestChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error("Aborted"));
			return;
		}
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal!.reason ?? new Error("Aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function waitForArxivSlot(signal?: AbortSignal): Promise<void> {
	const now = Date.now();
	const wait = Math.max(0, lastArxivRequestAt + ARXIV_MIN_INTERVAL_MS - now);
	if (wait > 0) await sleep(wait, signal);
	lastArxivRequestAt = Date.now();
}

function withArxivRateLimit<T>(fn: () => Promise<T>): Promise<T> {
	const result = arxivRequestChain.then(() => fn());
	arxivRequestChain = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function retryDelayMs(response: Response, attempt: number): number {
	const retryAfter = response.headers.get("Retry-After");
	if (retryAfter) {
		const seconds = Number.parseInt(retryAfter, 10);
		if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
	}
	return Math.min(ARXIV_MIN_INTERVAL_MS * 2 ** attempt, 20_000);
}

function decodeXml(text: string): string {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function extractTag(block: string, tag: string): string {
	const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
	return match?.[1] ? decodeXml(match[1].replace(/\s+/g, " ").trim()) : "";
}

function extractAuthors(block: string): string[] {
	const authors: string[] = [];
	const authorBlocks = block.match(/<author[\s\S]*?<\/author>/gi) ?? [];
	for (const authorBlock of authorBlocks) {
		const name = extractTag(authorBlock, "name");
		if (name) authors.push(name);
	}
	return authors;
}

function extractArxivId(entryId: string): string | null {
	const match = entryId.match(/arxiv\.org\/abs\/([^/\s]+)/i);
	return match?.[1]?.replace(/v\d+$/i, "") ?? null;
}

function parseArxivEntry(block: string): AlphaXivPaper | null {
	const title = extractTag(block, "title");
	if (!title) return null;

	const entryId = extractTag(block, "id");
	const arxivId = extractArxivId(entryId) ?? extractArxivId(extractTag(block, "link"));
	const authors = extractAuthors(block);
	const abstract = extractTag(block, "summary");
	const published = extractTag(block, "published") || extractTag(block, "updated");
	const id = arxivId ?? (entryId || title);

	return {
		id,
		paperGroupId: id,
		title,
		abstract,
		arxivId,
		authors,
		publicationDate: published || null,
		url: arxivId ? `https://arxiv.org/abs/${arxivId}` : entryId || `https://arxiv.org/search/?query=${encodeURIComponent(title)}`,
		topics: [],
	};
}

function parseArxivAtom(xml: string): AlphaXivPaper[] {
	const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];
	return entries
		.map(parseArxivEntry)
		.filter((paper): paper is AlphaXivPaper => paper !== null);
}

async function fetchArxivQuery(url: URL, signal?: AbortSignal): Promise<string> {
	return withArxivRateLimit(async () => {
		for (let attempt = 0; attempt <= ARXIV_MAX_RETRIES; attempt++) {
			await waitForArxivSlot(signal);

			const response = await fetch(url.toString(), {
				headers: {
					Accept: "application/atom+xml",
					"User-Agent": ARXIV_USER_AGENT,
				},
				signal,
			});

			if (response.ok) {
				return response.text();
			}

			if ((response.status === 429 || response.status === 503) && attempt < ARXIV_MAX_RETRIES) {
				const delay = retryDelayMs(response, attempt);
				await sleep(delay, signal);
				continue;
			}

			const body = await response.text();
			throw new Error(`arXiv search failed (${response.status}): ${body.slice(0, 200)}`);
		}

		throw new Error("arXiv search failed after retries.");
	});
}

export async function searchArxivPapers(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<AlphaXivPaper[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const limit = options?.limit ?? 8;
	const url = new URL(getArxivApiUrl());
	url.searchParams.set("search_query", `all:${trimmed}`);
	url.searchParams.set("start", "0");
	url.searchParams.set("max_results", String(limit));

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const signal = options?.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const xml = await fetchArxivQuery(url, signal);
		return parseArxivAtom(xml).slice(0, limit);
	} finally {
		clearTimeout(timeout);
	}
}
