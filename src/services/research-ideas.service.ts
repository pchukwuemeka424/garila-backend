import { getOpenRouterFastModel } from "../config/env.js";
import type { TokenUsage } from "../types/token-usage.js";
import { completeOpenRouterChat } from "./llm.service.js";
import type { ResearchScope } from "./outline.service.js";

export type GenerateResearchIdeasInput = {
	disciplineLabel: string;
	topic: string;
	scope: ResearchScope;
	sourceContext?: string;
};

export type ResearchScopeAnalysis = {
	discipline: string;
	researchArea: string;
	variables: string[];
	constructs: string[];
	phenomena: string[];
};

export type ResearchContextAndGap = {
	population: string;
	context: string;
	domain: string;
	researchGap: string;
};

export type ResearchTopicAnalysis = {
	scope: ResearchScopeAnalysis;
	contextAndGap: ResearchContextAndGap;
};

export type GenerateResearchIdeasResult = {
	ideasMarkdown: string;
	analysis: ResearchTopicAnalysis;
	usage?: TokenUsage;
};

const SCOPE_LABELS: Record<ResearchScope, string> = {
	undergraduate: "Undergraduate",
	masters: "Master's thesis",
	doctoral: "Doctoral research",
	faculty: "Faculty / grant",
};

const VAGUE_TITLE_EXAMPLES = [
	"Artificial Intelligence in Education",
	"Social Media and Business Growth",
	"Cybersecurity Challenges",
	"Machine Learning Applications in Healthcare",
	"Climate Change Effects",
];

const TITLE_QUALITY_RULES = `STRICT RULES — titles must be publishable academic studies, NOT broad themes.

DO NOT generate vague titles such as:
${VAGUE_TITLE_EXAMPLES.map((t) => `- ${t}`).join("\n")}

INSTEAD each title MUST specify:
- What is being studied (dependent/independent variables or focal phenomenon)
- Which variables, constructs, or mechanisms are involved
- Who or what is being studied (population, sample, units of analysis)
- The context or setting (geography, institution type, time window, sector)
- The analytical perspective (comparative, longitudinal, experimental, mixed-methods, etc.)

Good title pattern: "[Relationship/effect of X on Y among Z in context C using method/perspective P]"
Titles may be phrased as research questions or declarative study titles.`;

function mergeUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
	if (!a) return b;
	if (!b) return a;
	return {
		promptTokens: a.promptTokens + b.promptTokens,
		completionTokens: a.completionTokens + b.completionTokens,
		totalTokens: a.totalTokens + b.totalTokens,
	};
}

function extractJsonObject<T>(text: string): T {
	const trimmed = text.trim();
	const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenceMatch?.[1]?.trim() ?? trimmed;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("Agent did not return valid JSON.");
	}
	return JSON.parse(candidate.slice(start, end + 1)) as T;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeScopeAnalysis(raw: Partial<ResearchScopeAnalysis>, disciplineLabel: string, topic: string): ResearchScopeAnalysis {
	return {
		discipline: raw.discipline?.trim() || disciplineLabel,
		researchArea: raw.researchArea?.trim() || topic.trim(),
		variables: asStringArray(raw.variables),
		constructs: asStringArray(raw.constructs),
		phenomena: asStringArray(raw.phenomena),
	};
}

function normalizeContextAndGap(raw: Partial<ResearchContextAndGap>, topic: string): ResearchContextAndGap {
	return {
		population: raw.population?.trim() || "To be specified in study design",
		context: raw.context?.trim() || topic.trim(),
		domain: raw.domain?.trim() || topic.trim(),
		researchGap: raw.researchGap?.trim() || "Under-specified gap — refine during literature review",
	};
}

async function runScopeAndContextAnalyst(
	input: GenerateResearchIdeasInput,
	options?: { signal?: AbortSignal },
): Promise<{ scope: ResearchScopeAnalysis; contextAndGap: ResearchContextAndGap; usage?: TokenUsage }> {
	const scopeLabel = SCOPE_LABELS[input.scope];
	const { text, usage } = await completeOpenRouterChat(
		[
			{
				role: "system",
				content:
					"You analyse a scholar's interest into scope (discipline, variables) and context (population, gap). Return ONLY valid JSON — no markdown.",
			},
			{
				role: "user",
				content: `Analyse this ${scopeLabel}-level interest in ${input.disciplineLabel}.

Interest statement: "${input.topic.trim()}"
${input.sourceContext ? `\nSelected research note / source material:\n${input.sourceContext}\n\nIMPORTANT: Prefer the research note's suggested interest topic, title, and focus when present. Use its notebook content, data, findings, and figures to identify variables, context, evidence, and research gaps. Align analysis with that note rather than inventing an unrelated topic.` : ""}

Return JSON:
{
  "scope": {
    "discipline": "confirmed or refined discipline",
    "researchArea": "specific sub-field or problem space (not a vague theme)",
    "variables": ["independent, dependent, moderating, or control variables"],
    "constructs": ["theoretical constructs or latent factors"],
    "phenomena": ["observable phenomena or outcomes of interest"]
  },
  "contextAndGap": {
    "population": "who or what is studied (sample frame, units of analysis)",
    "context": "setting — geography, institution, sector, time period",
    "domain": "applied domain or field of practice",
    "researchGap": "specific gap, limitation, controversy, trend, or emerging issue this study could address"
  }
}

Be specific and researchable. Prefer concrete populations/contexts (including Nigerian/African higher education when relevant).`,
			},
		],
		{ signal: options?.signal, maxTokens: 1200, model: getOpenRouterFastModel() },
	);

	const parsed = extractJsonObject<{
		scope?: Partial<ResearchScopeAnalysis>;
		contextAndGap?: Partial<ResearchContextAndGap>;
	}>(text);

	return {
		scope: normalizeScopeAnalysis(parsed.scope ?? {}, input.disciplineLabel, input.topic),
		contextAndGap: normalizeContextAndGap(parsed.contextAndGap ?? {}, input.topic),
		usage,
	};
}

function buildTitleFormulatorPrompt(
	input: GenerateResearchIdeasInput,
	scopeAnalysis: ResearchScopeAnalysis,
	contextAnalysis: ResearchContextAndGap,
): string {
	const scopeLabel = SCOPE_LABELS[input.scope];

	return `You are an academic Title Formulator and quality reviewer. Generate exactly 3 distinct, publishable research study titles.

${TITLE_QUALITY_RULES}

Scholar profile:
- Level: ${scopeLabel}
- Discipline: ${scopeAnalysis.discipline}
- Research area: ${scopeAnalysis.researchArea}
- Variables: ${scopeAnalysis.variables.join("; ") || "derive from analysis"}
- Constructs: ${scopeAnalysis.constructs.join("; ") || "derive from analysis"}
- Phenomena: ${scopeAnalysis.phenomena.join("; ") || "derive from analysis"}
- Population: ${contextAnalysis.population}
- Context: ${contextAnalysis.context}
- Domain: ${contextAnalysis.domain}
- Research gap: ${contextAnalysis.researchGap}
- Original interest: "${input.topic.trim()}"
${input.sourceContext ? `\nUser-selected research note / source material:\n${input.sourceContext}\n\nGround every title, rationale, approach, outline, and research question in this material. If the note includes a suggested interest topic or study title, refine that into publishable academic titles (do not ignore it for an unrelated theme). Use the note's data, findings, and methods where relevant. Do not claim that a source says something it does not say.` : ""}

For each idea use this exact markdown structure:

### 1. [Full study title — specific, publishable]
**Type:** Empirical | Theoretical | Interdisciplinary | Applied
**Feasibility:** High | Moderate | Exploratory
**Rationale:** [1–2 sentences linking to the research gap and why this is feasible at ${scopeLabel} level]
**Approach:** [Brief methodology naming design, data source, and analysis]
**Outline:**
- [Problem framing]
- [Variables / constructs / gap]
- [Design and data]
- [Analysis plan]
- [Expected contributions]
**Research questions:**
1. [Specific academic research question ending with ?]
2. [Specific academic research question ending with ?]
3. [Specific academic research question ending with ?]
4. [Specific academic research question ending with ?]
5. [Specific academic research question ending with ?]
(Provide 5 to 7 numbered research questions)

Requirements:
- Match ambition to ${scopeLabel} level
- Each title must name variables/population/context — never a theme label alone
- Each idea MUST include a concise outline and 5–7 academic research questions
- Self-check: rewrite any vague title before returning
- Vary study types across the 3 ideas
- Do not ask clarifying questions — output all 3 ideas directly`;
}

async function runTitleFormulator(
	input: GenerateResearchIdeasInput,
	scopeAnalysis: ResearchScopeAnalysis,
	contextAnalysis: ResearchContextAndGap,
	options?: { signal?: AbortSignal },
): Promise<{ markdown: string; usage?: TokenUsage }> {
	const { text, usage } = await completeOpenRouterChat(
		[
			{
				role: "system",
				content:
					"You formulate rigorous, specific academic research titles with outlines and research questions. Never output vague theme titles. Follow the user's markdown format exactly.",
			},
			{ role: "user", content: buildTitleFormulatorPrompt(input, scopeAnalysis, contextAnalysis) },
		],
		{ signal: options?.signal, maxTokens: 3200, model: getOpenRouterFastModel() },
	);

	return { markdown: text.trim(), usage };
}

export async function generateResearchIdeas(
	input: GenerateResearchIdeasInput,
	options?: { signal?: AbortSignal },
): Promise<GenerateResearchIdeasResult> {
	const { scope, contextAndGap, usage: u1 } = await runScopeAndContextAnalyst(input, options);
	const { markdown: finalMarkdown, usage: u2 } = await runTitleFormulator(
		input,
		scope,
		contextAndGap,
		options,
	);

	return {
		ideasMarkdown: finalMarkdown,
		analysis: { scope, contextAndGap },
		usage: mergeUsage(u1, u2),
	};
}
