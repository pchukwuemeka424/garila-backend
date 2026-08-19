import {
	getAlphaXivApiBase,
	getAlphaXivApiKey,
	getAlphaXivMcpUrl,
	getTavilyApiKey,
	isAlphaXivEnabled,
	isDoajEnabled,
	isEuropePmcEnabled,
	isOpenAlexEnabled,
	isPaperLibraryEnabled,
	isPubmedEnabled,
	isTavilyEnabled,
} from "../config/env.js";
import {
	cleanReferenceTitle,
	citeYear,
	formatAuthorLine,
	formatNarrativeCite,
	formatParentheticalCite,
	formatApa7Reference,
	isNumberedCitationStyle,
	paperIsCitable,
} from "../lib/citation-bank.js";
import { getScopeProfile, type ResearchScope } from "../lib/research-scope-profiles.js";
import { rerankPapers } from "./huggingface.service.js";
import { searchArxivPapers } from "./arxiv.service.js";
import { searchDoajPapers } from "./doaj.service.js";
import { searchEuropePmcPapers } from "./europepmc.service.js";
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
	minDistinctCites = 25,
	styleLabel?: string | null,
	protocol?: RetrievalProtocol,
): string {
	if (papers.length === 0) {
		return `No papers were found via ${sourceLabel} for "${query}". Do not invent authors, years, titles, or DOIs. Omit claims that cannot be grounded in retrieved papers or user-supplied evidence. Do not cite sources from parametric memory. Do not invent Scopus, Web of Science, ERIC, IEEE Xplore, PRISMA counts, or dual reviewers.`;
	}

	const numbered = isNumberedCitationStyle(styleLabel ?? "");
	const abstractBudget = papers.length >= minDistinctCites ? 320 : 600;
	const lines = papers.map((paper, index) => {
		const authorLine = formatAuthorLine(paper.authors);
		const year = citeYear(paper);
		const title = cleanReferenceTitle(paper.title.replace(/\*/g, ""));
		const abstract = paper.abstract
			? paper.abstract.replace(/\s+/g, " ").slice(0, abstractBudget)
			: "Abstract unavailable.";
		const parenthetical = formatParentheticalCite(paper, index, numbered);
		const narrative = formatNarrativeCite(paper, index, numbered);
		const card = inferEvidenceCard(paper);
		const heNote = paperLooksHigherEducation(paper)
			? "   Higher-education setting: yes — prefer this paper for university/undergraduate/faculty claims."
			: "   Higher-education setting: not stated — do not treat as direct HE evidence.";

		return [
			`${index + 1}. **${title}**`,
			`   Authors: ${authorLine}`,
			`   Year: ${year} (use this four-digit year; never write n.d.)`,
			`   Evidence type: ${card.type}`,
			`   Population named in title/abstract: ${card.population}`,
			`   Sample in abstract: ${card.sample}`,
			heNote,
			`   USE THIS CITE (copy exactly): ${parenthetical}`,
			`   USE THIS NARRATIVE CITE: ${narrative}`,
			`   APA 7 reference: ${formatApa7Reference(paper)}`,
			`   Abstract: ${abstract}`,
		].join("\n");
	});

	const minRefsInstruction =
		papers.length >= minDistinctCites
			? `Cite and write from at least ${minDistinctCites} of these papers throughout literature-heavy body sections (prefer more when the bank is larger). References must list every bank paper cited in the body (≥${minDistinctCites} entries). Every References entry must appear as an in-text citation — no uncited padding.`
			: `Cite and write from all ${papers.length} of these papers in the body. References must list every bank paper cited in the body. Do not invent filler references. Every References entry must appear as an in-text citation.`;

	return [
		`${sourceLabel} retrieved ${papers.length} real paper(s) for the query "${query}".`,
		"Use these as primary literature sources. Insert in-text citations by copying the USE THIS CITE strings exactly. Do not invent author–years or reference numbers.",
		"Cite only papers with named authors and a four-digit year. Never write n.d., Unknown, or incomplete citations — skip undated papers and cite another bank paper.",
		"Every major factual claim needs an in-text citation from this bank.",
		"Cite only papers whose abstracts address the same field as the query. Do not analogize clinical, biomedical, or unrelated-domain findings to arts, humanities, or other off-field topics. If on-topic literature is thin, say so and write from the remaining on-topic abstracts.",
		"When the query concerns higher education, privilege papers marked as higher-education settings. Do not treat K-12, hospital, or generic workplace findings as university evidence.",
		"Claim discipline: never change the studied population from the title/abstract (e.g. do not describe a student survey as a faculty study). Do not cite perspective/commentary/agenda papers as empirical measurements of acceptance, performance, or efficiency. Do not generalise a single small-N or single-course finding into a field-wide effect; name the design and sample when the card states them. Reviews of prior studies are not evidence that ‘AI improves academic performance’ in general.",
		minRefsInstruction,
		"Paraphrase and synthesize bank abstracts into literature claims — do not pad the References list without in-text cites.",
		"In the References section, use APA 7: Author, A. A., & Author, B. B. (Year). Title. Journal (if known). URL. Copy the APA 7 reference line. Never mention preprint servers, repository names, or paper ID numbers.",
		"Do not invent papers outside this list.",
		protocol ? formatRetrievalProtocolBlock(protocol, query, papers) : "",
		"",
		...lines,
	]
		.filter((line, index, all) => line !== "" || all[index + 1] !== "")
		.join("\n");
}

export type PaperSearchSource =
	| "library"
	| "hybrid"
	| "alphaxiv"
	| "arxiv"
	| "openalex"
	| "pubmed"
	| "doaj"
	| "europepmc"
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
	doaj: "DOAJ",
	europepmc: "Europe PMC",
	"alphaxiv-mcp": "AlphaXiv MCP",
	tavily: "Tavily",
	none: "OpenAlex/PubMed/DOAJ/Europe PMC/AlphaXiv/arXiv/Tavily",
};

export type RetrievalProtocol = {
	query: string;
	searchedAt: string;
	identifiedBySource: Array<{ source: string; hits: number }>;
	identifiedTotal: number;
	afterDedup: number;
	afterEligibility: number;
	included: number;
	sourcesUsed: string[];
	yearMin: string | null;
	yearMax: string | null;
};

export type PaperSearchResult = {
	papers: AlphaXivPaper[];
	source: PaperSearchSource;
	protocol?: RetrievalProtocol;
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
		available: () => isOpenAlexEnabled(),
		search: searchOpenAlexPapers,
	},
	{
		source: "pubmed",
		available: () => isPubmedEnabled(),
		search: searchPubmedPapers,
	},
	{
		source: "doaj",
		available: () => isDoajEnabled(),
		search: searchDoajPapers,
	},
	{
		source: "europepmc",
		available: () => isEuropePmcEnabled(),
		search: searchEuropePmcPapers,
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
	"doaj",
	"europepmc",
]);

/** Biomedical sources preferred when the topic/discipline is health-related. */
const HEALTH_PREFERRED_SOURCES = new Set<LivePaperSource>(["pubmed", "europepmc"]);

const HEALTH_TOPIC_PATTERN =
	/\b(health|healthcare|medical|medicine|clinical|biomed|biomedical|nursing|pharma|pharmac|epidemiolog|public[\s-]?health|patient|hospital|disease|diagnos|therap|treatment|oncolog|cardio|mental[\s-]?health|psychiatr|psycholog|dental|veterinar|patholog|immunolog|genomic|genetics|surgery|radiolog|pediatr|obstetr|gynecol|nutrition|dietetic|physiotherap|occupational[\s-]?therap|kinesiolog|anatomy|physiolog|microbiolog|virolog|infectious|covid|cancer|diabetes|hypertens|stroke|alzheimer|dementia)\b/i;

const HEALTH_DISCIPLINE_IDS = new Set([
	"health-administration",
	"public-health",
	"biomedical-engineering",
	"medicine",
	"nursing",
	"pharmacy",
	"dentistry",
	"veterinary",
	"psychology",
	"psychiatry",
	"epidemiology",
	"nutrition",
	"physiotherapy",
	"occupational-therapy",
	"sports-science",
]);

export function parseDisciplineFromPrompt(text: string | null | undefined): string {
	return (text ?? "").match(/^Discipline:\s*(.+)$/im)?.[1]?.trim() ?? "";
}

export function buildLiteratureSearchQuery(parts: {
	topic?: string | null;
	discipline?: string | null;
}): string {
	const topic = (parts.topic ?? "").replace(/\s+/g, " ").trim();
	const discipline = (parts.discipline ?? "").replace(/\s+/g, " ").trim();
	let compact = topic.length > 240 ? topic.slice(0, 240) : topic;
	const haystack = `${compact} ${discipline}`;
	if (isHigherEducationTopic(haystack) && !/\bhigher education\b/i.test(compact)) {
		compact = `${compact} higher education university undergraduate`.trim();
	}
	return [compact, discipline].filter(Boolean).join(" ").trim();
}

const HIGHER_ED_PATTERN =
	/\b(higher education|universit(?:y|ies)|undergraduate|postgraduate|college students?|tertiary education|faculty members?|campus)\b/i;

export function isHigherEducationTopic(text: string | null | undefined): boolean {
	return HIGHER_ED_PATTERN.test(text ?? "");
}

export function paperLooksHigherEducation(paper: { title?: string; abstract?: string }): boolean {
	return HIGHER_ED_PATTERN.test(`${paper.title ?? ""} ${paper.abstract ?? ""}`);
}

export function preferHigherEducationPapers<T extends { title?: string; abstract?: string }>(
	papers: T[],
	preferHigherEd: boolean,
): T[] {
	if (!preferHigherEd || papers.length === 0) return papers;
	const he = papers.filter((paper) => paperLooksHigherEducation(paper));
	if (he.length === 0) return papers;
	const rest = papers.filter((paper) => !paperLooksHigherEducation(paper));
	if (he.length >= Math.min(10, papers.length)) return [...he, ...rest];
	return [...he, ...rest];
}

export function isHealthResearchTopic(text: string | null | undefined): boolean {
	const raw = (text ?? "").trim();
	if (!raw) return false;

	const disciplineLine = parseDisciplineFromPrompt(raw);
	const haystack = `${disciplineLine} ${raw}`.toLowerCase();

	if (HEALTH_TOPIC_PATTERN.test(haystack)) return true;

	for (const id of HEALTH_DISCIPLINE_IDS) {
		if (haystack.includes(id.replace(/-/g, " ")) || haystack.includes(id)) return true;
	}

	return false;
}

const CLINICAL_PAPER_PATTERN =
	/\b(dermatolog|dermoscopy|melanoma|thyroid|ultrasound|congenital heart|neoplasm|oncolog|radiolog|biopsy|fine-needle|patient cohort|clinical trial|hospitaliz|pediatric cardiolog|diabetes mellitus|hypertension|endocrin|cardiology|ophthalmolog)\b/i;

const OFF_FIELD_CLAIM_PATTERN =
	/\b(fine arts?|visual arts?|artistic|artist(?:s|ic)?|authorship|creativity|studio practice|aesthetic(?:s)?|gallery|museum|painting|sculpture|literary|poetry)\b/i;

export function paperLooksClinical(paper: { title?: string; abstract?: string }): boolean {
	return CLINICAL_PAPER_PATTERN.test(`${paper.title ?? ""} ${paper.abstract ?? ""}`);
}

export function citedClaimFieldMismatch(
	paper: { title?: string; abstract?: string },
	sentence: string,
): boolean {
	return (
		paperLooksClinical(paper) &&
		OFF_FIELD_CLAIM_PATTERN.test(sentence) &&
		!HEALTH_TOPIC_PATTERN.test(sentence)
	);
}

export function dropOffTopicPapers<T extends { title?: string; abstract?: string }>(
	papers: T[],
	preferHealth: boolean,
): T[] {
	if (preferHealth || papers.length === 0) return papers;
	const filtered = papers.filter((paper) => !paperLooksClinical(paper));
	return filtered.length >= Math.min(8, papers.length) ? filtered : papers;
}

export function looksLikeLiteratureReview(text: string | null | undefined): boolean {
	return /\b(systematic(?:\s+literature)?\s+review|scoping review|meta-analy|prisma|structured literature review)\b/i.test(
		text ?? "",
	);
}

function sourceDisplayName(source: string): string {
	return PAPER_SOURCE_LABELS[source as PaperSearchSource] ?? source;
}

export function inferEvidenceCard(paper: AlphaXivPaper): { type: string; population: string; sample: string } {
	const blob = `${paper.title}\n${paper.abstract ?? ""}`;
	let type = "Not classifiable from abstract — cite only what the abstract states";
	if (
		/\b(perspective|commentary|editorial|opinion piece|agenda for research|multidisciplinary perspectives)\b/i.test(
			blob,
		)
	) {
		type = "Perspective / commentary / agenda — NOT an empirical measurement study";
	} else if (/\b(systematic review|meta-analy|scoping review)\b/i.test(blob)) {
		type = "Review of prior studies (not a new primary experiment)";
	} else if (/\brandomi[sz]ed\b|\bRCT\b|\brandomised controlled\b/i.test(blob)) {
		type = "Randomised / controlled experiment (from abstract)";
	} else if (/\bquasi-experiment/i.test(blob)) {
		type = "Quasi-experiment (from abstract)";
	} else if (/\bsurvey(?:ed|s)?\b|\bquestionnaire\b|\bstructural equation\b/i.test(blob)) {
		type = "Survey / quantitative perception study (from abstract)";
	} else if (/\binterview|\bqualitative\b|\bfocus group/i.test(blob)) {
		type = "Qualitative (from abstract)";
	} else if (/\bconceptual\b|\btheoretical framework\b/i.test(blob)) {
		type = "Conceptual / theoretical (from abstract)";
	}

	const populations: string[] = [];
	if (/\bfaculty\b|\bteachers?\b|\beducators?\b|\binstructors?\b/i.test(blob)) {
		populations.push("faculty/educators");
	}
	if (/\bstudents?\b|\bundergraduates?\b|\bpostgraduates?\b|\blearners?\b/i.test(blob)) {
		populations.push("students");
	}
	if (/\badministrat/i.test(blob)) populations.push("administration");
	const population =
		populations.length > 0
			? populations.join("; ")
			: "Not named in title/abstract — do not invent a population";

	const sampleMatch =
		blob.match(
			/\b(\d{1,4}(?:,\d{3})?)\s+(?:[\w'-]+(?:\s+[\w'-]+){0,8}\s+)?(?:students|participants|respondents|faculty|teachers)\b/i,
		) ||
		blob.match(/\bn\s*=\s*(\d{1,5})/i) ||
		blob.match(/\bsurveyed\s+(\d{1,4}(?:,\d{3})?)/i);
	const sample = sampleMatch
		? sampleMatch[0].replace(/\s+/g, " ")
		: "Not stated in abstract — do not invent a sample size";

	return { type, population, sample };
}

function corpusYearRange(papers: AlphaXivPaper[]): { yearMin: string | null; yearMax: string | null } {
	const years = papers
		.map((paper) => citeYear(paper))
		.filter((year) => year !== "n.d.");
	if (years.length === 0) return { yearMin: null, yearMax: null };
	return {
		yearMin: years.reduce((min, year) => (year < min ? year : min)),
		yearMax: years.reduce((max, year) => (year > max ? year : max)),
	};
}

function finalizeProtocol(
	protocol: RetrievalProtocol | undefined,
	papers: AlphaXivPaper[],
): RetrievalProtocol | undefined {
	if (!protocol) return undefined;
	const years = corpusYearRange(papers);
	return {
		...protocol,
		included: papers.length,
		yearMin: years.yearMin,
		yearMax: years.yearMax,
	};
}

export function formatSelectionFlowTable(protocol: RetrievalProtocol): string {
	return [
		"| Stage | n |",
		"| --- | ---: |",
		`| Records identified across listed APIs | ${protocol.identifiedTotal} |`,
		`| After deduplication | ${protocol.afterDedup} |`,
		`| After eligibility (topic filter) | ${protocol.afterEligibility} |`,
		`| Included in this document's working corpus | ${protocol.included} |`,
	].join("\n");
}

export function formatExtractionTable(papers: AlphaXivPaper[]): string {
	const rows = papers.slice(0, 18).map((paper) => {
		const names = paper.authors.length ? formatAuthorLine(paper.authors.slice(0, 1), 1) : "Unknown";
		const year = citeYear(paper);
		const card = inferEvidenceCard(paper);
		const title = cleanReferenceTitle(paper.title.replace(/\|/g, "/")).slice(0, 80);
		return `| ${names} (${year}). ${title} | ${card.type} | ${card.population} | ${card.sample} |`;
	});
	const extra =
		papers.length > 18
			? `\nRemaining ${papers.length - 18} included papers appear in References; do not invent extra rows.`
			: "";
	return [
		"| Study | Evidence type (from title/abstract) | Population named | Sample (from abstract only) |",
		"| --- | --- | --- | --- |",
		...rows,
	].join("\n") + extra;
}

export function formatSearchedApis(protocol: RetrievalProtocol): string {
	return protocol.sourcesUsed.map(sourceDisplayName).join(", ") || "the retrieved scholarly APIs";
}

function formatRetrievalProtocolBlock(
	protocol: RetrievalProtocol,
	query: string,
	papers: AlphaXivPaper[],
): string {
	const apis = protocol.sourcesUsed.map(sourceDisplayName).join(", ") || "none";
	const perSource = protocol.identifiedBySource
		.map((row) => `${sourceDisplayName(row.source)} ${row.hits}`)
		.join("; ");
	const years =
		protocol.yearMin && protocol.yearMax
			? `${protocol.yearMin}–${protocol.yearMax}`
			: "not stated";
	const review = looksLikeLiteratureReview(query);
	return [
		"RETRIEVAL PROTOCOL — if Methodology describes a literature search, copy these facts. Do not invent others.",
		`- Search date/time (UTC): ${protocol.searchedAt}`,
		`- Query: "${protocol.query}"`,
		`- Databases/APIs actually searched: ${apis}`,
		`- Records returned per source: ${perSource || "none"}`,
		`- Records identified (sum): ${protocol.identifiedTotal}`,
		`- After deduplication: ${protocol.afterDedup}`,
		`- After eligibility (topic filter): ${protocol.afterEligibility}`,
		`- Included in this document's working corpus: ${protocol.included}`,
		`- Publication years in corpus: ${years}`,
		"HARD RULES: Do NOT claim Web of Science, Scopus, ERIC, IEEE Xplore, PubMed, or any other database unless listed above. Do NOT invent hit counts, duplicate counts, screening counts, or exclusion reasons. Do NOT claim multiple independent human reviewers, kappa/inter-rater agreement, CASP/MMAT appraisal, or a registered PRISMA 2020 review.",
		"You MAY describe this as a structured review of the retrieved corpus, informed by PRISMA reporting items (identification → deduplication → eligibility → inclusion), using only the numbers above.",
		review
			? "This topic is a literature review. Methodology MUST be this retrieval protocol (not a primary empirical study). Do not present the paper as a completed PRISMA systematic review unless you also state these limitations. Avoid causal titles such as “The Impact of…” unless the corpus is mostly experimental. Results must synthesise the corpus (“Of the N included records…”), not retell papers one-by-one. Include the selection-flow table and the extraction table."
			: "If this document is not a literature review, write primary methods from the outline — still do not invent a Scopus/WoS/PRISMA search.",
		"Selection-flow table (include in Methodology when describing the search):",
		formatSelectionFlowTable(protocol),
		"Study extraction table (include when the document is a review; do not add designs, populations, or sample sizes that are not on the evidence cards):",
		formatExtractionTable(papers),
	].join("\n");
}

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

function sourceWeight(source: LivePaperSource, preferHealth: boolean): number {
	if (preferHealth) {
		if (source === "pubmed") return 4;
		if (source === "europepmc") return 3;
		return 1;
	}
	if (source === "pubmed" || source === "europepmc") return 0;
	if (source === "openalex" || source === "doaj") return 2;
	return 1;
}

/** Round-robin merge; optional health weighting pulls more PubMed / Europe PMC into the bank. */
function interleaveUniquePapers(
	batches: Array<{ source: LivePaperSource; papers: AlphaXivPaper[] }>,
	limit: number,
	preferHealth = false,
): { papers: AlphaXivPaper[]; sourcesUsed: LivePaperSource[] } {
	const seen = new Set<string>();
	const out: AlphaXivPaper[] = [];
	const sourcesUsed: LivePaperSource[] = [];
	const queues = batches
		.filter((batch) => batch.papers.length > 0 && sourceWeight(batch.source, preferHealth) > 0)
		.map((batch) => ({
			source: batch.source,
			papers: [...batch.papers],
			weight: sourceWeight(batch.source, preferHealth),
			takenInCycle: 0,
		}));

	while (out.length < limit && queues.length > 0) {
		let progressed = false;
		for (let i = 0; i < queues.length && out.length < limit; ) {
			const queue = queues[i]!;
			if (queue.takenInCycle >= queue.weight) {
				i += 1;
				continue;
			}
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
			queue.takenInCycle += 1;
			progressed = true;
			if (!sourcesUsed.includes(queue.source)) sourcesUsed.push(queue.source);
			i += 1;
		}
		if (!progressed) break;
		/** Reset cycle counters when every live queue hit its weight quota (or emptied). */
		const allQuotaMet = queues.every((q) => q.papers.length === 0 || q.takenInCycle >= q.weight);
		if (allQuotaMet) {
			for (const q of queues) q.takenInCycle = 0;
		}
	}

	return { papers: out, sourcesUsed };
}

/**
 * Mix research APIs into the citation bank (references + in-text cites).
 * Health topics overweight PubMed + Europe PMC while still mixing other scholarly sources.
 */
async function fetchPapersFromExternalApis(
	query: string,
	options?: { limit?: number; signal?: AbortSignal; preferHealth?: boolean },
): Promise<PaperSearchResult> {
	const limit = options?.limit ?? DEFAULT_LIMIT;
	const preferHealth = Boolean(options?.preferHealth) || isHealthResearchTopic(query);
	const all = availableProviders();
	if (all.length === 0) {
		return {
			papers: [],
			source: "none",
			protocol: {
				query,
				searchedAt: new Date().toISOString(),
				identifiedBySource: [],
				identifiedTotal: 0,
				afterDedup: 0,
				afterEligibility: 0,
				included: 0,
				sourcesUsed: [],
				yearMin: null,
				yearMax: null,
			},
		};
	}

	const started = Date.now();
	const coreAvailable = all.filter((p) => CORE_SCHOLARLY_SOURCES.has(p.source));
	const fallbacks = shuffleProviders(all.filter((p) => !CORE_SCHOLARLY_SOURCES.has(p.source)));

	let mixTargets: LiteratureProvider[];
	if (preferHealth && coreAvailable.length > 0) {
		const healthFirst = shuffleProviders(
			coreAvailable.filter((p) => HEALTH_PREFERRED_SOURCES.has(p.source)),
		);
		const others = shuffleProviders(
			coreAvailable.filter((p) => !HEALTH_PREFERRED_SOURCES.has(p.source)),
		);
		mixTargets = [...healthFirst, ...others];
	} else {
		const scholarlyNonHealth = coreAvailable.filter(
			(p) => !HEALTH_PREFERRED_SOURCES.has(p.source),
		);
		mixTargets =
			scholarlyNonHealth.length > 0
				? shuffleProviders(scholarlyNonHealth)
				: coreAvailable.length > 0
					? shuffleProviders(coreAvailable)
					: shuffleProviders(all).slice(0, Math.min(2, all.length));
	}

	const settled = await Promise.all(
		mixTargets.map((provider) => {
			const weight = sourceWeight(provider.source, preferHealth);
			const perProviderLimit = preferHealth
				? Math.min(
						limit,
						Math.max(
							Math.ceil((limit * weight) / (preferHealth ? 8 : mixTargets.length)) + 2,
							provider.source === "pubmed" || provider.source === "europepmc" ? 16 : 8,
						),
					)
				: Math.max(
						Math.ceil(limit / Math.max(mixTargets.length, 1)) + 2,
						Math.min(limit, 12),
					);
			return provider
				.search(query, { ...options, limit: perProviderLimit })
				.then((papers) => ({ source: provider.source, papers }))
				.catch(() => ({ source: provider.source, papers: [] as AlphaXivPaper[] }));
		}),
	);

	const mixed = interleaveUniquePapers(settled, limit, preferHealth);
	const afterDedup = mixed.papers.length;
	let { papers, sourcesUsed } = mixed;
	papers = dropOffTopicPapers(papers, preferHealth);

	let identifiedBySource = settled
		.filter((batch) => batch.papers.length > 0)
		.map((batch) => ({ source: batch.source, hits: batch.papers.length }));
	let identifiedTotal = settled.reduce((sum, batch) => sum + batch.papers.length, 0);

	console.info(
		`[literature] mix-apis query="${query.slice(0, 80)}" limit=${limit} health=${preferHealth} cores=${mixTargets.map((p) => p.source).join("+")} hits=${settled.map((s) => `${s.source}:${s.papers.length}`).join(",")} mixed=${papers.length}`,
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
			identifiedBySource.push({ source: batch.source, hits: batch.papers.length });
			identifiedTotal += batch.papers.length;
			if (!sourcesUsed.includes(batch.source)) sourcesUsed.push(batch.source);
			for (const paper of batch.papers) {
				if (papers.length >= limit) break;
				const key = paperDedupKey(paper);
				if (seen.has(key)) continue;
				seen.add(key);
				papers.push(paper);
			}
		}
		papers = dropOffTopicPapers(papers, preferHealth);
	}

	const source: PaperSearchSource =
		sourcesUsed.length > 1 ? "hybrid" : (sourcesUsed[0] ?? "none");
	console.info(
		`[literature] mixed-api query="${query.slice(0, 80)}" limit=${limit} health=${preferHealth} got=${papers.length} source=${source} used=${sourcesUsed.join("+")} ms=${Date.now() - started}`,
	);
	return {
		papers,
		source,
		protocol: finalizeProtocol(
			{
				query,
				searchedAt: new Date().toISOString(),
				identifiedBySource,
				identifiedTotal,
				afterDedup,
				afterEligibility: papers.length,
				included: papers.length,
				sourcesUsed,
				yearMin: null,
				yearMax: null,
			},
			papers,
		),
	};
}

export async function fetchPapersForQueryDetailed(
	query: string,
	options?: { limit?: number; signal?: AbortSignal; preferHealth?: boolean },
): Promise<PaperSearchResult> {
	const trimmed = query.trim();
	if (!trimmed) return { papers: [], source: "none" };

	const limit = options?.limit ?? DEFAULT_LIMIT;
	const preferHealth = Boolean(options?.preferHealth) || isHealthResearchTopic(trimmed);
	/** Large citation banks must mix live APIs — library alone is usually one historical source. */
	const requireLiveMix = limit >= 25;

	/** 1) Library-first RAG — reuse previously retrieved publications (small banks only). */
	const libraryPapers = isPaperLibraryEnabled()
		? await searchPaperLibrary(trimmed, { limit })
		: [];

	if (!requireLiveMix && libraryHasEnoughHits(libraryPapers.length, limit)) {
		const papers = dropOffTopicPapers(libraryPapers.slice(0, limit), preferHealth);
		return {
			papers,
			source: "library",
			protocol: finalizeProtocol(
				{
					query: trimmed,
					searchedAt: new Date().toISOString(),
					identifiedBySource: [{ source: "library", hits: libraryPapers.length }],
					identifiedTotal: libraryPapers.length,
					afterDedup: libraryPapers.length,
					afterEligibility: papers.length,
					included: papers.length,
					sourcesUsed: ["library"],
					yearMin: null,
					yearMax: null,
				},
				papers,
			),
		};
	}

	/** 2) Live APIs — always for large banks; otherwise when the library is thin. */
	const external = await fetchPapersFromExternalApis(trimmed, {
		...options,
		limit,
		preferHealth,
	});

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
		const papers = dropOffTopicPapers(external.papers, preferHealth);
		return {
			...external,
			papers,
			protocol: finalizeProtocol(external.protocol, papers),
		};
	}

	const merged = mergeUniquePapers(
		requireLiveMix ? external.papers : libraryPapers,
		requireLiveMix ? libraryPapers : external.papers,
		limit,
	);
	const papers = dropOffTopicPapers(merged, preferHealth);
	const protocol = external.protocol;
	return {
		papers,
		source: external.papers.length > 0 ? (libraryPapers.length > 0 ? "hybrid" : external.source) : "library",
		protocol: finalizeProtocol(
			protocol
				? {
						...protocol,
						identifiedBySource: [
							...protocol.identifiedBySource,
							{ source: "library", hits: libraryPapers.length },
						],
						identifiedTotal: protocol.identifiedTotal + libraryPapers.length,
						afterDedup: merged.length,
						afterEligibility: papers.length,
					}
				: undefined,
			papers,
		),
	};
}

export async function fetchPapersForQuery(
	query: string,
	options?: { limit?: number; signal?: AbortSignal; preferHealth?: boolean },
): Promise<AlphaXivPaper[]> {
	const result = await fetchPapersForQueryDetailed(query, options);
	return result.papers;
}

export async function buildPaperSearchContext(
	query: string,
	options?: {
		limit?: number;
		signal?: AbortSignal;
		scope?: ResearchScope | string | null;
		minDistinctCites?: number;
		preferHealth?: boolean;
		/** Extra text (e.g. Discipline: line) used only for health-topic detection. */
		healthHint?: string | null;
		citationStyle?: string | null;
	},
): Promise<{
	context: string;
	papers: AlphaXivPaper[];
	source: PaperSearchSource;
	protocol?: RetrievalProtocol;
} | null> {
	const trimmed = query.trim();
	if (!trimmed) return null;

	const profile = getScopeProfile(options?.scope);
	const minDistinctCites = options?.minDistinctCites ?? profile.minDistinctCites;
	const limit = options?.limit ?? Math.max(30, minDistinctCites);
	const preferHealth =
		Boolean(options?.preferHealth) ||
		isHealthResearchTopic(trimmed) ||
		isHealthResearchTopic(options?.healthHint);

	const fetched = await fetchPapersForQueryDetailed(trimmed, {
		limit,
		signal: options?.signal,
		preferHealth,
	});
	const papers = preferHigherEducationPapers(
		dropOffTopicPapers(
			await rerankPapers(trimmed, fetched.papers, { signal: options?.signal }),
			preferHealth,
		),
		isHigherEducationTopic(trimmed) || isHigherEducationTopic(options?.healthHint),
	);
	const citable = papers.filter(paperIsCitable);
	const bank = citable.length >= Math.min(8, papers.length) ? citable : papers;
	const protocol = finalizeProtocol(
		fetched.protocol
			? { ...fetched.protocol, afterEligibility: fetched.protocol.afterEligibility }
			: undefined,
		bank,
	);
	const sourceLabel = PAPER_SOURCE_LABELS[fetched.source];

	return {
		papers: bank,
		source: fetched.source,
		protocol,
		context: formatPapersForContext(
			bank,
			trimmed,
			sourceLabel,
			minDistinctCites,
			options?.citationStyle,
			protocol,
		),
	};
}

export function shouldUseAlphaXiv(workflow?: string | null): boolean {
	if (!workflow) return false;
	return ALPHAXIV_RESEARCH_WORKFLOWS.has(workflow.replace(/^\//, ""));
}
