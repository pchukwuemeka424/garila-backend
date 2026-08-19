import { getOpenRouterOutlineModel } from "../config/env.js";
import {
	formatOutlineFieldBlock,
	getScopeBriefMeta,
	parseScopeBrief,
	scopeOutlineBodyInstructions,
	scopeOutlineSystemPrompt,
} from "../lib/research-scope-brief.js";
import { getScopeProfile } from "../lib/research-scope-profiles.js";
import type { TokenUsage } from "../types/token-usage.js";
import { formatNarrativeCite, formatParentheticalCite, paperFamilyNames, citeYear } from "../lib/citation-bank.js";
import {
	dropOffTopicPapers,
	fetchPapersForQuery,
	isHealthResearchTopic,
	isHigherEducationTopic,
	preferHigherEducationPapers,
	type AlphaXivPaper,
} from "./alphaxiv.service.js";
import { rerankPapers } from "./huggingface.service.js";
import { completeOpenRouterChat } from "./llm.service.js";

export type OutlineIdeaInput = {
	title: string;
	rationale: string;
	approach: string;
	type: string;
	feasibility: string;
	outline?: string;
	researchQuestions?: string[];
};

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

export const RESEARCH_SCOPE_IDS: ResearchScope[] = [
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

const LEGACY_SCOPE_MAP: Record<string, ResearchScope> = {
	undergraduate: "undergraduate_project",
	masters: "thesis",
	doctoral: "dissertation",
	phd: "dissertation",
};

export function normalizeResearchScope(scope: string | null | undefined): ResearchScope | null {
	if (!scope) return null;
	const mapped = LEGACY_SCOPE_MAP[scope] ?? scope;
	return RESEARCH_SCOPE_IDS.includes(mapped as ResearchScope) ? (mapped as ResearchScope) : null;
}

export type GenerateOutlineInput = {
	idea: OutlineIdeaInput;
	disciplineLabel: string;
	topic: string;
	scope: ResearchScope;
	sourceContext?: string;
	/** Faster outline when selected source material is already attached. */
	fast?: boolean;
	/** Coursework brief / lecturer instructions for assignment outlines. */
	assignmentInstructions?: string;
};

const SCOPE_LABELS: Record<ResearchScope, string> = {
	assignment: "Assignment",
	conference: "Conference paper",
	dissertation: "Dissertation",
	faculty: "Faculty / grant",
	journal: "Journal/Research Paper",
	proposal: "Research proposal",
	report: "Project report",
	thesis: "Thesis",
	undergraduate_project: "Undergraduate project",
};

const TYPE_LABELS: Record<string, string> = {
	empirical: "Empirical",
	theoretical: "Theoretical",
	interdisciplinary: "Interdisciplinary",
	applied: "Applied",
};

const FEASIBILITY_LABELS: Record<string, string> = {
	high: "High feasibility",
	medium: "Moderate scope",
	exploratory: "Exploratory",
};

/** Max words for the outline body; "Sources for further reading" is added separately. */
export const OUTLINE_BODY_MAX_WORDS = 2200;

function formatPapersForOutlineContext(papers: AlphaXivPaper[]): string {
	if (papers.length === 0) {
		return "No matching papers were found for this topic. Do not invent authors, years, or titles. Ground the outline only in the study title and user-supplied material.";
	}

	return papers
		.map((paper, index) => {
			const authorLine = formatPaperAuthors(paper.authors);
			const year = citeYear(paper);
			const abstract = paper.abstract
				? paper.abstract.replace(/\s+/g, " ").trim().slice(0, 400)
				: "Abstract unavailable.";
			const cite = formatParentheticalCite(paper, index, false);
			const narrative = formatNarrativeCite(paper, index, false);

			return `${index + 1}. ${authorLine} (${year}). "${paper.title.replace(/"/g, "")}". USE THIS CITE: ${cite}. USE THIS NARRATIVE CITE: ${narrative}. ${abstract}`;
		})
		.join("\n\n");
}

function buildAssignmentOutlinePrompt(input: GenerateOutlineInput, paperContext: string): string {
	const { idea, disciplineLabel, topic } = input;
	const instructions = input.assignmentInstructions?.trim() || idea.rationale.trim();
	const uploaded = input.sourceContext?.trim();

	return `You are outlining a coursework assignment in ${disciplineLabel} — not a thesis, journal article, or empirical study.

**Deliverable type:** Assignment
**Final document structure guidance:** ${getScopeProfile("assignment").outlineGuidance}

**Assignment topic (use this as the assignment focus):** ${topic.trim() || idea.title}
**Selected title:** ${idea.title}

${instructions ? `**Additional notes:**\n${instructions}\n` : ""}
${uploaded ? `\n**Uploaded assignment brief (extracted text — treat as brief text, not empirical data):**\n${uploaded}\n` : ""}

Map the outline to the topic. Develop an argumentative assignment that answers the topic using retrieved literature. If uploaded brief text lists questions, map each question to a section. Honour any word limit, theories, structure, or referencing specified in uploaded text.

Use the following retrieved papers as literature for the assignment. Do not invent papers outside this list. Cite them as Author (year) only.

${paperContext}

Return a structured Markdown outline with these sections IN THIS EXACT ORDER.
Use bold section titles on their own lines. Use bullet/numbered lists — never markdown tables or pipe characters.

**Assignment Outline**

**1. Title**
The assignment title, aligned to the topic.

**2. Introduction**
How the assignment will address the topic (aims, key terms, roadmap). Short academic paragraphs.

**3. Literature themes**
Thematic strands of prior work that support answering the topic (cite Author (year) from the paper list). No paper-by-paper list.

**4. Argument / critical analysis**
The points the assignment will develop to answer the topic. If uploaded brief text numbered questions, list a response plan for each.

**5. Conclusion takeaways**
What the assignment will conclude, tied back to the topic.

Do NOT include Methodology, Methods, Results, Findings, Hypotheses, Abstract, Keywords, or a project timeline.
Do NOT include a "Sources for further reading" section — it will be added separately.
Do NOT mention preprint servers, repository names, or ID numbers.
Do not use markdown tables.
Use bold-only section titles — never hash (#) headings or horizontal rules.

Keep the outline body to at most ${OUTLINE_BODY_MAX_WORDS} words (excluding any sources section).

Deliver the full outline directly — no prefatory commentary.`;
}

function headingMapFor(scope: ResearchScope): string {
	const profile = getScopeProfile(scope);
	return profile.headings
		.filter((heading) => heading !== "Title" && heading !== "References")
		.map((heading, index) => `${index + 1}. **${heading}** — 2–5 bullets of what this section will contain.`)
		.join("\n");
}

function buildDissertationOutlinePrompt(input: GenerateOutlineInput, paperContext: string): string {
	const { idea, disciplineLabel, topic } = input;
	const profile = getScopeProfile("dissertation");
	const fields = parseScopeBrief("dissertation", input.assignmentInstructions, idea.researchQuestions);
	const notebookContext = input.sourceContext?.trim();
	const headingMap = headingMapFor("dissertation");
	const sectionRules = profile.sectionJobs.map((job) => `- ${job}`).join("\n");
	const hasUserQuestions = fields.questionsList.length > 0;
	const questionsBlock = hasUserQuestions
		? fields.questionsList.map((q, i) => `${i + 1}. ${q}`).join("\n")
		: "None supplied — derive 3–5 doctoral questions from the title. Do not invent a padded 5–7 set.";
	const degree = fields.values.degree?.trim() ?? "";
	const contributions = fields.values.contributions?.trim() ?? "";
	const extraBlocks = [
		degree ? `**Degree / university (put on Title Page):** ${degree}` : "",
		`**Research questions${hasUserQuestions ? " (use this set — refine wording only; do not replace, drop, or pad to 5–7)" : ""}:**\n${questionsBlock}`,
		contributions
			? `**Intended contributions (map these into Expected contributions and the Contributions section):**\n${contributions}`
			: "",
		fields.notes
			? `**Doctoral notes (committee/handbook constraints — not empirical data):**\n${fields.notes}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");

	const notebookBlock = notebookContext
		? `\n**Selected notebook / private source material:**\n${notebookContext}\n\nUse this material to ground the dissertation title, problem statement, methodology, and evidence planning where relevant. Use notebook pages, lab entries, documents, datasets, surveys, and response files when present. Treat figures/images as metadata-only context (titles, filenames, captions, linked notes) rather than raw image understanding. Do not contradict the selected notebook material, and distinguish it from published literature.\n`
		: "";

	return `You are outlining a doctoral dissertation in ${disciplineLabel} — not a journal article, master's thesis, or coursework assignment.

**Deliverable type:** Dissertation
**Final document structure guidance:** ${profile.outlineGuidance}
**Required finished-document headings (exact order):** ${profile.headings.join(" → ")}

**Dissertation title / topic:** ${topic.trim() || idea.title}
**Selected title:** ${idea.title}
${extraBlocks ? `\n${extraBlocks}\n` : ""}
${notebookBlock}
Calibrate ambition and methods to a doctoral dissertation. Theoretical Framework must be distinct from Literature Review.

Use the following retrieved papers as primary sources for the literature review. Do not invent papers outside this list. Cite them as Author (year) only.

${paperContext}

Return a structured Markdown outline with these sections IN THIS EXACT ORDER.
Use bold section titles on their own lines. Use bullet/numbered lists — never markdown tables or pipe characters.

**Dissertation Outline**

**1. Title Page**
Working title${degree ? " plus degree/university when supplied" : ""}. Citation-free front-matter notes (Dedication, Lists of Tables/Figures stay citation-free in the finished document).

**2. Introduction**
Write three labeled subsections as short academic paragraphs (not one-line stubs):
- **Background:** Situate the topic in ${disciplineLabel}; define key constructs.
- **Problem statement:** State a clear doctoral research problem / knowledge deficit.
- **Significance:** Scholarly importance at dissertation level. State the research questions the outline will answer.

**3. Research questions**
${
	hasUserQuestions
		? "Numbered list of the candidate questions above. Refine wording for precision only. Do not add filler questions to reach 5–7."
		: "Numbered list of 3–5 investigable doctoral questions derived from the title. Do not pad to 5–7."
}

**4. Literature review**
Three labeled parts:
- **Themes:** Organised strands of prior work (cite Author (year) from the paper list)
- **Gap:** Precise gap this dissertation will address
Keep this distinct from Theoretical Framework — do not name-and-justify the theory here.

**5. Theoretical Framework**
Name the theory, justify it for this dissertation, and show how it organises the research questions and analysis. Distinct from Literature Review.

**6. Methodology**
Cover: research design; population/sample; data collection; data analysis; ethical considerations. Be concrete and feasible for a doctoral dissertation. No findings.

**7. Expected contributions**
${
	contributions
		? "Start from the intended-contributions field. Organise as theoretical, empirical, and/or methodological bullets. These become the finished **Contributions** section — not a restated Conclusion."
		: "Bullets for theoretical, empirical, and/or methodological contributions aligned to the research questions."
}

**8. Scope and limitations**
Bullets for study boundaries and acknowledged limitations.

**9. Suggested timeline**
Use **Phase** subheadings with short paragraph descriptions (not tables), calibrated to a doctoral dissertation.

**10. Final document section map**
Plan the finished dissertation against these exact headings (do not rename them):
${headingMap}

Hard writing rules for this deliverable:
${sectionRules}

Research-question rules:
- ${hasUserQuestions ? "Keep the user's questions as the set; refine wording only" : "Derive 3–5 doctoral questions from the title; do not pad to 5–7"}
- Name key variables/constructs and, where relevant, population/setting
- Prefer interrogative form ending with "?"
- Do not invent extra questions to pad the list

Do NOT include a "Sources for further reading" section — it will be added separately.
Do NOT mention preprint servers, repository names, or ID numbers.
Do not use markdown tables.
Use bold-only section titles — never hash (#) headings or horizontal rules.
Keep the outline body to at most ${OUTLINE_BODY_MAX_WORDS} words (excluding any sources section). Prefer substantive paragraphs in Introduction and Literature review over filler.

Deliver the full outline directly — no prefatory commentary.`;
}

function buildTypedOutlinePrompt(input: GenerateOutlineInput, paperContext: string): string {
	const { idea, disciplineLabel, topic, scope } = input;
	const profile = getScopeProfile(scope);
	const meta = getScopeBriefMeta(scope);
	const parsed = parseScopeBrief(scope, input.assignmentInstructions, idea.researchQuestions);
	const fieldBlock = formatOutlineFieldBlock(scope, parsed);
	const notebookContext = input.sourceContext?.trim();
	const headingMap = headingMapFor(scope);
	const sectionRules = profile.sectionJobs.map((job) => `- ${job}`).join("\n");
	const body = scopeOutlineBodyInstructions(scope, parsed);
	const isProposal = scope === "proposal" || scope === "faculty";
	const notebookBlock = notebookContext
		? `\n**Selected notebook / private source material:**\n${notebookContext}\n\nUse this material to ground the title, problem statement, methodology, findings/expected findings, and contribution claims where relevant. Use notebook pages, lab entries, documents, datasets, surveys, and response files when present. Treat figures/images as metadata-only context (titles, filenames, captions, linked notes) rather than raw image understanding. Do not contradict the selected notebook material, and distinguish it from published literature.\n`
		: "";

	return `You are outlining a ${profile.label} in ${disciplineLabel} — ${meta?.notThis ?? "honour this deliverable type"}.

**Deliverable type:** ${profile.label}
**Final document structure guidance:** ${profile.outlineGuidance}
**Required finished-document headings (exact order):** ${profile.headings.join(" → ")}

**Title / topic:** ${topic.trim() || idea.title}
**Selected title:** ${idea.title}
${fieldBlock ? `\n${fieldBlock}\n` : ""}
${notebookBlock}
Honour every labeled intake field above. Calibrate ambition and methods to a ${profile.label}.

Use the following retrieved papers as primary sources for the literature review. Do not invent papers outside this list. Cite them as Author (year) only.

${paperContext}

Return a structured Markdown outline with these sections IN THIS EXACT ORDER.
Use bold section titles on their own lines. Use bullet/numbered lists — never markdown tables or pipe characters.

${body}
Plan the finished ${profile.label} against these exact headings (do not rename them):
${headingMap}

Hard writing rules for this deliverable:
${sectionRules}

Do NOT include a "Sources for further reading" section — it will be added separately.
Do NOT mention preprint servers, repository names, or ID numbers.
Do not use markdown tables.
Use bold-only section titles — never hash (#) headings or horizontal rules.
${isProposal ? "Do NOT include Results, Findings, or completed empirical outcomes anywhere in the outline.\n" : ""}
Keep the outline body to at most ${OUTLINE_BODY_MAX_WORDS} words (excluding any sources section).

Deliver the full outline directly — no prefatory commentary.`;
}

function buildOutlinePrompt(input: GenerateOutlineInput, paperContext: string): string {
	if (input.scope === "assignment") {
		return buildAssignmentOutlinePrompt(input, paperContext);
	}
	if (input.scope === "dissertation") {
		return buildDissertationOutlinePrompt(input, paperContext);
	}
	if (scopeOutlineSystemPrompt(input.scope, false)) {
		return buildTypedOutlinePrompt(input, paperContext);
	}

	const { idea, disciplineLabel, topic, scope } = input;
	const profile = getScopeProfile(scope);
	const scopeLabel = SCOPE_LABELS[scope] ?? scope;
	const typeLabel = TYPE_LABELS[idea.type] ?? idea.type;
	const feasibilityLabel = FEASIBILITY_LABELS[idea.feasibility] ?? idea.feasibility;
	const isProposal = scope === "proposal" || scope === "faculty";
	const needsHypothesis =
		!isProposal &&
		(idea.type === "empirical" || idea.type === "applied" || idea.type === "interdisciplinary");
	const priorQuestions = (idea.researchQuestions ?? []).filter((q) => q.trim().length > 8);
	const priorOutline = idea.outline?.trim() ?? "";
	const userBrief = input.assignmentInstructions?.trim();
	const headingMap = profile.headings
		.filter((heading) => heading !== "Title" && heading !== "References")
		.map((heading, index) => `${index + 1}. **${heading}** — 2–5 bullets of what this section will contain.`)
		.join("\n");
	const sectionRules = profile.sectionJobs.map((job) => `- ${job}`).join("\n");
	const sourceBlock = input.sourceContext
		? userBrief
			? `\n**Uploaded instructions (CFP, handbook, guidelines, or ToR — not empirical data):**\n${input.sourceContext}\n`
			: `\n**User-selected source material:**\n${input.sourceContext}\n\nUse this private material as the primary grounding for the study title focus, problem statement, methodology, findings/expected findings, and contribution claims. Align the outline with the suggested interest topic/title and notebook content when present. Use notebook pages, lab entries, documents, datasets, surveys, and response files where relevant. Treat figures/images as metadata-only context (titles, filenames, captions, linked notes) rather than raw image understanding. Do not contradict the selected notebook material. Clearly distinguish user-provided data/findings from published literature.\n`
		: "";

	return `You are a senior academic research methodologist and thesis supervisor. Write a rigorous, publication-ready research OUTLINE for a ${scopeLabel} in ${disciplineLabel}.

**Deliverable type:** ${scopeLabel}
**Final document structure guidance:** ${profile.outlineGuidance}
**Required finished-document headings (exact order):** ${profile.headings.join(" → ")}

**Broad interest area:** ${topic.trim()}
**Selected study title / focus:** ${idea.title}
**Type:** ${typeLabel}
**Feasibility:** ${feasibilityLabel}
**Rationale:** ${idea.rationale}
**Suggested approach:** ${idea.approach}
${userBrief ? `\n**User instructions / constraints (honour these):**\n${userBrief}\n` : ""}
${priorQuestions.length ? `\n**Candidate research questions (refine/improve as needed):**\n${priorQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : ""}
${priorOutline ? `\n**Candidate focus points:**\n${priorOutline}` : ""}
${sourceBlock}
Calibrate ambition, methods, and timeline language to a ${scopeLabel}. ${
		isProposal
			? "Plan methods, timeline, expected outcomes, and budget — do NOT invent completed Results or Findings."
			: scope === "report"
				? "Map the outline to an applied report: executive summary, findings, analysis, and actionable recommendations — not a journal Results/Discussion pair."
				: "For undergraduate/thesis/dissertation, the final-document section map must use that deliverable’s chapter/heading names."
	}

Use the following retrieved papers as primary sources for the literature review. Do not invent papers outside this list. Cite them as Author (year) only.

${paperContext}

Return a structured Markdown outline with these sections IN THIS EXACT ORDER.
Use bold section titles on their own lines (e.g. **1. Introduction**). Use bold subsection labels where shown. Use bullet/numbered lists — never markdown tables or pipe characters.

**Research Outline**

**1. Introduction**
Write three labeled subsections as short academic paragraphs (not one-line stubs):
- **Background:** Situate the topic in ${disciplineLabel}; define key constructs; establish why the topic matters now.
- **Problem statement:** State a clear research problem / knowledge deficit with variables, population, and setting where relevant.
- **Significance:** Explain scholarly, practical, and/or policy importance at the ${scopeLabel} level.

**2. Research questions**
Numbered list of 5–7 investigable academic research questions (see rules below). Do not paste only the study title. Prefer the candidate questions when supplied.

**3. Hypotheses**
${
	needsHypothesis
		? `For this ${typeLabel.toLowerCase()} study, provide numbered testable hypotheses aligned to the main questions (directional or H0/H1). Mark any purely descriptive question as a proposition rather than a statistical hypothesis.`
		: isProposal
			? "State **Not applicable** for completed-study hypotheses. Offer 2–4 planned propositions or expected relationships the study will test."
			: `State **Not applicable** for statistical hypotheses, then offer 2–4 theoretical propositions if useful for this ${typeLabel.toLowerCase()} design.`
}

**4. Objectives**
- One **general objective** paragraph
- Numbered **specific objectives** (3–6) that map to the research questions

**5. Literature review**
Three labeled parts:
- **Themes:** Organised strands of prior work (cite Author (year) from the paper list)
- **Framework:** Named theoretical/conceptual framework and how it organises the study
- **Gap:** Precise gap this outline will address (methods, context, population, or theory)

**6. Methodology**
${
	isProposal
		? "Describe planned methods only: research design; population/sample; data collection; data analysis; ethical considerations. No findings."
		: `Cover: research design; population/sample; data collection; data analysis; ethical considerations. Be concrete and feasible for ${scopeLabel}.`
}

**7. Expected contributions**
Bullets for theoretical, empirical, and/or practical contributions.

**8. Scope and limitations**
Bullets for study boundaries and acknowledged limitations.

**9. Suggested timeline**
Use **Phase** subheadings with short paragraph descriptions (not tables), calibrated to ${scopeLabel}.

**10. Final document section map**
Plan the finished ${scopeLabel} against these exact headings (do not rename them):
${headingMap}

Hard writing rules for this deliverable:
${sectionRules}

Research-question rules:
- Clear, specific, answerable at the ${scopeLabel} level
- Name key variables/constructs and, where relevant, population/setting
- Prefer interrogative form ending with "?"
- Align with ${typeLabel} methods
- Coherent set: one overarching question plus focused sub-questions

Do NOT include a "Sources for further reading" section — it will be added separately.
Do NOT mention preprint servers, repository names, or ID numbers.
Do not use markdown tables.
Use bold-only section titles — never hash (#) headings or horizontal rules.
${isProposal ? "Do NOT include Results, Findings, or completed empirical outcomes anywhere in the outline.\n" : ""}
Keep the outline body to at most ${OUTLINE_BODY_MAX_WORDS} words (excluding any sources section). Prefer substantive paragraphs in Introduction and Literature review over filler.

Deliver the full outline directly — no prefatory commentary.`;
}

function formatPaperAuthors(authors: string[]): string {
	const names = paperFamilyNames(authors);
	if (names.length === 0) return "Unknown authors";
	if (names.length === 1) return names[0]!;
	if (names.length === 2) return `${names[0]} & ${names[1]}`;
	return `${names[0]} et al.`;
}

function formatEmbeddedSourceEntry(paper: AlphaXivPaper, index: number): string {
	const authorLine = formatPaperAuthors(paper.authors);
	const year = citeYear(paper);
	const title = paper.title.replace(/\*/g, "");
	const titleLink = paper.url ? `[*${title}*](${paper.url})` : `*${title}*`;
	const relevance = paper.abstract
		? paper.abstract.replace(/\s+/g, " ").trim().slice(0, 220) +
			(paper.abstract.replace(/\s+/g, " ").trim().length > 220 ? "…" : "")
		: "Relevant primary literature for this research question.";

	return `${index + 1}. ${authorLine} (${year}). ${titleLink}.\n   ${relevance}`;
}

function stripArxivMetaFromOutline(outline: string): string {
	return outline
		.replace(/\n(?:## Sources for further reading|\*\*Sources for further reading\*\*)[\s\S]*$/i, "")
		.replace(/\barXiv preprint\b[^.\n]*\.?/gi, "")
		.replace(/\barXiv:\s*[\d.]+[a-z]?\b/gi, "")
		.replace(/^.*\b(retrieved from|papers were found via)\b.*\n?/gim, "")
		.replace(/<!--\s*aula-outline:local\s*-->/gi, "")
		.trim();
}

function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function trimOutlineBodyToWordLimit(text: string, maxWords: number): string {
	const trimmed = text.trim();
	if (countWords(trimmed) <= maxWords) return trimmed;

	const paragraphs = trimmed.split(/\n\n+/);
	let result = "";

	for (const paragraph of paragraphs) {
		const candidate = result ? `${result}\n\n${paragraph}` : paragraph;
		if (countWords(candidate) > maxWords) break;
		result = candidate;
	}

	if (result && countWords(result) > 0) return result.trim();

	const words = trimmed.split(/\s+/).filter(Boolean);
	return `${words.slice(0, maxWords).join(" ")}…`;
}

function injectEmbeddedSourcesSection(outline: string, papers: AlphaXivPaper[]): string {
	const cleaned = trimOutlineBodyToWordLimit(stripArxivMetaFromOutline(outline), OUTLINE_BODY_MAX_WORDS);
	if (papers.length === 0) return cleaned;

	const sectionHeader = "**Sources for further reading**";
	const sourcesBlock = [sectionHeader, "", ...papers.map((paper, index) => formatEmbeddedSourceEntry(paper, index))].join(
		"\n\n",
	);

	return `${cleaned}\n\n${sourcesBlock}`;
}

export async function generateResearchOutline(
	input: GenerateOutlineInput,
	options?: { signal?: AbortSignal },
): Promise<{ outline: string; papers: AlphaXivPaper[]; usage?: TokenUsage }> {
	const briefSnippet = (input.assignmentInstructions ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 180);
	const searchQuery = [
		input.topic.trim(),
		input.idea.title.replace(/\?$/, ""),
		input.disciplineLabel,
		briefSnippet,
	]
		.filter(Boolean)
		.filter((part, index, all) => all.indexOf(part) === index)
		.join(" ");

	const fast = Boolean(input.fast || input.sourceContext?.trim());
	/** Outline needs themes/sources, not the full 30-paper cite bank (chat-paper re-fetches that). */
	const paperLimit = fast ? 4 : 15;
	const maxTokens = fast ? 2200 : 4000;

	const preferHealth =
		isHealthResearchTopic(searchQuery) || isHealthResearchTopic(input.disciplineLabel);
	const fetched = await fetchPapersForQuery(searchQuery, {
		limit: paperLimit,
		signal: options?.signal,
		preferHealth,
	});
	const papers = preferHigherEducationPapers(
		dropOffTopicPapers(
			await rerankPapers(searchQuery, fetched, { signal: options?.signal }),
			preferHealth,
		),
		isHigherEducationTopic(searchQuery) || isHigherEducationTopic(input.disciplineLabel),
	);
	const paperContext = formatPapersForOutlineContext(papers);

	const isAssignment = input.scope === "assignment";
	const isDissertation = input.scope === "dissertation";
	const typedSystem = scopeOutlineSystemPrompt(input.scope, fast);
	const assignmentSystem =
		"You write coursework assignment outlines in Markdown. Use bold-only section titles. Structure: **1. Title**, **2. Introduction**, **3. Literature themes**, **4. Argument / critical analysis**, **5. Conclusion takeaways**. Fulfil the typed topic. Never include Methodology, Methods, Results, Findings, Hypotheses, Abstract, or a project timeline. Cite Author (year) only. Keep under 2200 words before sources.";
	const dissertationSystem = fast
		? "You write concise doctoral dissertation outlines in Markdown. Use bold-only section titles. Structure: **1. Title Page**, **2. Introduction**, **3. Research questions**, **4. Literature review**, **5. Theoretical Framework**, **6. Methodology**, **7. Expected contributions**, **8. Scope and limitations**, **9. Suggested timeline**, **10. Final document section map** using the dissertation headings from the user message. Derive 3–5 doctoral research questions from the title unless the user supplied a set. Propose theoretical, empirical, and/or methodological contributions. Cite Author (year) only. Keep under 1200 words before sources."
		: "You write rigorous doctoral dissertation outlines in Markdown. Use bold-only section titles on their own lines — never hash (#) headings. Structure: **1. Title Page**, **2. Introduction** (Background, Problem statement, Significance as paragraphs), **3. Research questions** (derive 3–5 from the title unless the user supplied a set — refine wording only; do not pad to 5–7), **4. Literature review** (Themes and Gap only — theory belongs in the next section), **5. Theoretical Framework** (name, justify, and show how it organises the questions), **6. Methodology**, **7. Expected contributions** (theoretical, empirical, and/or methodological), **8. Scope and limitations**, **9. Suggested timeline**, **10. Final document section map** using the dissertation headings from the user message. Never collapse to journal IMRaD. Use provided papers for literature review only; cite Author (year). Never mention preprint servers, repository names, or paper IDs. Keep the body under 2200 words before sources.";
	const { text: rawOutline, usage } = await completeOpenRouterChat(
		[
			{
				role: "system",
				content: isAssignment
					? assignmentSystem
					: isDissertation
						? dissertationSystem
						: typedSystem
							? typedSystem
							: fast
							? "You write concise academic research outlines in Markdown. Use bold-only section titles. Structure: **1. Introduction**, **2. Research questions**, **3. Hypotheses**, **4. Objectives**, **5. Literature review**, **6. Methodology**, **7. Expected contributions**, **8. Scope and limitations**, **9. Suggested timeline**, **10. Final document section map** matching the deliverable’s exact headings. Prefer brevity when user evidence is supplied. Cite Author (year) only. Keep under 1200 words before sources."
							: "You write rigorous, supervisor-quality academic research outlines in Markdown. Use bold-only section titles on their own lines — never hash (#) headings. Always structure: **1. Introduction** (Background, Problem statement, Significance as paragraphs), **2. Research questions** (5–7 numbered questions), **3. Hypotheses** (or Not applicable + propositions), **4. Objectives**, **5. Literature review** (Themes, Framework, Gap), **6. Methodology**, **7. Expected contributions**, **8. Scope and limitations**, **9. Suggested timeline**, **10. Final document section map** using the deliverable’s exact headings from the user message. Never paste only a study title as the research question. Use provided papers for literature review only; cite Author (year). Never mention preprint servers, repository names, or paper IDs. Keep the body under 2200 words before sources.",
			},
			{
				role: "user",
				content: buildOutlinePrompt(input, paperContext),
			},
		],
		{ signal: options?.signal, maxTokens, model: getOpenRouterOutlineModel() },
	);

	const outline = injectEmbeddedSourcesSection(rawOutline.trim(), papers);

	return { outline, papers, usage };
}
