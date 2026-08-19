/**
 * Backend mirror of labeled intake fields from lib/research-scope-brief.ts.
 * Keep field labels in sync with formatScopeBrief on the frontend.
 */

import type { ResearchScope } from "./research-scope-profiles.js";

export type ParsedScopeBrief = {
	values: Record<string, string>;
	notes: string;
	questionsList: string[];
};

type ScopeBriefMeta = {
	fields: { id: string; label: string }[];
	notesTitle: string;
	fieldJobs: Record<string, string>;
	notesJob: string;
	uploadedKind: string;
	notThis: string;
};

const SCOPE_BRIEF_META: Record<Exclude<ResearchScope, "assignment">, ScopeBriefMeta> = {
	conference: {
		fields: [
			{ id: "venue", label: "Conference / venue" },
			{ id: "pageLimit", label: "Page or word limit" },
			{ id: "track", label: "Track or theme" },
		],
		notesTitle: "Notes for the agent",
		fieldJobs: {
			venue: "name this conference throughout; situate the contribution for that audience",
			pageLimit: "honour this compactness limit — do not write thesis-length sections",
			track: "align the contribution to this track or theme",
		},
		notesJob: "CFP, template, or reviewer constraints — not empirical data",
		uploadedKind: "CFP or template",
		notThis: "not a journal article, thesis, or coursework assignment",
	},
	journal: {
		fields: [
			{ id: "journal", label: "Target journal" },
			{ id: "articleType", label: "Article type" },
		],
		notesTitle: "Notes for the agent",
		fieldJobs: {
			journal: "write for this journal’s audience and house style",
			articleType:
				"empirical = IMRaD with methods/results; review = corpus synthesis; theoretical = argument, not empirical findings",
		},
		notesJob: "special issue, reporting guidelines, or journal constraints — not empirical data",
		uploadedKind: "author guidelines",
		notThis: "not a conference short paper, thesis, or coursework assignment",
	},
	report: {
		fields: [
			{ id: "client", label: "Client / institution" },
			{ id: "objectives", label: "Report objectives" },
		],
		notesTitle: "Scope notes",
		fieldJobs: {
			client: "address Executive Summary, Analysis, and Recommendations to this client",
			objectives: "the Objectives section must answer these; Recommendations must map to them",
		},
		notesJob: "audience, embargo, or decision constraints — not empirical data",
		uploadedKind: "terms of reference",
		notThis: "not a journal article or thesis",
	},
	proposal: {
		fields: [
			{ id: "funder", label: "Funder / scheme" },
			{ id: "duration", label: "Project duration" },
		],
		notesTitle: "Call notes",
		fieldJobs: {
			funder: "echo this scheme’s language; calibrate Timeline and Budget to the funder",
			duration: "Timeline and Budget must match this duration",
		},
		notesJob: "eligibility, assessment criteria, or work packages — not empirical data",
		uploadedKind: "call notes",
		notThis: "not a completed empirical paper — planned work only",
	},
	faculty: {
		fields: [
			{ id: "programme", label: "Programme name" },
			{ id: "years", label: "Duration (years)" },
			{ id: "team", label: "PI / team" },
		],
		notesTitle: "Programme notes",
		fieldJobs: {
			programme: "use this as the programme name on the title and throughout",
			years: "Timeline and Budget must be a multi-year plan for this duration",
			team: "name PI / Co-Is / partners in the programme plan and budget roles",
		},
		notesJob: "work packages, partners, or institutional priorities — not empirical data",
		uploadedKind: "RFP or programme notes",
		notThis: "not a journal article or thesis — planned faculty-scale work only",
	},
	undergraduate_project: {
		fields: [
			{ id: "supervisor", label: "Supervisor" },
			{ id: "projectType", label: "Project type" },
		],
		notesTitle: "Supervisor notes",
		fieldJobs: {
			supervisor: "put on Title Page and Acknowledgments when supplied",
			projectType:
				"system = design/implementation chapters; empirical = methods and results; report = applied project inside the chapter map",
		},
		notesJob: "required chapters, tools, or marking criteria — not empirical data",
		uploadedKind: "handbook or marking notes",
		notThis: "not a journal article — keep undergraduate Chapters One–Seven",
	},
	thesis: {
		fields: [
			{ id: "degree", label: "Degree / university" },
			{ id: "questions", label: "Research questions" },
		],
		notesTitle: "Handbook notes",
		fieldJobs: {
			degree: "put on Title Page / front matter",
			questions: "use this set — refine wording only; do not replace or pad to 5–7",
		},
		notesJob: "school conventions, word bands, or required chapters — not empirical data",
		uploadedKind: "thesis handbook",
		notThis: "not a journal article or doctoral dissertation",
	},
	dissertation: {
		fields: [
			{ id: "degree", label: "Degree / university" },
			{ id: "questions", label: "Research questions" },
			{ id: "contributions", label: "Intended contributions" },
		],
		notesTitle: "Doctoral notes",
		fieldJobs: {
			degree: "put on Title Page / front matter",
			questions: "use this set — refine wording only; do not replace or pad to 5–7",
			contributions: "map into Expected contributions and the Contributions section",
		},
		notesJob: "committee/handbook constraints — not empirical data",
		uploadedKind: "doctoral handbook or committee notes",
		notThis: "not a journal article, master's thesis, or coursework assignment",
	},
};

export function parseResearchQuestionLines(raw: string | null | undefined): string[] {
	if (!raw?.trim()) return [];
	return raw
		.split(/\n+/)
		.map((line) => line.replace(/^\s*(?:rq\s*\d+[:.)-]?\s*|\d+[:.)-]\s*)/i, "").trim())
		.filter((line) => line.length > 8)
		.slice(0, 7);
}

export function parseScopeBrief(
	scope: ResearchScope,
	brief: string | null | undefined,
	researchQuestions?: string[] | null,
): ParsedScopeBrief {
	const empty: ParsedScopeBrief = { values: {}, notes: "", questionsList: [] };
	if (scope === "assignment") {
		const notes = (brief ?? "").trim();
		return { ...empty, notes, questionsList: parseResearchQuestionLines(notes) };
	}
	const meta = SCOPE_BRIEF_META[scope];
	const text = (brief ?? "").replace(/\r/g, "").trim();
	if (!text) {
		const fromIdea = (researchQuestions ?? []).filter((q) => q.trim().length > 8);
		return { ...empty, questionsList: fromIdea };
	}

	const labelToId = new Map<string, string>();
	for (const field of meta.fields) {
		labelToId.set(field.label.toLowerCase(), field.id);
	}
	const notesLabel = meta.notesTitle.toLowerCase();
	const buckets: Record<string, string[]> = {};
	const noteLines: string[] = [];
	let currentId: string | null = null;
	let currentIsNotes = false;

	for (const line of text.split("\n")) {
		const match = line.match(/^([^:\n]{1,80}):\s*(.*)$/);
		const label = match?.[1]?.trim().toLowerCase() ?? "";
		const fieldId = labelToId.get(label);
		const isNotesHeader = Boolean(match) && label === notesLabel;
		if (fieldId || isNotesHeader) {
			currentId = fieldId ?? null;
			currentIsNotes = isNotesHeader;
			const rest = (match?.[2] ?? "").trim();
			if (currentIsNotes) {
				if (rest) noteLines.push(rest);
			} else if (currentId) {
				(buckets[currentId] ??= []).push(...(rest ? [rest] : []));
			}
			continue;
		}
		if (currentIsNotes) noteLines.push(line);
		else if (currentId) (buckets[currentId] ??= []).push(line);
	}

	const values: Record<string, string> = {};
	for (const [id, lines] of Object.entries(buckets)) {
		values[id] = lines.join("\n").trim();
	}
	const fromBrief = parseResearchQuestionLines(values.questions);
	const fromIdea = (researchQuestions ?? []).filter((q) => q.trim().length > 8);
	return {
		values,
		notes: noteLines.join("\n").trim(),
		questionsList: fromBrief.length ? fromBrief : fromIdea,
	};
}

export function formatOutlineFieldBlock(scope: ResearchScope, parsed: ParsedScopeBrief): string {
	if (scope === "assignment") return "";
	const meta = SCOPE_BRIEF_META[scope];
	const lines: string[] = [];
	for (const field of meta.fields) {
		const job = meta.fieldJobs[field.id];
		if (field.id === "questions") {
			if (!parsed.questionsList.length) continue;
			lines.push(
				`**${field.label} (${job}):**`,
				parsed.questionsList.map((q, i) => `${i + 1}. ${q}`).join("\n"),
			);
			continue;
		}
		const value = parsed.values[field.id]?.trim();
		if (!value) continue;
		lines.push(`**${field.label} (${job}):** ${value}`);
	}
	if (parsed.notes) {
		lines.push(`**${meta.notesTitle} (${meta.notesJob}):**`, parsed.notes);
	}
	return lines.join("\n");
}

export function getScopeBriefMeta(scope: ResearchScope): ScopeBriefMeta | null {
	if (scope === "assignment") return null;
	return SCOPE_BRIEF_META[scope];
}

export function scopeOutlineSystemPrompt(scope: ResearchScope, fast: boolean): string | null {
	const compact = "Cite Author (year) only. Keep under 1200 words before sources.";
	const full = "Use provided papers for literature review only; cite Author (year). Never mention preprint servers, repository names, or paper IDs. Keep the body under 2200 words before sources.";
	const tail = fast ? compact : full;
	const common =
		"Use bold-only section titles on their own lines — never hash (#) headings. Honour labeled intake fields from the user message. End with a Final document section map using the deliverable’s exact headings.";

	switch (scope) {
		case "conference":
			return `You write compact conference-paper outlines in Markdown. ${common} Structure: **1. Title**, **2. Contribution / gap**, **3. Methods**, **4. Results plan**, **5. Discussion points**, **6. Final document section map**. Honour venue, page/word limit, and track when supplied. Do not add Acknowledgments or thesis front matter. ${tail}`;
		case "journal":
			return `You write journal-article outlines in Markdown. ${common} Structure: **1. Title**, **2. Introduction / gap**, **3. Research questions or propositions**, **4. Methods**, **5. Results plan**, **6. Discussion / Limitations**, **7. Final document section map**. Honour target journal and article type when supplied. ${tail}`;
		case "report":
			return `You write applied project-report outlines in Markdown. ${common} Structure: **1. Title**, **2. Executive summary points**, **3. Objectives**, **4. Methods**, **5. Findings / Analysis plan**, **6. Recommendations**, **7. Final document section map**. Honour client and report objectives when supplied. Do not use journal IMRaD labels. ${tail}`;
		case "proposal":
			return `You write research-proposal outlines in Markdown. ${common} Structure: **1. Title**, **2. Problem and objectives**, **3. Literature**, **4. Planned methods**, **5. Timeline**, **6. Expected outcomes**, **7. Budget**, **8. Final document section map**. Honour funder and duration when supplied. No Results or Findings. ${tail}`;
		case "faculty":
			return `You write faculty/grant programme outlines in Markdown. ${common} Structure: **1. Title**, **2. Problem and objectives**, **3. Literature**, **4. Planned methods**, **5. Multi-year timeline**, **6. Expected outcomes**, **7. Budget**, **8. Final document section map**. Honour programme name, years, and team when supplied. No completed Results. ${tail}`;
		case "undergraduate_project":
			return `You write undergraduate project outlines in Markdown. ${common} Structure: **1. Title Page**, **2. Project type plan**, **3. Chapter map**, **4. Final document section map**. Honour supervisor and project type when supplied. Keep Chapters One–Seven. ${tail}`;
		case "thesis":
			return `You write master's thesis outlines in Markdown. ${common} Structure: **1. Title Page**, **2. Introduction**, **3. Research questions**, **4. Literature review**, **5. Methodology**, **6. Expected findings**, **7. Recommendations**, **8. Scope and limitations**, **9. Suggested timeline**, **10. Final document section map**. Derive 3–5 research questions from the title unless the user supplied a set — refine wording only; do not pad to 5–7. Put degree/university on Title Page when supplied. ${tail}`;
		case "dissertation":
			return null;
		default:
			return null;
	}
}

export function scopeOutlineBodyInstructions(scope: ResearchScope, parsed: ParsedScopeBrief): string {
	switch (scope) {
		case "conference":
			return `**Conference Outline**

**1. Title**
Working title for a conference submission${parsed.values.venue ? ` at ${parsed.values.venue}` : ""}${parsed.values.track ? ` (${parsed.values.track})` : ""}.

**2. Contribution / gap**
What this conference paper adds${parsed.values.venue || parsed.values.track ? ", calibrated to the venue and track" : ""}. Short academic paragraphs.

**3. Methods**
Compact reproducible methods (design, sample/materials, collection, analysis) — not thesis-level.${parsed.values.pageLimit ? " Honour the stated page/word limit." : ""}

**4. Results plan**
Evidence-only findings to report. No interpretation here.

**5. Discussion points**
Interpretation against literature; implications for a conference audience.

**6. Final document section map**`;
		case "journal": {
			const articleType = (parsed.values.articleType ?? "").toLowerCase();
			const isReview = articleType.includes("review");
			const isTheoretical = articleType.includes("theoretical");
			return `**Journal Article Outline**

**1. Title**
Working title${parsed.values.journal ? ` for ${parsed.values.journal}` : " for a peer-reviewed journal article"}.

**2. Introduction / gap**
Situate the article for a journal audience. Thematic literature belongs here and in Discussion — no standalone Literature Review heading in the finished article.

**3. Research questions or propositions**
${
	isTheoretical
		? "Theoretical propositions (not statistical hypotheses)."
		: isReview
			? "Review questions the synthesis will answer. Do not invent a primary empirical study."
			: "Investigable questions aligned to an empirical IMRaD article. Prefer any candidate questions supplied."
}

**4. Methods**
${
	isReview
		? "Retrieval protocol only — do not invent Scopus/Web of Science searches, dual reviewers, or unaudited PRISMA counts."
		: isTheoretical
			? "Conceptual / analytical approach. No fabricated empirical protocol."
			: "Reproducible design → sample → collection → instruments → analysis. No findings in Methods."
}

**5. Results plan**
${
	isTheoretical
		? "State **Not applicable** for empirical Results. The argument develops in Introduction and Discussion."
		: isReview
			? "Corpus synthesis plan (“Of the N included records…”). Do not invent primary findings."
			: "Evidence-only findings aligned to the questions."
}

**6. Discussion / Limitations**
Interpret against literature; include explicit Limitations.

**7. Final document section map**`;
		}
		case "report":
			return `**Project Report Outline**

**1. Title**
Working title${parsed.values.client ? ` for ${parsed.values.client}` : " for an applied project report"}.

**2. Executive summary points**
Citation-free preview of objectives, key findings, and recommendations.

**3. Objectives**
${
	parsed.values.objectives?.trim()
		? "Use the supplied report objectives as the set — refine wording only."
		: "Derive 3–5 objectives the report will answer from the title."
}

**4. Methods**
How evidence will be assembled. Applied, not journal IMRaD.

**5. Findings / Analysis plan**
Findings are evidence-first; Analysis interprets for the audience.

**6. Recommendations**
Numbered, actionable items mapped to the objectives. State who acts, on what, and why the evidence supports it.

**7. Final document section map**`;
		case "proposal":
			return `**Research Proposal Outline**

**1. Title**
Working title${parsed.values.funder ? ` for ${parsed.values.funder}` : " for a research proposal"}.

**2. Problem and objectives**
Problem statement and objectives calibrated to the topic${parsed.values.funder ? " and funder" : ""}.

**3. Literature**
Thematic strands (cite Author (year) from the paper list) and the gap this proposal will address.

**4. Planned methods**
Design, sample, collection, instruments, analysis, ethics — planned only. No findings.

**5. Timeline**
Phases calibrated to ${parsed.values.duration?.trim() ? "the stated project duration" : "a plausible study duration"}. Not a table.

**6. Expected outcomes**
Anticipated contributions — not observed results.

**7. Budget**
Indicative cost headings${parsed.values.funder || parsed.values.duration ? " calibrated to the funder and duration" : ""}. Do not invent spent funds.

**8. Final document section map**`;
		case "faculty":
			return `**Faculty / Grant Outline**

**1. Title**
${parsed.values.programme ? "Programme name and working title." : "Working title for a multi-year faculty/grant programme."}

**2. Problem and objectives**
Faculty-scale problem and objectives.${parsed.values.team ? " Name PI/team when supplied." : ""}

**3. Literature**
Denser thematic review (cite Author (year) from the paper list) and the programme gap.

**4. Planned methods**
Faculty-scale planned work only. No completed Results.

**5. Multi-year timeline**
Work packages and milestones${parsed.values.years ? " calibrated to the stated years" : " for a multi-year programme"}. Not a table.

**6. Expected outcomes**
Anticipated programme contributions — not observed results.

**7. Budget**
Multi-year indicative cost headings.${parsed.values.team ? " Name team roles when supplied." : ""} Do not invent spent funds.

**8. Final document section map**`;
		case "undergraduate_project": {
			const projectType = (parsed.values.projectType ?? "").toLowerCase();
			const shape = projectType.includes("system")
				? "System/software: Chapter Three analysis/methodology, Chapter Four design/implementation, Chapter Five testing/results."
				: projectType.includes("empirical")
					? "Empirical study: Chapter Three methodology, Chapter Four (limited design if needed), Chapter Five results."
					: projectType.includes("report")
						? "Project report inside the chapter map: applied findings in Chapter Five, recommendations in Chapter Seven."
						: "Shape Chapters Three–Five to the project implied by the title (system, empirical, or applied report).";
			return `**Undergraduate Project Outline**

**1. Title Page**
Working title${parsed.values.supervisor ? "; name the supervisor" : ""}. Citation-free front matter (Declaration, Abstract, Acknowledgments, Table of Contents).

**2. Project type plan**
${shape}

**3. Chapter map**
Bullets for Chapter One through Chapter Seven. Chapter Five reports testing/results; Chapter Six interprets; Chapter Seven concludes with recommendations.

**4. Final document section map**`;
		}
		case "thesis": {
			const hasUserQuestions = parsed.questionsList.length > 0;
			return `**Thesis Outline**

**1. Title Page**
Working title${parsed.values.degree ? " plus degree/university" : ""}. Citation-free front matter.

**2. Introduction**
Write three labeled subsections as short academic paragraphs:
- **Background**
- **Problem statement**
- **Significance** — state the research questions the outline will answer.

**3. Research questions**
${
	hasUserQuestions
		? "Numbered list of the candidate questions. Refine wording for precision only. Do not add filler questions to reach 5–7."
		: "Numbered list of 3–5 investigable master's questions derived from the title. Do not pad to 5–7."
}

**4. Literature review**
- **Themes:** Organised strands of prior work (cite Author (year) from the paper list)
- **Framework:** Named theoretical/conceptual framework
- **Gap:** Precise gap this thesis will address

**5. Methodology**
Research design; population/sample; data collection; data analysis; ethics. No findings.

**6. Expected findings**
Evidence-only reporting plan aligned to the questions. Interpretation belongs in Discussion.

**7. Recommendations**
Distinct from Conclusion — actionable implications for practice or further research.

**8. Scope and limitations**
Study boundaries and acknowledged limitations.

**9. Suggested timeline**
**Phase** subheadings with short paragraphs, calibrated to a master's thesis.

**10. Final document section map**`;
		}
		default:
			return "";
	}
}
