/**
 * Backend mirror of lib/research-scope-profiles.ts — keep in sync with the frontend file.
 */

export type ResearchScope =
	| "assignment"
	| "conference"
	| "dissertation"
	| "faculty"
	| "journal"
	| "proposal"
	| "report"
	| "thesis"
	| "undergraduate_project";

export type CiteFloor = { min: number; max: number };

export type ScopeProfile = {
	scope: ResearchScope;
	label: string;
	/** Bold headings in generation order (Title is always first in the prompt). */
	headings: string[];
	/** Per-section distinct in-text cite floors (0 = never cite). */
	citationFloors: Record<string, CiteFloor>;
	minDistinctCites: number;
	wordTarget: { min: number; max: number };
	outlineGuidance: string;
	/** Hard writing rules for this deliverable type (injected into generation prompts). */
	sectionJobs: string[];
	/** Higher token budget for long forms. */
	maxTokens: number;
};

const RESEARCH_SCOPE_IDS: ResearchScope[] = [
	"assignment",
	"conference",
	"dissertation",
	"faculty",
	"journal",
	"proposal",
	"report",
	"thesis",
	"undergraduate_project",
];

const LEGACY: Record<string, ResearchScope> = {
	undergraduate: "undergraduate_project",
	masters: "thesis",
	doctoral: "dissertation",
	phd: "dissertation",
};

export function normalizeResearchScope(scope: string | null | undefined): ResearchScope | "" {
	if (!scope) return "";
	const mapped = LEGACY[scope] ?? scope;
	return RESEARCH_SCOPE_IDS.includes(mapped as ResearchScope) ? (mapped as ResearchScope) : "";
}

const JOURNAL_HEADINGS = [
	"Title",
	"Abstract",
	"Keywords",
	"Introduction",
	"Methods",
	"Results",
	"Discussion",
	"Conclusion",
	"Acknowledgments",
	"References",
] as const;

const CONFERENCE_HEADINGS = [
	"Title",
	"Abstract",
	"Keywords",
	"Introduction",
	"Methods",
	"Results",
	"Discussion",
	"Conclusion",
	"References",
] as const;

function floors(entries: Array<[string, number, number]>): Record<string, CiteFloor> {
	const out: Record<string, CiteFloor> = {};
	for (const [key, min, max] of entries) {
		out[key] = { min, max };
	}
	return out;
}

export const RESEARCH_SCOPE_PROFILES: Record<ResearchScope, ScopeProfile> = {
	assignment: {
		scope: "assignment",
		label: "Assignment",
		headings: [
			"Title",
			"Introduction",
			"Literature Review",
			"Critical Analysis",
			"Conclusion",
			"References",
		],
		citationFloors: floors([
			["Introduction", 5, 8],
			["Literature Review", 10, 14],
			["Critical Analysis", 8, 12],
			["Conclusion", 3, 4],
			["References", 0, 0],
		]),
		minDistinctCites: 20,
		wordTarget: { min: 1900, max: 2100 },
		outlineGuidance:
			"Brief-first assignment: when a user brief is present, mirror its required sections, parts, questions, and tasks; cover every brief requirement. Fallback only when no brief structure is given: Title, Introduction, Literature Review, Critical Analysis, Conclusion, References. No invented Methodology, Results, timeline, or empirical findings.",
		sectionJobs: [
			"BRIEF-FIRST (hard): The user-provided assignment brief is PRIMARY. Explain and satisfy every element in it — numbered questions, tasks, learning outcomes, required sections/parts, theories, cases, marking criteria, word count, and referencing style. Do not drop, merge away, or invent a different assignment question.",
			"STRUCTURE: If the brief names sections (e.g. Part A/B, Discussion, Recommendations, Appendices), use those bold headings (plus References unless the brief forbids). If the brief lists questions/tasks without headings, create clearly labelled subsections that answer each item in order. Do not collapse all brief tasks into a single Critical Analysis block.",
			"FALLBACK structure (only when the brief does not specify structure): Title, Introduction, Literature Review, Critical Analysis, Conclusion, References.",
			"VOICE: Write as a doctoral / PhD-level academic — analytical, theory-aware, critically evaluative, discipline-precise. No undergraduate summary tone, bullet-essay padding, or stock AI phrases.",
			"When using the fallback template: Literature Review is thematic (not paper-by-paper); Critical Analysis evaluates claims and builds a reasoned position with bank cites.",
			"Never invent completed empirical results, surveys, or datasets. Do not add Abstract, Keywords, Methodology, Methods, Results, or Findings unless the brief explicitly requires a literature-grounded methods discussion (still no fake data).",
			"Body length must be 1,900–2,100 words excluding references unless the brief sets a different word count.",
			"REFERENCES (hard): Cite and list at least 20 distinct retrieval-bank papers with real four-digit years (never n.d., Unknown, or incomplete source details) whenever the bank has ≥20 papers. Every major factual claim needs an in-text citation. Every References entry must appear as an in-text citation. A References section with fewer than 20 bank entries when the bank has ≥20 is invalid.",
			"CITATIONS (hard): Copy each bank paper’s USE THIS CITE string exactly (bracket/parenthetical forms matching the selected reference style). Put citations on every body paragraph in Introduction, literature/theme sections, argument sections, and Conclusion — including the first Introduction paragraph and the Conclusion. Do not leave those paragraphs uncited. Do not invent citations or decorate claims with mismatched cites.",
			"FACT GROUNDING (hard): Do not invent statistics, sample sizes, effect sizes, percentages, or country/institution claims unless they appear in the cited paper’s abstract or evidence card. Cite only papers whose abstracts match the claim’s field (education claims need education evidence; do not cite finance, clinical, or unrelated-domain papers for education ethics/policy). If a point cannot be grounded in the cited abstract, omit it — never fabricate support.",
			"When the topic concerns universities, undergraduates, faculty, or tertiary study, privilege bank papers that present direct higher-education evidence — do not treat K-12 or generic workplace findings as HE evidence.",
			"Format References according to the selected reference style unless the brief mandates another style. Every References entry must be cited in the body.",
			"Never write meta-commentary such as “this point is not clearly supported by the cited abstract”. If evidence is thin, omit the claim or hedge in academic prose without mentioning abstracts or fact-checking.",
			"Prefer prose; place any illustrative synthesis tables in **Literature Review** or **Critical Analysis**; never invent empirical Results unless the brief requires them.",
		],
		maxTokens: 14_000,
	},
	conference: {
		scope: "conference",
		label: "Conference paper",
		headings: [...CONFERENCE_HEADINGS],
		citationFloors: floors([
			["Abstract", 0, 0],
			["Keywords", 0, 0],
			["Introduction", 7, 11],
			["Methods", 3, 6],
			["Results", 2, 4],
			["Discussion", 7, 11],
			["Conclusion", 2, 4],
			["References", 0, 0],
		]),
		minDistinctCites: 20,
		wordTarget: { min: 3000, max: 4000 },
		outlineGuidance:
			"Compact conference contribution: clear gap, tight methods, concise results and discussion — no Acknowledgments section.",
		sectionJobs: [
			"Keep Abstract ≤150 words; Keywords 5–8 terms.",
			"Methods must be reproducible but concise; Results report findings only; Discussion interprets against literature.",
			"Do not expand into thesis chapters or add Title Page / Declaration front matter.",
			"Place empirical tables/charts/figures in **Results**; study design and protocol tables in **Methods**; conceptual models in **Introduction**; never after References.",
		],
		maxTokens: 10_000,
	},
	journal: {
		scope: "journal",
		label: "Journal/Research Paper",
		headings: [...JOURNAL_HEADINGS],
		citationFloors: floors([
			["Abstract", 0, 0],
			["Keywords", 0, 0],
			["Introduction", 8, 12],
			["Methods", 4, 8],
			["Results", 3, 6],
			["Discussion", 8, 12],
			["Conclusion", 3, 6],
			["Acknowledgments", 0, 0],
			["References", 0, 0],
		]),
		minDistinctCites: 25,
		wordTarget: { min: 4000, max: 6000 },
		outlineGuidance:
			"Peer-reviewed journal article: IMRaD, thematic literature synthesis in Introduction/Discussion, reproducible methods.",
		sectionJobs: [
			"Follow IMRaD strictly: Introduction → Methods → Results → Discussion → Conclusion.",
			"Synthesize literature thematically in Introduction and Discussion — not a standalone Literature Review section.",
			"Methods must be reproducible; Results are evidence-only; Discussion interprets vs literature with explicit Limitations.",
			"Place empirical tables/charts/figures in **Results**; study design and protocol tables in **Methods**; conceptual models in **Introduction**; never after References.",
		],
		maxTokens: 12_000,
	},
	report: {
		scope: "report",
		label: "Project report",
		headings: [
			"Title",
			"Executive Summary",
			"Introduction",
			"Background",
			"Objectives",
			"Methods",
			"Findings",
			"Analysis",
			"Recommendations",
			"Conclusion",
			"References",
			"Appendices",
		],
		citationFloors: floors([
			["Executive Summary", 0, 0],
			["Introduction", 5, 8],
			["Background", 8, 12],
			["Objectives", 0, 2],
			["Methods", 3, 5],
			["Findings", 1, 3],
			["Analysis", 5, 9],
			["Recommendations", 2, 4],
			["Conclusion", 2, 3],
			["Appendices", 0, 0],
			["References", 0, 0],
		]),
		minDistinctCites: 20,
		wordTarget: { min: 3000, max: 5000 },
		outlineGuidance:
			"Applied institutional report: executive summary, objectives, findings, actionable recommendations — not a journal Results/Discussion pair.",
		sectionJobs: [
			"Executive Summary is citation-free and must preview objectives, key findings, and recommendations.",
			"**Recommendations** must be actionable, numbered or clearly itemised, and grounded in Findings/Analysis.",
			"Do not force journal IMRaD labels (no Literature Review / Results / Discussion pair).",
			"Place empirical tables/charts/figures in **Findings**; methods tables in **Methods**; synthesis tables in **Background**; never after References.",
		],
		maxTokens: 10_000,
	},
	proposal: {
		scope: "proposal",
		label: "Research proposal",
		headings: [
			"Title",
			"Abstract",
			"Introduction",
			"Problem Statement",
			"Objectives",
			"Literature Review",
			"Methodology",
			"Timeline",
			"Expected Outcomes",
			"Budget",
			"Conclusion",
			"References",
		],
		citationFloors: floors([
			["Abstract", 0, 0],
			["Introduction", 6, 10],
			["Problem Statement", 4, 6],
			["Objectives", 0, 2],
			["Literature Review", 10, 16],
			["Methodology", 4, 8],
			["Timeline", 0, 0],
			["Expected Outcomes", 1, 3],
			["Budget", 0, 0],
			["Conclusion", 2, 4],
			["References", 0, 0],
		]),
		minDistinctCites: 20,
		wordTarget: { min: 2000, max: 4000 },
		outlineGuidance:
			"Grant/study proposal: problem, objectives, literature, planned methods, timeline, expected outcomes, budget — do NOT include Results or Findings.",
		sectionJobs: [
			"Methodology describes planned methods only — do not invent completed Results or Findings.",
			"Timeline and Budget are forward-looking plans; Expected Outcomes state anticipated contributions, not observed data.",
			"Never add Results, Findings, Results / Analysis, or Critical Analysis sections.",
			"Place planned protocol/instrument tables in **Methodology**; synthesis tables and conceptual models in **Literature Review**; never invent Results or place visuals after References.",
		],
		maxTokens: 10_000,
	},
	faculty: {
		scope: "faculty",
		label: "Faculty / grant",
		headings: [
			"Title",
			"Abstract",
			"Introduction",
			"Problem Statement",
			"Objectives",
			"Literature Review",
			"Methodology",
			"Timeline",
			"Expected Outcomes",
			"Budget",
			"Conclusion",
			"References",
		],
		citationFloors: floors([
			["Abstract", 0, 0],
			["Introduction", 8, 12],
			["Problem Statement", 6, 10],
			["Objectives", 1, 3],
			["Literature Review", 14, 22],
			["Methodology", 6, 10],
			["Timeline", 0, 0],
			["Expected Outcomes", 2, 4],
			["Budget", 0, 0],
			["Conclusion", 3, 5],
			["References", 0, 0],
		]),
		minDistinctCites: 30,
		wordTarget: { min: 4000, max: 6000 },
		outlineGuidance:
			"Ambitious multi-year faculty/grant programme: problem, objectives, deep literature, methods, multi-year timeline, outcomes, budget — no empirical Results section.",
		sectionJobs: [
			"Same proposal rules at faculty scale: planned methods only; denser Literature Review and multi-year Timeline/Budget.",
			"Never invent completed empirical Results or Findings.",
			"Do not collapse into journal IMRaD or thesis chapters.",
			"Place planned protocol/instrument tables in **Methodology**; synthesis tables and conceptual models in **Literature Review**; never invent Results or place visuals after References.",
		],
		maxTokens: 12_000,
	},
	undergraduate_project: {
		scope: "undergraduate_project",
		label: "Undergraduate project",
		headings: [
			"Title Page",
			"Declaration",
			"Abstract",
			"Acknowledgments",
			"Table of Contents",
			"Chapter One: Introduction",
			"Chapter Two: Literature Review",
			"Chapter Three: System Analysis and Methodology",
			"Chapter Four: System Design and Implementation",
			"Chapter Five: Testing and Results",
			"Chapter Six: Discussion",
			"Chapter Seven: Conclusion and Recommendations",
			"References",
			"Appendices",
		],
		citationFloors: floors([
			["Title Page", 0, 0],
			["Declaration", 0, 0],
			["Abstract", 0, 0],
			["Acknowledgments", 0, 0],
			["Table of Contents", 0, 0],
			["Chapter One: Introduction", 6, 10],
			["Chapter Two: Literature Review", 12, 18],
			["Chapter Three: System Analysis and Methodology", 4, 8],
			["Chapter Four: System Design and Implementation", 2, 4],
			["Chapter Five: Testing and Results", 2, 4],
			["Chapter Six: Discussion", 6, 10],
			["Chapter Seven: Conclusion and Recommendations", 3, 5],
			["Appendices", 0, 0],
			["References", 0, 0],
		]),
		minDistinctCites: 25,
		wordTarget: { min: 6000, max: 8000 },
		outlineGuidance:
			"Undergraduate project with Chapters 1–7 (intro, literature, analysis/methodology, design/implementation, testing/results, discussion, conclusion/recommendations) plus front matter.",
		sectionJobs: [
			"Use the exact Chapter One–Seven headings — do not collapse into journal IMRaD.",
			"Keep Abstract 150–250 words and citation-free; cover topic, method/approach, key results, and implication.",
			"Front matter (Title Page, Declaration, Abstract, Acknowledgments, Table of Contents) stays citation-free where floors are 0.",
			"Chapter Five reports testing/results; Chapter Six interprets; Chapter Seven concludes with recommendations.",
			"Place empirical visuals in **Chapter Five: Testing and Results**; design diagrams in **Chapter Four**; protocol/analysis tables in **Chapter Three**; synthesis tables in **Chapter Two**; never after References.",
		],
		maxTokens: 16_000,
	},
	thesis: {
		scope: "thesis",
		label: "Thesis",
		headings: [
			"Title Page",
			"Abstract",
			"Acknowledgments",
			"Table of Contents",
			"Introduction",
			"Literature Review",
			"Methodology",
			"Findings / Results",
			"Discussion",
			"Conclusion",
			"Recommendations",
			"References",
			"Appendices",
		],
		citationFloors: floors([
			["Title Page", 0, 0],
			["Abstract", 0, 0],
			["Acknowledgments", 0, 0],
			["Table of Contents", 0, 0],
			["Introduction", 10, 14],
			["Literature Review", 18, 28],
			["Methodology", 6, 10],
			["Findings / Results", 3, 6],
			["Discussion", 10, 16],
			["Conclusion", 3, 6],
			["Recommendations", 2, 4],
			["Appendices", 0, 0],
			["References", 0, 0],
		]),
		minDistinctCites: 40,
		wordTarget: { min: 8000, max: 10000 },
		outlineGuidance:
			"Master's thesis chapter structure with front matter, substantial literature, methods, findings, discussion, recommendations.",
		sectionJobs: [
			"Keep thesis section order exactly — do not rewrite as a short journal article.",
			"Keep Abstract 250–350 words and citation-free; cover problem, method, headline findings, and implication.",
			"Literature Review is substantial and thematic; Methodology is reproducible; Findings / Results are evidence-only.",
			"Recommendations are distinct from Conclusion and actionable for practice or further research.",
			"Place empirical tables/charts/figures in **Findings / Results**; conceptual models and synthesis tables in **Literature Review**; protocol tables in **Methodology**; never after References.",
		],
		maxTokens: 16_000,
	},
	dissertation: {
		scope: "dissertation",
		label: "Dissertation",
		headings: [
			"Title Page",
			"Abstract",
			"Acknowledgments",
			"Dedication",
			"Table of Contents",
			"List of Tables",
			"List of Figures",
			"Introduction",
			"Literature Review",
			"Theoretical Framework",
			"Methodology",
			"Results",
			"Discussion",
			"Conclusion",
			"Contributions",
			"References",
			"Appendices",
		],
		citationFloors: floors([
			["Title Page", 0, 0],
			["Abstract", 0, 0],
			["Acknowledgments", 0, 0],
			["Dedication", 0, 0],
			["Table of Contents", 0, 0],
			["List of Tables", 0, 0],
			["List of Figures", 0, 0],
			["Introduction", 12, 18],
			["Literature Review", 25, 40],
			["Theoretical Framework", 10, 16],
			["Methodology", 8, 12],
			["Results", 4, 8],
			["Discussion", 12, 20],
			["Conclusion", 4, 8],
			["Contributions", 3, 6],
			["Appendices", 0, 0],
			["References", 0, 0],
		]),
		minDistinctCites: 50,
		wordTarget: { min: 10000, max: 12000 },
		outlineGuidance:
			"Doctoral dissertation: front matter, introduction, literature, theoretical framework, methodology, results, discussion, conclusion, contributions.",
		sectionJobs: [
			"Preserve doctoral front matter and exact section order — never collapse to journal IMRaD.",
			"Keep Abstract 300–500 words and citation-free; cover problem, method, headline findings, and contributions.",
			"**Theoretical Framework** must be distinct from Literature Review; **Contributions** must state novel scholarly contributions.",
			"Results are evidence-only; Discussion interprets against literature and theory.",
			"Place empirical tables/charts/figures in **Results**; conceptual models in **Theoretical Framework**; synthesis tables in **Literature Review**; never after References.",
		],
		maxTokens: 16_000,
	},
};

function resolveScopeKey(scope: string | null | undefined): ResearchScope | "" {
	if (!scope) return "";
	const byId = normalizeResearchScope(scope);
	if (byId) return byId;

	const lower = String(scope).trim().toLowerCase().replace(/\s+/g, " ");
	const compact = lower.replace(/\s*\/\s*/g, "/");
	for (const profile of Object.values(RESEARCH_SCOPE_PROFILES)) {
		const label = profile.label.toLowerCase();
		if (label === lower || label.replace(/\s*\/\s*/g, "/") === compact) {
			return profile.scope;
		}
	}
	return "";
}

export function getScopeProfile(scope: ResearchScope | string | null | undefined): ScopeProfile {
	const key = resolveScopeKey(scope) || "journal";
	return RESEARCH_SCOPE_PROFILES[key] ?? RESEARCH_SCOPE_PROFILES.journal;
}

/** Parse `Scope: Journal/Research Paper` (or id) from a staged paper prompt. */
export function parseScopeFromPrompt(text: string | null | undefined): ResearchScope | "" {
	if (!text) return "";
	const match = text.match(/^Scope:\s*(.+)$/im);
	if (!match?.[1]) return "";
	return resolveScopeKey(match[1].trim());
}

export function formatHeadingsForPrompt(profile: ScopeProfile): string {
	return profile.headings.map((h) => `**${h}**`).join(", ");
}

export function formatCitationFloorsForPrompt(profile: ScopeProfile): string {
	const parts: string[] = [];
	for (const heading of profile.headings) {
		const floor = profile.citationFloors[heading];
		if (!floor) continue;
		if (floor.min === 0 && floor.max === 0) {
			parts.push(`${heading} 0`);
			continue;
		}
		parts.push(`${heading} ${floor.min}–${floor.max}`);
	}
	return parts.join("; ");
}

export function formatAcademicIntegrityRules(profile: ScopeProfile): string[] {
	const min = profile.minDistinctCites;
	const lines = [
		"Cite ONLY papers from the conversation literature retrieval / research API bank. Copy USE THIS CITE strings exactly (they already use family names, never given-name initials). Do not invent authors, years, titles, or DOIs.",
		"Never cite n.d., Unknown, or incomplete sources. Use only bank papers with named authors and a four-digit year. If a paper has no year, skip it and cite another bank paper.",
		"Paraphrase / synthesize bank evidence cards and abstracts into literature claims. Every cited sentence must be supported by the cited paper’s abstract — no decorative cites. No statistics, sample sizes, or effect sizes that are not in that abstract.",
		"Stay in-field: do not analogize clinical/biomedical or otherwise off-topic papers to the assignment’s discipline. If on-topic literature is thin, say so and write from the remaining on-topic abstracts.",
		"When the topic concerns higher education, cite papers that study universities, undergraduates, faculty, or tertiary settings. Do not treat K-12, hospital, or generic workplace findings as higher-education evidence.",
		"Claim discipline: copy the studied population from the paper’s title/abstract (students vs faculty). Do not cite perspective/commentary/agenda papers as empirical measurements. Do not generalise one small-N or single-course finding into a field-wide effect; name design and sample when the evidence card states them.",
		"Never invent a literature search. If Methodology describes searching literature, use ONLY the RETRIEVAL PROTOCOL (APIs, query, date, counts). Do not claim Web of Science, Scopus, ERIC, IEEE Xplore, PubMed, dual independent reviewers, kappa, CASP/MMAT, or PRISMA registration unless those appear in the protocol. For review topics: include the supplied selection-flow and extraction tables; write Results as corpus synthesis (“Of the N included records…”); avoid causal “Impact of…” titles; do not repeat the same finding across Literature Review, Results, Discussion, and Conclusion.",
		"Citation scope (hard): every major factual claim needs a bank in-text cite; prose must not exceed what that cite’s abstract supports; no uncited filler outside Methods/Results study evidence; omit points that cannot be grounded. Do not fall back to uncited general knowledge.",
		`References list: format in the selected reference style (1:1 match — every in-text bank cite has a References entry, and every References entry is cited in the body). Cite at least ${min} distinct bank papers in both the body and References. Use the retrieval bank until this floor is met; only if retrieval returns fewer than ${min} papers may the list equal the full bank (still every entry cited in-text). Never invent fillers or pad uncited entries. A References section that invents sources or lists uncited papers is invalid.`,
		"Never insert editorial asides about abstracts, fact-checking, or unsupported cites (e.g. “this point is not clearly supported by the cited abstract”). Hedge in academic language or omit the claim.",
		"Abstract / Executive Summary / front matter: zero in-text citations where the profile marks 0; those sections may only summarize content the body later grounds in cites or study evidence.",
		"Strong academic English: discipline-precise, argumentative, non-formulaic; prefer analytical verbs over vague intensifiers; ban stock AI phrases (e.g. “rapidly evolving”, “delve into”, “landscape of”, “it is worth noting”).",
		"Anti-repetition: do not recycle the same summary across overview, introduction, discussion, and conclusion sections; vary wording within paragraphs.",
		"Do not use hash (#) Markdown headings or horizontal rules (---, --).",
	];
	if (profile.scope === "assignment") {
		lines.push(
			"Assignment register: write as a PhD-level academic — critical synthesis and theoretical precision, not undergraduate paraphrase.",
			`Assignment References floor (hard): when the retrieval bank has ≥${min} papers, the References section must contain at least ${min} distinct bank entries, each also cited in-text. Fewer than ${min} is invalid.`,
			"Assignment fact check: every cited sentence must be supported by that paper’s abstract/evidence card. Use ONLY USE THIS CITE forms matching the selected reference style. Stay in-field (no off-topic bank papers). Omit unsupported numbers, effects, or institutional claims rather than inventing them.",
		);
	}
	return lines;
}

export function formatStructureInstructions(profile: ScopeProfile): string[] {
	const hasKeywords = profile.headings.includes("Keywords");
	const hasStudyArea = profile.headings.includes("Study area");
	const isAssignment = profile.scope === "assignment";
	const lines = [
		isAssignment
			? "Write a complete PhD-level academic Assignment that fully explains and satisfies the user-provided brief (not a generic journal article)."
			: `Write a complete academic ${profile.label} (not a generic journal article unless the scope is Journal/Research Paper).`,
		`Target body length: ${profile.wordTarget.min.toLocaleString()}–${profile.wordTarget.max.toLocaleString()} words excluding references${
			isAssignment ? " — unless the brief sets a different word count, which then controls." : "."
		}`,
		isAssignment
			? `Section order (brief wins): if the assignment brief names sections, parts, or ordered tasks, use those as bold-only headings (plus References unless forbidden). Only if the brief does not specify structure, use this fallback order: ${formatHeadingsForPrompt(profile)}.`
			: `Use this exact section order with bold-only headings on their own lines: ${formatHeadingsForPrompt(profile)}.`,
		isAssignment
			? `In-text citation floors for the fallback template (distinct retrieval-bank citations matching the chosen reference style): ${formatCitationFloorsForPrompt(profile)}. Across the full body — whatever headings the brief requires — cite at least ${profile.minDistinctCites} distinct bank papers in-text and in References. Use the retrieval bank until this floor is met; only if retrieval returns fewer than ${profile.minDistinctCites} papers may you cite every retrieved paper (still all cited; never invent extras). Prefer grounded paraphrases over density padding.`
			: `In-text citation floors (distinct retrieval-bank citations matching the chosen reference style): ${formatCitationFloorsForPrompt(profile)}. Across the full body, cite at least ${profile.minDistinctCites} distinct bank papers in-text. Use the retrieval bank until this floor is met; only if retrieval returns fewer than ${profile.minDistinctCites} papers may you cite every retrieved paper (still all cited; never invent extras). Prefer grounded paraphrases over density padding.`,
		profile.outlineGuidance,
		...profile.sectionJobs,
	];
	if (hasKeywords) {
		lines.push(
			"After **Keywords**, put terms on the next line separated by middots (term1 · term2 · term3).",
		);
	}
	if (hasStudyArea) {
		lines.push(
			"After **Study area**, put the discipline on the next line. Never merge Keywords and Study area on one line.",
		);
	}
	if (
		profile.headings.includes("Methodology") ||
		profile.headings.includes("Methods") ||
		profile.headings.includes("Chapter Three: Methodology") ||
		profile.headings.includes("Chapter Three: System Analysis and Methodology")
	) {
		lines.push(
			"If this document reviews literature: Methodology must use the retrieval protocol only (real APIs, real counts). Never invent Scopus/Web of Science/ERIC/IEEE searches, dual reviewers, or a PRISMA flow that was not supplied. Results synthesise the included corpus; include the supplied selection-flow and extraction tables.",
		);
	}
	if (profile.headings.includes("Abstract")) {
		lines.push("Never skip **Abstract**; do not merge it with other sections.");
	}
	if (
		!isAssignment &&
		(profile.headings.includes("Introduction") ||
			profile.headings.includes("Chapter One: Introduction"))
	) {
		lines.push("Never skip the Introduction section; do not merge it with Abstract or Literature Review.");
	}
	if (profile.scope === "proposal" || profile.scope === "faculty") {
		lines.push(
			"Do NOT include Results, Findings, or Results / Analysis sections — this is a proposal/plan, not an empirical paper.",
		);
	}
	if (isAssignment) {
		lines.push(
			"Do not invent Methodology, Methods, Results, Findings, Abstract, or Keywords unless the brief explicitly requires a literature-grounded methods discussion (still no fake empirical data).",
		);
	}
	return lines;
}

export function literatureBankFetchLimit(scope: ResearchScope | string | null | undefined): number {
	const profile = getScopeProfile(scope);
	if (profile.scope === "assignment") return 36;
	return Math.max(30, profile.minDistinctCites);
}

