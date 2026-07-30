import {
	getAlphaXivApiBase,
	getAlphaXivApiKey,
	getAlphaXivMcpUrl,
	isAlphaXivEnabled,
	isPaperLibraryEnabled,
} from "../config/env.js";
import { searchArxivPapers } from "./arxiv.service.js";
import {
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

/** Enough papers for chat-paper section citation floors without inventing sources. */
const DEFAULT_LIMIT = 25;
const REQUEST_TIMEOUT_MS = 20_000;

/** Structured literature entry for bank-only in-text ↔ References matching. */
export type CitationBankEntry = {
	/** Normalized lookup key: `surname|year` (year may include a/b disambiguation). */
	citeKey: string;
	surname: string;
	year: string;
	authors: string[];
	title: string;
	url: string;
	authorLine: string;
	/** Exact APA-style line for the References section. */
	referenceLine: string;
	/** Canonical parenthetical cite, e.g. `(Smith, 2020)`. */
	inTextParen: string;
	/** Truncated abstract used for paraphrase grounding (empty if unavailable). */
	abstract: string;
};

const MIN_ABSTRACT_CHARS = 40;
const SEARCH_QUERY_MAX_CHARS = 160;

/**
 * Build a compact scholarly search query from a topic or mega paper prompt.
 * Strips outline/boilerplate so literature APIs get usable terms.
 */
export function buildScholarlySearchQuery(raw: string): string {
	let text = raw.replace(/\r/g, "").trim();
	if (!text) return "";

	// Prefer an explicit idea/title line when present.
	const titleMatch =
		text.match(/^\*\*([^*]{8,120})\*\*\s*$/m) ||
		text.match(/^Title:\s*(.+)$/im) ||
		text.match(/^Research (?:idea|topic|question):\s*(.+)$/im) ||
		text.match(/^Suggested (?:interest )?topic:\s*(.+)$/im);
	if (titleMatch?.[1]) {
		text = titleMatch[1].replace(/\*\*/g, "").trim();
	}

	// Drop common prompt scaffolding that pollutes search.
	text = text
		.replace(/\*\*Approved research outline\*\*[\s\S]*$/i, " ")
		.replace(/\*\*Selected user evidence\*\*[\s\S]*$/i, " ")
		.replace(/\*\*Study framing[\s\S]*?\*\*/gi, " ")
		.replace(/Reference style:.*$/gim, " ")
		.replace(/Discipline:\s*/gi, " ")
		.replace(/Scope:\s*/gi, " ")
		.replace(/Write a complete academic research paper[\s\S]{0,400}/gi, " ")
		.replace(/In-text citation floors[\s\S]{0,300}/gi, " ")
		.replace(/Cite ONLY papers[\s\S]{0,200}/gi, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\[[^\]]*\]\([^)]+\)/g, " ")
		.replace(/[#*_`>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (text.length > SEARCH_QUERY_MAX_CHARS) {
		text = text.slice(0, SEARCH_QUERY_MAX_CHARS).replace(/\s+\S*$/, "").trim();
	}
	return text;
}

function truncateAbstract(abstract: string, max = 600): string {
	return abstract.replace(/\s+/g, " ").trim().slice(0, max);
}

function hasUsableAbstract(paper: AlphaXivPaper): boolean {
	return truncateAbstract(paper.abstract).length >= MIN_ABSTRACT_CHARS;
}

/** True when the first author yields a real surname (not Unknown / empty). */
function hasUsableAuthor(paper: AlphaXivPaper): boolean {
	const authors = paper.authors.filter((a) => a?.trim());
	if (authors.length === 0) return false;
	const surname = authorSurname(authors[0]!).toLowerCase();
	return surname.length >= 2 && surname !== "unknown";
}

/** True when publication date parses to a real year (not n.d.). */
function hasUsableYear(paper: AlphaXivPaper): boolean {
	return paperYear(paper) !== "n.d.";
}

/**
 * Cite-eligible papers need abstract + real author + real year.
 * Incomplete hits (common from Tavily) must not enter the bank as (Unknown, n.d.).
 */
export function filterCiteEligiblePapers(papers: AlphaXivPaper[]): AlphaXivPaper[] {
	const citeable = papers.filter(
		(p) => hasUsableAbstract(p) && hasUsableAuthor(p) && hasUsableYear(p),
	);
	if (citeable.length > 0) return citeable;

	// Soft fallback: keep author+year even if abstract is thin — still never Unknown/n.d.
	const withIdentity = papers.filter((p) => hasUsableAuthor(p) && hasUsableYear(p));
	return withIdentity;
}

function paperDedupeKey(paper: AlphaXivPaper): string {
	if (paper.arxivId) return `arxiv:${paper.arxivId.toLowerCase()}`;
	return `title:${paper.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

function scorePaperForQuery(paper: AlphaXivPaper, query: string): number {
	const q = query.toLowerCase();
	const terms = q.split(/\s+/).filter((t) => t.length > 2);
	const title = paper.title.toLowerCase();
	const abstract = paper.abstract.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (title.includes(term)) score += 3;
		if (abstract.includes(term)) score += 1;
	}
	const absLen = truncateAbstract(paper.abstract).length;
	if (absLen >= 200) score += 4;
	else if (absLen >= MIN_ABSTRACT_CHARS) score += 2;
	else score -= 5;

	if (!hasUsableAuthor(paper)) score -= 20;
	if (!hasUsableYear(paper)) score -= 15;

	if (paper.publicationDate) {
		const year = new Date(paper.publicationDate).getFullYear();
		if (Number.isFinite(year)) {
			score += Math.max(0, Math.min(6, year - 2018));
		}
	}
	return score;
}

/** Merge, dedupe, rank by relevance/abstract substance/recency, then keep top N. */
export function mergeRankPapers(
	batches: AlphaXivPaper[][],
	query: string,
	limit: number,
): AlphaXivPaper[] {
	const seen = new Set<string>();
	const merged: AlphaXivPaper[] = [];
	for (const batch of batches) {
		for (const paper of batch) {
			const key = paperDedupeKey(paper);
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(paper);
		}
	}
	merged.sort((a, b) => scorePaperForQuery(b, query) - scorePaperForQuery(a, query));
	return filterCiteEligiblePapers(merged).slice(0, limit);
}

/**
 * Deterministic evidence cards: 2–4 paraphraseable claim bullets per bank paper.
 * Writers must paraphrase these cards rather than invent literature claims.
 */
export function buildEvidenceCardsFromBank(bank: CitationBankEntry[]): string {
	if (!bank.length) return "";

	const cards = bank.map((entry) => {
		const abstract = truncateAbstract(entry.abstract || "", 600);
		const sentences = abstract
			? abstract
					.split(/(?<=[.!?])\s+/)
					.map((s) => s.trim())
					.filter((s) => s.length >= 28)
					.slice(0, 4)
			: [];
		const claims =
			sentences.length > 0
				? sentences.map((s) => `- Claim: ${s}`)
				: [`- Claim: ${entry.title} (title only — paraphrase cautiously; abstract unavailable).`];
		return [`### ${entry.inTextParen}`, ...claims, `Allowed cite: ${entry.inTextParen}`].join(
			"\n",
		);
	});

	return [
		"## Evidence cards (paraphrase ONLY these — cite with the Allowed cite key)",
		"Every literature claim with an in-text citation must paraphrase or synthesize the matching card.",
		"Do not invent findings, statistics, or methods not supported by the card/abstract.",
		"",
		...cards,
	].join("\n");
}

/** Extract a usable surname from an author display name. */
export function authorSurname(author: string): string {
	const cleaned = author
		.replace(/\s+/g, " ")
		.replace(/,+/g, ",")
		.trim();
	if (!cleaned) return "Unknown";

	// "Last, First" or "Last, F."
	if (cleaned.includes(",")) {
		const last = cleaned.split(",")[0]?.trim();
		if (last) return last.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'\-]/g, "") || "Unknown";
	}

	const parts = cleaned.split(" ").filter(Boolean);
	const last = parts[parts.length - 1] ?? cleaned;
	return last.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'\-]/g, "") || "Unknown";
}

function paperYear(paper: AlphaXivPaper): string {
	if (!paper.publicationDate) return "n.d.";
	const y = new Date(paper.publicationDate).getFullYear();
	return Number.isFinite(y) ? String(y) : "n.d.";
}

function formatApaAuthor(author: string): string {
	const cleaned = author.replace(/\s+/g, " ").replace(/,+/g, ",").trim();
	if (!cleaned) return "Unknown";

	if (cleaned.includes(",")) {
		const [lastRaw, ...rest] = cleaned.split(",").map((s) => s.trim());
		const last = (lastRaw ?? "Unknown").replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'\-\s]/g, "").trim() || "Unknown";
		const first = rest.join(" ").trim();
		const initials = first
			.split(/\s+/)
			.filter(Boolean)
			.map((part) => `${part[0]!.toUpperCase()}.`)
			.join(" ");
		return initials ? `${last}, ${initials}` : last;
	}

	const parts = cleaned.split(" ").filter(Boolean);
	if (parts.length === 1) return parts[0]!;
	const last = parts[parts.length - 1]!;
	const initials = parts
		.slice(0, -1)
		.map((part) => `${part[0]!.toUpperCase()}.`)
		.join(" ");
	return `${last}, ${initials}`;
}

/** APA 7 reference-list author string (up to 20 names). */
function formatAuthorLine(authors: string[]): string {
	if (authors.length === 0) return "Unknown";
	const formatted = authors.slice(0, 20).map(formatApaAuthor);
	if (formatted.length === 1) return formatted[0]!;
	if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
	return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
}

/** Build a disambiguated citation bank from retrieved papers. */
export function buildCitationBank(papers: AlphaXivPaper[]): CitationBankEntry[] {
	// Never emit (Unknown, n.d.) — incomplete metadata is not citeable.
	const eligible = filterCiteEligiblePapers(papers);
	const baseCounts = new Map<string, number>();
	const preliminary = eligible.map((paper) => {
		const authors = paper.authors.filter(Boolean);
		const surname = authorSurname(authors[0] ?? "Unknown");
		const year = paperYear(paper);
		const base = `${surname.toLowerCase()}|${year}`;
		baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
		return { paper, authors, surname, year, base };
	});

	const seen = new Map<string, number>();
	return preliminary
		.map(({ paper, authors, surname, year, base }) => {
			const needsLetter = (baseCounts.get(base) ?? 0) > 1;
			const ordinal = (seen.get(base) ?? 0) + 1;
			seen.set(base, ordinal);
			const yearLabel =
				needsLetter && year !== "n.d."
					? `${year}${String.fromCharCode(96 + ordinal)}` // a, b, c…
					: year;
			const citeKey = `${surname.toLowerCase()}|${yearLabel}`;
			const title = paper.title.replace(/\*/g, "").replace(/[\[\]]/g, "").trim();
			const authorLine = formatAuthorLine(authors);
			// Plain title + explicit Source link (References only — body links are stripped).
			const referenceLine = `${authorLine} (${yearLabel}). ${title}. [Source](${paper.url}).`;
			const inTextParen =
				authors.length === 0
					? `(${surname}, ${yearLabel})`
					: authors.length === 1
						? `(${surname}, ${yearLabel})`
						: authors.length === 2
							? `(${surname} & ${authorSurname(authors[1]!)}, ${yearLabel})`
							: `(${surname} et al., ${yearLabel})`;

			return {
				citeKey,
				surname,
				year: yearLabel,
				authors,
				title,
				url: paper.url,
				authorLine,
				referenceLine,
				inTextParen,
				abstract: truncateAbstract(paper.abstract),
			};
		})
		.filter(
			(entry) =>
				entry.surname.toLowerCase() !== "unknown" &&
				entry.year !== "n.d." &&
				!entry.year.toLowerCase().startsWith("n.d"),
		);
}

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
		return [
			`No papers were found via ${sourceLabel} for "${query}".`,
			"Do NOT invent authors, years, titles, or DOIs.",
			"Write with cautious language and omit in-text citations rather than fabricating sources.",
		].join(" ");
	}

	const bank = buildCitationBank(papers);
	const lines = bank.map((entry, index) => {
		const abstract = entry.abstract || "Abstract unavailable.";

		return [
			`${index + 1}. **${entry.title}**`,
			`   Authors: ${entry.authorLine}`,
			`   Year: ${entry.year}`,
			`   Cite as: ${entry.inTextParen}`,
			`   Reference format: ${entry.referenceLine}`,
			`   Abstract: ${abstract}`,
		].join("\n");
	});

	const citeKeyList = bank.map((e) => `- ${e.inTextParen} → ${e.referenceLine}`).join("\n");
	const evidenceCards = buildEvidenceCardsFromBank(bank);

	return [
		`${sourceLabel} retrieved ${papers.length} real paper(s) for the query "${query}".`,
		"You may ONLY cite papers from this list. Do not invent authors, years, titles, or DOIs.",
		"Every in-text citation must use a Cite-as key from this list; the References section must list exactly those cited papers (use each Reference format line).",
		"Paraphrase literature claims from the evidence cards / abstracts below — never decorate invented prose with unrelated bank cites.",
		"Never mention preprint servers, repository names, or paper ID numbers in the visible text.",
		"",
		"## Allowed citation keys",
		citeKeyList,
		"",
		evidenceCards,
		"",
		"## Paper details",
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
	hybrid: "Merged literature retrieval",
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
	const limit = options?.limit ?? DEFAULT_LIMIT;
	const signal = options?.signal;

	const settled = await Promise.allSettled([
		isAlphaXivEnabled()
			? searchPapers(query, { limit, signal })
			: Promise.resolve([] as AlphaXivPaper[]),
		searchArxivPapers(query, { limit, signal }),
		getAlphaXivApiKey()
			? searchPapersViaMcp(query, { limit, signal })
			: Promise.resolve([] as AlphaXivPaper[]),
		searchTavilyPapers(query, { limit, signal }),
	]);

	const batches: AlphaXivPaper[][] = settled.map((result) =>
		result.status === "fulfilled" ? result.value : [],
	);
	const [alphaxivPapers, arxivPapers, mcpPapers, tavilyPapers] = batches;

	const papers = mergeRankPapers(batches, query, limit);
	if (papers.length === 0) return { papers: [], source: "none" };

	const sourceCounts: Array<{ source: PaperSearchSource; count: number }> = [
		{ source: "alphaxiv", count: alphaxivPapers?.length ?? 0 },
		{ source: "arxiv", count: arxivPapers?.length ?? 0 },
		{ source: "alphaxiv-mcp", count: mcpPapers?.length ?? 0 },
		{ source: "tavily", count: tavilyPapers?.length ?? 0 },
	];
	const nonEmpty = sourceCounts.filter((s) => s.count > 0);
	const source: PaperSearchSource =
		nonEmpty.length > 1
			? "hybrid"
			: (nonEmpty[0]?.source ?? "none");

	return { papers, source };
}

export async function fetchPapersForQueryDetailed(
	query: string,
	options?: { limit?: number; signal?: AbortSignal },
): Promise<PaperSearchResult> {
	const scholarly = buildScholarlySearchQuery(query) || query.trim();
	if (!scholarly) return { papers: [], source: "none" };

	const limit = options?.limit ?? DEFAULT_LIMIT;

	/** 1) Library RAG — soft preference, never exclusive short-circuit on weak hits. */
	const libraryPapers = isPaperLibraryEnabled()
		? await searchPaperLibrary(scholarly, { limit })
		: [];

	/** 2) Live APIs in parallel — merge + rank with library. */
	const external = await fetchPapersFromExternalApis(scholarly, { ...options, limit });

	if (
		external.source !== "none" &&
		external.source !== "library" &&
		external.papers.length > 0
	) {
		const librarySource =
			external.source === "hybrid" ? "alphaxiv" : external.source;
		void upsertPapersIntoLibrary(external.papers, scholarly, librarySource).catch(() => {
			/* non-blocking library write */
		});
	}

	const papers = mergeRankPapers([libraryPapers, external.papers], scholarly, limit);

	if (papers.length === 0) return { papers: [], source: "none" };

	let source: PaperSearchSource = external.source;
	if (libraryPapers.length > 0 && external.papers.length > 0) source = "hybrid";
	else if (libraryPapers.length > 0 && external.papers.length === 0) source = "library";

	return { papers, source };
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
	const scholarly = buildScholarlySearchQuery(query) || query.trim();
	if (!scholarly) return null;

	const { papers, source } = await fetchPapersForQueryDetailed(scholarly, options);
	const sourceLabel = PAPER_SOURCE_LABELS[source];

	return {
		papers,
		source,
		context: formatPapersForContext(papers, scholarly, sourceLabel),
	};
}

export function shouldUseAlphaXiv(workflow?: string | null): boolean {
	if (!workflow) return false;
	return ALPHAXIV_RESEARCH_WORKFLOWS.has(workflow.replace(/^\//, ""));
}
