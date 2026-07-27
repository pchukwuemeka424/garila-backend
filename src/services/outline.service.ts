import { getOpenRouterOutlineModel } from "../config/env.js";
import type { TokenUsage } from "../types/token-usage.js";
import { fetchPapersForQuery, type AlphaXivPaper } from "./alphaxiv.service.js";
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

export type ResearchScope = "undergraduate" | "masters" | "doctoral" | "faculty";

export type GenerateOutlineInput = {
	idea: OutlineIdeaInput;
	disciplineLabel: string;
	topic: string;
	scope: ResearchScope;
	sourceContext?: string;
	/** Faster outline when research-note evidence is already attached. */
	fast?: boolean;
};

const SCOPE_LABELS: Record<ResearchScope, string> = {
	undergraduate: "Undergraduate",
	masters: "Master's thesis",
	doctoral: "Doctoral research",
	faculty: "Faculty / grant",
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
		return "No matching papers were found for this topic.";
	}

	return papers
		.map((paper, index) => {
			const authorLine = formatPaperAuthors(paper.authors);
			const year = paperYear(paper.publicationDate);
			const abstract = paper.abstract
				? paper.abstract.replace(/\s+/g, " ").trim().slice(0, 400)
				: "Abstract unavailable.";

			return `${index + 1}. ${authorLine} (${year}). "${paper.title.replace(/"/g, "")}". ${abstract}`;
		})
		.join("\n\n");
}

function buildOutlinePrompt(input: GenerateOutlineInput, paperContext: string): string {
	const { idea, disciplineLabel, topic, scope } = input;
	const scopeLabel = SCOPE_LABELS[scope] ?? scope;
	const typeLabel = TYPE_LABELS[idea.type] ?? idea.type;
	const feasibilityLabel = FEASIBILITY_LABELS[idea.feasibility] ?? idea.feasibility;
	const needsHypothesis =
		idea.type === "empirical" || idea.type === "applied" || idea.type === "interdisciplinary";
	const priorQuestions = (idea.researchQuestions ?? []).filter((q) => q.trim().length > 8);
	const priorOutline = idea.outline?.trim() ?? "";

	return `You are a senior academic research methodologist and thesis supervisor. Write a rigorous, publication-ready research OUTLINE for a ${scopeLabel}-level project in ${disciplineLabel}.

**Broad interest area:** ${topic.trim()}
**Selected study title / focus:** ${idea.title}
**Type:** ${typeLabel}
**Feasibility:** ${feasibilityLabel}
**Rationale:** ${idea.rationale}
**Suggested approach:** ${idea.approach}
${priorQuestions.length ? `\n**Candidate research questions (refine/improve as needed):**\n${priorQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")}` : ""}
${priorOutline ? `\n**Candidate focus points:**\n${priorOutline}` : ""}
${input.sourceContext ? `\n**User-selected research note / source material:**\n${input.sourceContext}\n\nUse this private material as the primary grounding for the study title focus, problem statement, methodology, and expected findings. Align the outline with the research note's suggested interest topic/title and content. Clearly distinguish user-provided data/findings from published literature.` : ""}

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
Numbered list of 5–7 investigable academic research questions (see rules below). Do not paste only the study title.

**3. Hypotheses**
${
	needsHypothesis
		? `For this ${typeLabel.toLowerCase()} study, provide numbered testable hypotheses aligned to the main questions (directional or H0/H1). Mark any purely descriptive question as a proposition rather than a statistical hypothesis.`
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
Cover: research design; population/sample; data collection; data analysis; ethical considerations. Be concrete and feasible for ${scopeLabel}.

**7. Expected contributions**
Bullets for theoretical, empirical, and/or practical contributions.

**8. Scope and limitations**
Bullets for study boundaries and acknowledged limitations.

**9. Suggested timeline**
Use **Phase** subheadings with short paragraph descriptions (not tables), calibrated to ${scopeLabel}.

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

Keep the outline body to at most ${OUTLINE_BODY_MAX_WORDS} words (excluding any sources section). Prefer substantive paragraphs in Introduction and Literature review over filler.

Deliver the full outline directly — no prefatory commentary.`;
}

function formatPaperAuthors(authors: string[]): string {
	if (authors.length === 0) return "Unknown authors";
	if (authors.length === 1) return authors[0]!;
	if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
	return `${authors[0]} et al.`;
}

function paperYear(publicationDate: string | null): string {
	if (!publicationDate) return "n.d.";
	const year = new Date(publicationDate).getFullYear();
	return Number.isFinite(year) ? String(year) : "n.d.";
}

function formatEmbeddedSourceEntry(paper: AlphaXivPaper, index: number): string {
	const authorLine = formatPaperAuthors(paper.authors);
	const year = paperYear(paper.publicationDate);
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
	const searchQuery = [input.topic.trim(), input.idea.title.replace(/\?$/, ""), input.disciplineLabel]
		.filter(Boolean)
		.join(" ");

	const fast = Boolean(input.fast || input.sourceContext?.trim());
	const paperLimit = fast ? 4 : 8;
	const maxTokens = fast ? 2200 : 4000;

	const papers = await fetchPapersForQuery(searchQuery, { limit: paperLimit, signal: options?.signal });
	const paperContext = formatPapersForOutlineContext(papers);

	const { text: rawOutline, usage } = await completeOpenRouterChat(
		[
			{
				role: "system",
				content: fast
					? "You write concise academic research outlines in Markdown. Use bold-only section titles. Structure: **1. Introduction**, **2. Research questions**, **3. Hypotheses**, **4. Objectives**, **5. Literature review**, **6. Methodology**, **7. Expected contributions**, **8. Scope and limitations**, **9. Suggested timeline**. Prefer brevity when user evidence is supplied. Cite Author (year) only. Keep under 1200 words before sources."
					: "You write rigorous, supervisor-quality academic research outlines in Markdown. Use bold-only section titles on their own lines — never hash (#) headings. Always structure: **1. Introduction** (Background, Problem statement, Significance as paragraphs), **2. Research questions** (5–7 numbered questions), **3. Hypotheses** (or Not applicable + propositions), **4. Objectives**, **5. Literature review** (Themes, Framework, Gap), **6. Methodology**, **7. Expected contributions**, **8. Scope and limitations**, **9. Suggested timeline**. Never paste only a study title as the research question. Use provided papers for literature review only; cite Author (year). Never mention preprint servers, repository names, or paper IDs. Keep the body under 2200 words before sources.",
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
