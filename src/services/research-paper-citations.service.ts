/**
 * In-text citation targets and enforcement for /research (chat-paper).
 * Distinct author–year (or numeric) cites per IMRaD section.
 * When a literature bank is present, cites must resolve to bank keys and
 * References are rebuilt from those entries.
 */

import type { CitationBankEntry } from "./alphaxiv.service.js";

export type { CitationBankEntry };

export const CHAT_PAPER_CITATION_FLOORS: Record<string, number> = {
	Abstract: 0,
	Keywords: 0,
	"Study area": 0,
	Introduction: 8,
	"Literature Review": 10,
	Methodology: 4,
	"Results / Analysis": 3,
	Discussion: 8,
	Conclusion: 3,
};

/** Sections that must carry in-text citations. */
export const CHAT_PAPER_CITING_SECTIONS = [
	"Introduction",
	"Literature Review",
	"Methodology",
	"Results / Analysis",
	"Discussion",
	"Conclusion",
] as const;

/** Soft upper bound when the retrieval bank is large enough. */
export const CHAT_PAPER_REFERENCES_TARGET = { min: 20, max: 30 } as const;

const SECTION_HEADING =
	/^(?:#{1,6}\s+|\*\*)(Abstract|Keywords|Study area|Introduction|Literature Review|Methodology|Results\s*\/\s*Analysis|Results and Analysis|Discussion|Conclusion|References)(?:\*\*)?\s*$/gim;

const REFERENCES_HEADING_LINE = /^(?:#{1,6}\s+|\*\*)References(?:\*\*)?\s*$/im;

const PAREN_CITE =
	/\(\s*[A-ZÀ-ÖØ-Þ][^)]{0,120}?\b(?:19|20)\d{2}[a-z]?\b[^)]*?\)/g;
const NARRATIVE_CITE =
	/\b[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ''\-]+(?:\s+et\s+al\.?|\s+(?:and|&)\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ''\-]+)?\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g;
const NUMERIC_CITE = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;

export type SectionCiteCount = {
	section: string;
	count: number;
	floor: number;
	ok: boolean;
};

export type CiteBankAlignment = {
	bodyKeys: string[];
	matchedKeys: string[];
	unknownKeys: string[];
	missingFromRefs: string[];
	ok: boolean;
};

export type CitationAudit = {
	sections: SectionCiteCount[];
	totalBodyCites: number;
	referenceEntries: number;
	referenceFloor: number;
	referencesOk: boolean;
	failedSections: string[];
	alignment: CiteBankAlignment | null;
	ok: boolean;
};

function canonicalizeHeading(raw: string): string {
	const key = raw
		.replace(/\*\*/g, "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/\s*\/\s*/g, " / ");
	const map: Record<string, string> = {
		abstract: "Abstract",
		keywords: "Keywords",
		"study area": "Study area",
		introduction: "Introduction",
		"literature review": "Literature Review",
		methodology: "Methodology",
		methods: "Methodology",
		"results / analysis": "Results / Analysis",
		"results and analysis": "Results / Analysis",
		results: "Results / Analysis",
		discussion: "Discussion",
		conclusion: "Conclusion",
		conclusions: "Conclusion",
		references: "References",
	};
	return map[key] ?? raw.replace(/\*\*/g, "").trim();
}

/** Split markdown paper into section name → body text. */
export function splitResearchPaperSections(content: string): Map<string, string> {
	const sections = new Map<string, string>();
	const text = content.replace(/\r/g, "");
	const matches: Array<{ name: string; index: number; end: number }> = [];

	SECTION_HEADING.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = SECTION_HEADING.exec(text))) {
		matches.push({
			name: canonicalizeHeading(m[1] ?? ""),
			index: m.index,
			end: m.index + m[0].length,
		});
	}

	if (matches.length === 0) {
		sections.set("Introduction", text);
		return sections;
	}

	for (let i = 0; i < matches.length; i++) {
		const cur = matches[i]!;
		const next = matches[i + 1];
		const body = text.slice(cur.end, next ? next.index : text.length).trim();
		const prev = sections.get(cur.name);
		sections.set(cur.name, prev ? `${prev}\n\n${body}` : body);
	}

	return sections;
}

function plainForCiteMatch(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\[[^\]]*\]\([^)]+\)/g, (link) => {
			const label = link.match(/^\[([^\]]*)\]/);
			return label?.[1] ?? " ";
		})
		.replace(/[*_`#]/g, "");
}

/** Distinct in-text citation keys in a body fragment. */
export function countDistinctInTextCitations(text: string): number {
	return extractInTextCiteKeys(text).length || countLegacyDistinctCites(text);
}

/** Fallback when author–year parse yields nothing but numeric/paren noise remains. */
function countLegacyDistinctCites(text: string): number {
	const hay = plainForCiteMatch(text);
	const keys = new Set<string>();

	for (const match of hay.matchAll(PAREN_CITE)) {
		const raw = match[0].replace(/\s+/g, " ").trim().toLowerCase();
		keys.add(`p:${raw}`);
	}
	for (const match of hay.matchAll(NARRATIVE_CITE)) {
		const raw = match[0].replace(/\s+/g, " ").trim().toLowerCase();
		keys.add(`n:${raw}`);
	}
	for (const match of hay.matchAll(NUMERIC_CITE)) {
		const inner = match[1] ?? "";
		for (const part of inner.split(/[,–-]/)) {
			const n = part.trim();
			if (/^\d+$/.test(n)) keys.add(`num:${n}`);
		}
	}

	return keys.size;
}

function normalizeCiteKeyPart(surname: string, year: string): string {
	const sur = surname
		.toLowerCase()
		.replace(/[^a-zà-öø-ÿ'\-]/gi, "")
		.trim();
	const y = year.toLowerCase().trim();
	return `${sur}|${y}`;
}

/**
 * Extract normalized `surname|year` keys from author–date in-text citations.
 */
export function extractInTextCiteKeys(text: string): string[] {
	const hay = plainForCiteMatch(text);
	const keys = new Set<string>();

	for (const match of hay.matchAll(PAREN_CITE)) {
		const inner = match[0].slice(1, -1);
		const yearMatch = inner.match(/\b((?:19|20)\d{2}[a-z]?|n\.d\.)\b/i);
		if (!yearMatch || yearMatch.index === undefined) continue;
		const year = yearMatch[1]!;
		const authorPart = inner.slice(0, yearMatch.index).replace(/[,;\s]+$/g, "").trim();
		const firstAuthor = authorPart.split(/\s*(?:,|&|\band\b|et\s+al\.?)\s*/i)[0]?.trim() ?? "";
		const surname = firstAuthor.split(/\s+/).pop() ?? firstAuthor;
		if (surname.length >= 2) keys.add(normalizeCiteKeyPart(surname, year));
	}

	for (const match of hay.matchAll(NARRATIVE_CITE)) {
		const raw = match[0];
		const yearMatch = raw.match(/\(\s*((?:19|20)\d{2}[a-z]?)\s*\)/i);
		if (!yearMatch || yearMatch.index === undefined) continue;
		const year = yearMatch[1]!;
		const authorPart = raw.slice(0, yearMatch.index).trim();
		const firstAuthor =
			authorPart.split(/\s+(?:et\s+al\.?|and|&)\s+/i)[0]?.trim() ?? authorPart;
		const surname = firstAuthor.split(/\s+/).pop() ?? firstAuthor;
		if (surname.length >= 2) keys.add(normalizeCiteKeyPart(surname, year));
	}

	return [...keys];
}

/** Body in-text keys only (excludes the References section). */
export function extractBodyInTextCiteKeys(content: string): string[] {
	const parts = splitResearchPaperSections(content);
	const keys = new Set<string>();
	for (const section of CHAT_PAPER_CITING_SECTIONS) {
		for (const key of extractInTextCiteKeys(parts.get(section) ?? "")) {
			keys.add(key);
		}
	}
	// Also scan any leftover prose before References that isn't a named section.
	const intro = parts.get("Introduction");
	if (!intro) {
		for (const key of extractInTextCiteKeys(content)) keys.add(key);
	}
	return [...keys];
}

/** Map a raw body cite key onto a bank entry key when possible. */
export function resolveToBankKey(
	rawKey: string,
	bank: CitationBankEntry[],
): string | null {
	const lower = rawKey.toLowerCase();
	const exact = bank.find((e) => e.citeKey === lower);
	if (exact) return exact.citeKey;

	const [sur, year] = lower.split("|");
	if (!sur || !year) return null;
	const baseYear = year.replace(/[a-z]$/i, "");

	const candidates = bank.filter(
		(e) =>
			e.surname.toLowerCase() === sur &&
			e.year.replace(/[a-z]$/i, "").toLowerCase() === baseYear,
	);
	if (candidates.length === 1) return candidates[0]!.citeKey;
	const letterMatch = candidates.find((e) => e.year.toLowerCase() === year);
	return letterMatch?.citeKey ?? null;
}

export function formatBankDumpForPrompt(bank: CitationBankEntry[]): string {
	if (!bank.length) return "(empty literature bank)";
	return bank
		.map((e, i) => {
			const abstract = e.abstract?.trim()
				? e.abstract.replace(/\s+/g, " ").slice(0, 600)
				: "Abstract unavailable — cite only for the title theme, cautiously.";
			return [
				`${i + 1}. Cite as ${e.inTextParen}`,
				`   ${e.referenceLine}`,
				`   Abstract: ${abstract}`,
			].join("\n");
		})
		.join("\n");
}

/** Remove in-text citations from the Abstract section only (zero-cite policy). */
export function stripInTextCitationsFromAbstract(content: string): string {
	const text = content.replace(/\r/g, "");
	const headingRe =
		/^(?:#{1,6}\s+|\*\*)Abstract(?:\*\*)?\s*$/im;
	const nextHeadingRe =
		/^(?:#{1,6}\s+|\*\*)(Keywords|Study area|Introduction|Literature Review|Methodology|Results\s*\/\s*Analysis|Results and Analysis|Discussion|Conclusion|References)(?:\*\*)?\s*$/im;

	const absMatch = text.match(headingRe);
	if (!absMatch || absMatch.index === undefined) return content;

	const afterHeading = absMatch.index + absMatch[0].length;
	const rest = text.slice(afterHeading);
	const nextMatch = rest.match(nextHeadingRe);
	const absBodyEnd = nextMatch?.index !== undefined ? afterHeading + nextMatch.index : text.length;
	const absBody = text.slice(afterHeading, absBodyEnd);

	const cleanedBody = absBody
		.replace(PAREN_CITE, "")
		.replace(NARRATIVE_CITE, (m) => {
			// Keep author name, drop the year parenthesis when it's a narrative cite.
			return m.replace(/\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)/i, "");
		})
		.replace(NUMERIC_CITE, "")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/ +\./g, ".")
		.replace(/ +,/g, ",");

	return `${text.slice(0, afterHeading)}${cleanedBody}${text.slice(absBodyEnd)}`;
}

export type CitedSentence = {
	section: string;
	sentence: string;
	citeKeys: string[];
};

/** Extract sentences that carry in-text citations from body citing sections. */
export function extractCitedSentences(content: string): CitedSentence[] {
	const parts = splitResearchPaperSections(content);
	const out: CitedSentence[] = [];

	for (const section of CHAT_PAPER_CITING_SECTIONS) {
		const body = parts.get(section) ?? "";
		if (!body.trim()) continue;
		const sentences = body
			.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ"'])/)
			.map((s) => s.trim())
			.filter((s) => s.length > 20);
		for (const sentence of sentences) {
			const citeKeys = extractInTextCiteKeys(sentence);
			if (citeKeys.length > 0) {
				out.push({ section, sentence, citeKeys });
			}
		}
	}
	return out;
}

function paperHasMajorSections(content: string): boolean {
	const parts = splitResearchPaperSections(content);
	const required = ["Abstract", "Introduction", "Literature Review", "References"] as const;
	return required.every((name) => (parts.get(name) ?? "").trim().length > 20);
}

/**
 * Replace References with APA lines from the bank for keys cited in the body.
 * If the body cites nothing from the bank yet, list the full bank so the model
 * (and readers) still have real sources — citation_fix should then cite them.
 */
export function rebuildReferencesFromBank(
	content: string,
	bank: CitationBankEntry[],
): string {
	if (!bank.length) return content;

	const bodyKeys = extractBodyInTextCiteKeys(content);
	const matched = new Set<string>();
	for (const key of bodyKeys) {
		const resolved = resolveToBankKey(key, bank);
		if (resolved) matched.add(resolved);
	}

	const entries =
		matched.size > 0
			? bank.filter((e) => matched.has(e.citeKey))
			: [...bank];

	entries.sort(
		(a, b) =>
			a.surname.localeCompare(b.surname, undefined, { sensitivity: "base" }) ||
			a.year.localeCompare(b.year),
	);

	const refsBody = entries.map((e) => e.referenceLine).join("\n\n");
	return spliceReferencesSection(content, refsBody);
}

export function auditCiteBankAlignment(
	content: string,
	bank: CitationBankEntry[],
): CiteBankAlignment {
	if (!bank.length) {
		return {
			bodyKeys: [],
			matchedKeys: [],
			unknownKeys: [],
			missingFromRefs: [],
			ok: true,
		};
	}

	const bodyKeys = extractBodyInTextCiteKeys(content);
	const matchedKeys: string[] = [];
	const unknownKeys: string[] = [];

	for (const key of bodyKeys) {
		const resolved = resolveToBankKey(key, bank);
		if (resolved) matchedKeys.push(resolved);
		else unknownKeys.push(key);
	}

	const uniqueMatched = [...new Set(matchedKeys)];
	const refsBody = (splitResearchPaperSections(content).get("References") ?? "").toLowerCase();
	const missingFromRefs = uniqueMatched.filter((key) => {
		const entry = bank.find((e) => e.citeKey === key);
		if (!entry) return true;
		const sur = entry.surname.toLowerCase();
		const yearNum = entry.year.replace(/[a-z]$/i, "").toLowerCase();
		const titleBit = entry.title.toLowerCase().slice(0, 24);
		const hasAuthorYear = refsBody.includes(sur) && refsBody.includes(yearNum);
		const hasTitle = titleBit.length > 8 && refsBody.includes(titleBit);
		return !(hasAuthorYear || hasTitle);
	});

	return {
		bodyKeys,
		matchedKeys: uniqueMatched,
		unknownKeys: [...new Set(unknownKeys)],
		missingFromRefs,
		ok: unknownKeys.length === 0 && missingFromRefs.length === 0,
	};
}

function looksLikeReferenceEntry(line: string): boolean {
	const t = line.trim();
	if (t.length < 12) return false;
	if (/^\d+\.\s+/.test(t)) return true;
	if (/^\[\d+\]/.test(t)) return true;
	if (/\(\d{4}[a-z]?\)/.test(t)) return true;
	if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(t) && t.length > 20) return true;
	return false;
}

export function countReferenceEntries(referencesBody: string): number {
	const lines = referencesBody
		.split(/\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	let count = 0;
	for (const line of lines) {
		if (looksLikeReferenceEntry(line)) count += 1;
	}
	return count;
}

/**
 * How many literature sources were injected into the system prompt.
 * Used to scale floors when the bank is smaller than the strong targets.
 */
export function estimateLiteratureBankSize(systemContent: string): number {
	const retrieved = systemContent.match(
		/retrieved\s+(\d+)\s+real\s+paper/i,
	);
	if (retrieved?.[1]) return Number(retrieved[1]);

	const numbered = systemContent.match(/^\s*\d+\.\s+\*\*/gm);
	if (numbered && numbered.length > 0) return numbered.length;

	if (/literature retrieval failed/i.test(systemContent)) return 0;
	if (/No papers were found/i.test(systemContent)) return 0;

	// Literature block present but uncounted — assume a usable bank.
	if (/\[(?:Paper library|arXiv|AlphaXiv|Tavily|literature)/i.test(systemContent)) {
		return 20;
	}
	return 0;
}

export function floorForSection(section: string, bankSize: number): number {
	const base = CHAT_PAPER_CITATION_FLOORS[section] ?? 0;
	if (base <= 0) return 0;
	if (bankSize <= 0) {
		// No retrieval bank — do not require invented citations.
		return 0;
	}
	return Math.min(base, bankSize);
}

/** Minimum bibliography size given the literature retrieval bank. */
export function floorForReferences(bankSize: number): number {
	if (bankSize <= 0) return 0;
	return Math.min(CHAT_PAPER_REFERENCES_TARGET.min, Math.max(5, bankSize));
}

export function auditChatPaperCitations(
	content: string,
	bankSize = 25,
	bank: CitationBankEntry[] = [],
): CitationAudit {
	const effectiveBankSize = bank.length > 0 ? bank.length : bankSize;
	const parts = splitResearchPaperSections(content);
	const sections: SectionCiteCount[] = [];
	let totalBodyCites = 0;

	for (const section of CHAT_PAPER_CITING_SECTIONS) {
		const body = parts.get(section) ?? "";
		const count = body.trim() ? countDistinctInTextCitations(body) : 0;
		const floor = floorForSection(section, effectiveBankSize);
		const ok = count >= floor;
		sections.push({ section, count, floor, ok });
		totalBodyCites += count;
	}

	const referenceEntries = countReferenceEntries(parts.get("References") ?? "");
	const referenceFloor = floorForReferences(effectiveBankSize);
	const truncatedBibliography = referenceEntries <= 2 && totalBodyCites >= 8;
	const alignment = bank.length > 0 ? auditCiteBankAlignment(content, bank) : null;

	// With a bank, References must cover matched body cites (rebuild handles the list).
	const referencesOk =
		bank.length > 0
			? referenceEntries >= Math.min(referenceFloor, Math.max(alignment?.matchedKeys.length ?? 0, 1)) &&
				!truncatedBibliography &&
				(alignment?.missingFromRefs.length ?? 0) === 0
			: referenceEntries >= referenceFloor && !truncatedBibliography;

	const failedSections = sections.filter((s) => !s.ok).map((s) => s.section);
	const alignmentOk = !alignment || alignment.ok;
	const ok = failedSections.length === 0 && referencesOk && alignmentOk;

	return {
		sections,
		totalBodyCites,
		referenceEntries,
		referenceFloor,
		referencesOk,
		failedSections,
		alignment,
		ok,
	};
}

/** Replace (or append) the References section body while keeping the rest of the paper. */
export function spliceReferencesSection(content: string, referencesBody: string): string {
	const body = referencesBody.trim();
	const headingMatch = content.match(REFERENCES_HEADING_LINE);
	if (!headingMatch || headingMatch.index === undefined) {
		return `${content.trimEnd()}\n\n**References**\n\n${body}`.trim();
	}
	return `${content.slice(0, headingMatch.index).trimEnd()}\n\n**References**\n\n${body}`.trim();
}

/** Prefer the richer References block when a rewrite collapses the bibliography. */
export function preferRicherReferences(original: string, candidate: string): string {
	const origRefs = splitResearchPaperSections(original).get("References") ?? "";
	const candRefs = splitResearchPaperSections(candidate).get("References") ?? "";
	const origCount = countReferenceEntries(origRefs);
	const candCount = countReferenceEntries(candRefs);
	if (origCount >= 5 && candCount < Math.max(3, Math.floor(origCount * 0.5))) {
		return spliceReferencesSection(candidate, origRefs);
	}
	if (candCount === 0 && origCount > 0) {
		return spliceReferencesSection(candidate, origRefs);
	}
	return candidate;
}

export function buildChatPaperCitationFixPrompt(
	draft: string,
	audit: CitationAudit,
	bankSize: number,
	bank: CitationBankEntry[] = [],
): { system: string; user: string } {
	const effectiveBankSize = bank.length > 0 ? bank.length : bankSize;
	const requirements = CHAT_PAPER_CITING_SECTIONS.map((section) => {
		const floor = floorForSection(section, effectiveBankSize);
		const current = audit.sections.find((s) => s.section === section)?.count ?? 0;
		return `- **${section}**: at least ${floor} distinct in-text citations (currently ${current})`;
	}).join("\n");

	const refFloor = floorForReferences(effectiveBankSize);
	const bankDump = bank.length > 0 ? formatBankDumpForPrompt(bank) : "";

	const system = [
		"You are a citation editor for a complete academic research paper.",
		"Insert APA 7 author–date in-text citations (Author, Year) into under-cited body sections ONLY when the adjacent claim is supported by that paper’s bank abstract.",
		bank.length > 0
			? "You may ONLY use citation keys from the allowed literature bank below. Do not invent authors, years, titles, or DOIs."
			: "Prefer sources from any literature retrieval block in the conversation. Do not invent paper titles or DOIs.",
		"Prefer rewriting the sentence to paraphrase a bank abstract over sprinkling unrelated keys to hit density floors.",
		"If a claim has no supporting bank abstract, hedge the claim or remove the cite — never invent sources.",
		"Do NOT add in-text citations to Abstract, Keywords, Study area, Title, or the References heading itself. Abstract must stay citation-free.",
		"Preserve all section headings, arguments, tables, charts, and approximate length.",
		"Use bold-only section titles — never hash (#) headings or horizontal rules.",
		bank.length > 0
			? `Grounded bank cites are more important than volume. Target up to ~${refFloor} distinct grounded sources when abstracts support them. The References list will be rebuilt from bank entries you cite — still include a **References** heading.`
			: `CRITICAL: Keep a complete **References** section with at least ${refFloor} entries matching every in-text citation.`,
		"Do not mention preprint servers, repository names, or paper ID numbers.",
		"Output ONLY the full revised paper in Markdown. No commentary.",
	].join(" ");

	const unknown =
		audit.alignment?.unknownKeys?.length
			? `Replace these invented cites with bank keys that support the claim, or remove them: ${audit.alignment.unknownKeys.join(", ")}`
			: "";

	const user = [
		"## Citation requirements (mandatory)",
		requirements,
		"",
		`- **References**: cite grounded bank sources in the body (currently ${audit.referenceEntries} reference lines; target ~${refFloor} when supported)`,
		unknown,
		"",
		`Failed sections: ${audit.failedSections.join(", ") || "none"}`,
		`References ok: ${audit.referencesOk ? "yes" : "no"}`,
		`Bank alignment ok: ${audit.alignment?.ok === false ? "no" : "yes"}`,
		"",
		...(bankDump
			? ["## Allowed literature bank (ONLY these cites — use abstracts to ground claims)", bankDump, ""]
			: []),
		"## Draft to cite",
		draft,
		"",
		"Return the complete paper using ONLY allowed bank citation keys. Prefer grounded paraphrases over decorative density.",
	]
		.filter(Boolean)
		.join("\n");

	return { system, user };
}

/** Rewrite cited sentences so each cite is supported by the matching bank abstract. */
export function buildChatPaperGroundingFixPrompt(
	draft: string,
	bank: CitationBankEntry[],
): { system: string; user: string } {
	const bankDump = formatBankDumpForPrompt(bank);
	const cited = extractCitedSentences(draft).slice(0, 80);
	const citedPreview = cited.length
		? cited
				.map(
					(c, i) =>
						`${i + 1}. [${c.section}] keys=${c.citeKeys.join(", ")}\n   ${c.sentence}`,
				)
				.join("\n")
		: "(no cited sentences extracted)";

	const system = [
		"You are a grounding editor for an academic research paper.",
		"Every sentence with an in-text citation must be supported by the cited paper’s bank abstract.",
		"You may ONLY use citation keys from the allowed literature bank. Do not invent authors, years, titles, or DOIs.",
		"For unsupported cited sentences: rewrite to paraphrase the matching abstract, swap to a bank paper that supports the claim, or remove the cite and hedge.",
		"Do NOT add citations under Abstract, Keywords, or Study area. Abstract must remain citation-free.",
		"Preserve section headings, tables, charts, research-chart/research-image blocks, and approximate length.",
		"Use bold-only section titles — never hash (#) headings or horizontal rules.",
		"Do not mention preprint servers, repository names, or paper ID numbers.",
		"Output ONLY the full revised paper in Markdown. No commentary.",
	].join(" ");

	const user = [
		"## Allowed literature bank (abstracts are the support source)",
		bankDump,
		"",
		"## Cited sentences to verify (fix any that are not supported by the matching abstract)",
		citedPreview,
		"",
		"## Full draft",
		draft,
		"",
		"Return the complete grounded paper.",
	].join("\n");

	return { system, user };
}

/** Prefer a grounded rewrite when structure is intact; penalize unknown keys and density padding. */
export function pickBetterGroundedDraft(
	original: string,
	grounded: string,
	bank: CitationBankEntry[],
): string {
	const groundedTrim = grounded.trim();
	if (groundedTrim.length < Math.min(400, original.trim().length / 2)) {
		return original;
	}
	if (!paperHasMajorSections(groundedTrim)) return original;

	const bankSize = bank.length;
	const origAudit = auditChatPaperCitations(original, bankSize, bank);
	const groundedAudit = auditChatPaperCitations(groundedTrim, bankSize, bank);

	const unknownOrig = origAudit.alignment?.unknownKeys.length ?? 0;
	const unknownNew = groundedAudit.alignment?.unknownKeys.length ?? 0;
	if (unknownNew < unknownOrig) return groundedTrim;
	if (unknownNew > unknownOrig) return original;

	// Prefer grounded draft when alignment is at least as good and structure intact.
	if (groundedAudit.alignment?.ok !== false) return groundedTrim;
	return original;
}

/** Rebuild only the bibliography when body cites are fine but References is truncated/sparse. */
export function buildChatPaperReferencesFixPrompt(
	draft: string,
	audit: CitationAudit,
	bankSize: number,
	bank: CitationBankEntry[] = [],
): { system: string; user: string } {
	const effectiveBankSize = bank.length > 0 ? bank.length : bankSize;
	const refFloor = Math.max(audit.referenceFloor, floorForReferences(effectiveBankSize));
	const bankDump = bank.length > 0 ? formatBankDumpForPrompt(bank) : "";

	const system = [
		"You are a bibliography editor for an academic research paper.",
		"Rebuild ONLY the **References** section so every in-text citation has a matching full reference entry.",
		bank.length > 0
			? "Use ONLY the allowed literature bank. Copy each matching Reference format line exactly. Do not invent sources."
			: `Produce ${refFloor}–${CHAT_PAPER_REFERENCES_TARGET.max} reference entries when sources permit.`,
		"Each entry on its own line with a blank line between entries. End each entry with [Source](url). Do not invent sources.",
		"Do not mention preprint servers, repository names, or paper ID numbers.",
		"Output the COMPLETE paper in Markdown with all body sections UNCHANGED except the References list.",
		"No commentary.",
	].join(" ");

	const user = [
		`## References requirement`,
		`Need at least ${refFloor} entries (currently ${audit.referenceEntries}).`,
		`Body has ~${audit.totalBodyCites} distinct in-text citations — every one needs a matching reference.`,
		"",
		...(bankDump
			? ["## Allowed literature bank", bankDump, ""]
			: []),
		"## Full draft",
		draft,
		"",
		"Return the full paper with a complete References section.",
	].join("\n");

	return { system, user };
}

/** Prefer fixed draft when it improved cites without collapsing the bibliography. */
export function pickBetterCitedDraft(
	original: string,
	fixed: string,
	bankSize: number,
	bank: CitationBankEntry[] = [],
): string {
	const fixedTrim = fixed.trim();
	if (fixedTrim.length < Math.min(400, original.trim().length / 2)) {
		return original;
	}

	const merged =
		bank.length > 0
			? fixedTrim
			: preferRicherReferences(original, fixedTrim);
	const origAudit = auditChatPaperCitations(original, bankSize, bank);
	const fixedAudit = auditChatPaperCitations(merged, bankSize, bank);

	const score = (a: CitationAudit) => {
		const sectionScore = a.sections.reduce((sum, s) => sum + Math.min(s.count, s.floor), 0);
		const refScore = Math.min(a.referenceEntries, a.referenceFloor || 1) * 2;
		const alignPenalty = (a.alignment?.unknownKeys.length ?? 0) * 5;
		// Mild penalty for ballooning cites far above floors (density padding).
		const overCitePenalty = a.sections.reduce((sum, s) => {
			if (s.floor <= 0) return sum;
			return sum + Math.max(0, s.count - s.floor * 2) * 0.3;
		}, 0);
		return sectionScore + refScore + a.totalBodyCites * 0.05 - alignPenalty - overCitePenalty;
	};

	if (fixedAudit.ok && !origAudit.ok) return merged;
	if (score(fixedAudit) > score(origAudit)) return merged;
	if (
		fixedAudit.failedSections.length < origAudit.failedSections.length &&
		fixedAudit.referenceEntries >= Math.min(origAudit.referenceEntries, 3)
	) {
		return merged;
	}
	return origAudit.totalBodyCites >= fixedAudit.totalBodyCites &&
		origAudit.referenceEntries >= fixedAudit.referenceEntries
		? original
		: merged;
}
