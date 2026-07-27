import { getOpenRouterFastModel } from "../config/env.js";
import { completeOpenRouterChat } from "./llm.service.js";

export type TeachingLevel =
	| "foundation"
	| "undergraduate-l1"
	| "undergraduate-l2"
	| "undergraduate-l3"
	| "postgraduate"
	| "professional";

export type LessonOutputMode = "outline" | "session" | "activities" | "rubric";

export type GenerateCourseOutlineInput = {
	title: string;
	departmentLabel: string;
	level: TeachingLevel;
	mode?: LessonOutputMode;
	standards?: string;
	sourceMaterial?: string;
	sessionCount?: number;
};

const LEVEL_LABELS: Record<TeachingLevel, string> = {
	foundation: "Foundation / access level",
	"undergraduate-l1": "Undergraduate Year 1",
	"undergraduate-l2": "Undergraduate Year 2–3",
	"undergraduate-l3": "Undergraduate Final year",
	postgraduate: "Postgraduate (taught)",
	professional: "Professional / CPD",
};

const LEVEL_GUIDANCE: Record<TeachingLevel, string> = {
	foundation:
		"Scaffold concepts heavily, use plain language, short weekly topics, and frequent formative checks. Assume limited prior knowledge.",
	"undergraduate-l1":
		"Introduce core discipline concepts progressively. Balance lectures and guided practice. Assume first-year study skills.",
	"undergraduate-l2":
		"Build on prior modules with applied examples and moderate independence. Include case studies and problem sets.",
	"undergraduate-l3":
		"Emphasise synthesis, critique, and honours-level depth. Include research-informed topics and capstone-style assessment.",
	postgraduate:
		"Prioritise advanced theory, literature engagement, seminar discussion, and independent inquiry at masters level.",
	professional:
		"Focus on workplace application, competency outcomes, reflective practice, and portfolio or scenario-based assessment.",
};

const SESSIONS_BY_LEVEL: Record<TeachingLevel, number> = {
	foundation: 10,
	"undergraduate-l1": 12,
	"undergraduate-l2": 12,
	"undergraduate-l3": 10,
	postgraduate: 10,
	professional: 8,
};

function optionalContextBlock(input: GenerateCourseOutlineInput): string {
	const parts: string[] = [];
	if (input.standards?.trim()) {
		parts.push(
			`**Curriculum / standards to align with:**\n${input.standards.trim()}\n\nAlign outcomes, activities, and language to these standards where relevant.`,
		);
	}
	if (input.sourceMaterial?.trim()) {
		parts.push(
			`**Source material provided by the lecturer (use as grounding; do not invent conflicting facts):**\n${input.sourceMaterial.trim().slice(0, 6000)}`,
		);
	}
	return parts.length ? `\n${parts.join("\n\n")}\n` : "";
}

function buildPrompt(input: GenerateCourseOutlineInput): string {
	const mode = input.mode ?? "outline";
	const levelLabel = LEVEL_LABELS[input.level] ?? input.level;
	const sessions =
		input.sessionCount && input.sessionCount > 0
			? Math.min(24, Math.max(4, Math.round(input.sessionCount)))
			: (SESSIONS_BY_LEVEL[input.level] ?? 12);
	const guidance = LEVEL_GUIDANCE[input.level] ?? "";
	const context = optionalContextBlock(input);

	const sharedHeader = `You are an expert university curriculum designer. Create teaching materials for higher education, calibrated to the teaching level below.

**Course / topic title:** ${input.title.trim()}
**Department:** ${input.departmentLabel.trim()}
**Teaching level:** ${levelLabel}

Level guidance: ${guidance}
${context}`;

	if (mode === "session") {
		return `${sharedHeader}
Create a **single 50–90 minute session plan** on this topic. Return structured Markdown using bold-only section titles on their own lines — never hash (#) headings or horizontal rules.

Include these sections in order:

**Session overview** (purpose, duration suggestion, prerequisites)

**Intended learning outcomes** (3–5 measurable outcomes for this session)

**Session structure** (timed segments: open → teach → practice → consolidate; include minutes)

**Teaching & learning activities** (concrete activities students do; note materials needed)

**Formative check** (how to gauge understanding mid/end of session)

**Differentiation** (support and stretch)

**Follow-up / independent study** (short, specific)

Be specific to the title and department. Use UK/university terminology. Deliver the complete plan directly.`;
	}

	if (mode === "activities") {
		return `${sharedHeader}
Create a **printable activity sheet** for students on this topic. Return structured Markdown using bold-only section titles on their own lines — never hash (#) headings or horizontal rules.

Include these sections in order:

**Activity sheet title & instructions** (clear student-facing intro, estimated time)

**Warm-up** (1 short activation task)

**Core activities** (3–5 numbered tasks: mix of recall, application, discussion, and problem-solving; include space cues like “Write your answer below”)

**Challenge extension** (1 stretch task)

**Reflection** (2–3 metacognitive prompts)

**Answer guidance for tutor** (brief indicative answers or facilitation notes — clearly labelled for the lecturer)

Be specific to the title and department. Ready to print or share. Deliver the complete sheet directly.`;
	}

	if (mode === "rubric") {
		return `${sharedHeader}
Create an **assessment rubric** for a major piece of coursework on this topic. Return structured Markdown using bold-only section titles on their own lines — never hash (#) headings or horizontal rules.

Include these sections in order:

**Assessment brief** (task type, weighting suggestion, submission format)

**Criteria** (4–6 criteria with clear names)

**Performance levels** (use Excellent / Good / Satisfactory / Needs improvement — or First / 2:1 / 2:2 / Third if degree-marking language fits)

**Descriptors** (for each criterion × level: 1–2 sentence observable descriptors)

**Marking notes** (how to apply the rubric fairly; common pitfalls)

Be specific to the title and department. Use UK/university terminology. Deliver the complete rubric directly.`;
	}

	return `${sharedHeader}
Plan a ${sessions}-session semester module outline appropriate for this level. Return structured Markdown using bold-only section titles on their own lines — never hash (#) headings or horizontal rules.

Include these sections in order:

**Course overview** (2–4 sentences on purpose, audience, and prerequisites for this level)

**Course learning outcomes** (5–7 numbered, measurable outcomes aligned to ${levelLabel})

**Weekly session map** (numbered list of ${sessions} sessions: Session N — topic title — one-line focus)

**Topic breakdown** (for each session: key concepts, suggested activities, and formative check — grouped by session number)

**Assessment strategy** (summative + formative aligned to level; include weighting suggestions)

**Core reading & resources** (essential and further reading lists — no invented URLs)

**Differentiation & support** (how to stretch high achievers and scaffold students at this level)

Be specific to the course title and department. Use UK/university terminology. Do not ask clarifying questions — deliver the complete outline directly.`;
}

function maxTokensForMode(mode: LessonOutputMode, sessions: number): number {
	if (mode === "outline") return Math.min(8000, 2000 + sessions * 350);
	if (mode === "rubric") return 4500;
	if (mode === "activities") return 4000;
	return 3500;
}

export async function generateCourseOutline(
	input: GenerateCourseOutlineInput,
	options?: { signal?: AbortSignal },
): Promise<{ outline: string }> {
	const mode = input.mode ?? "outline";
	const sessions =
		input.sessionCount && input.sessionCount > 0
			? Math.min(24, Math.max(4, Math.round(input.sessionCount)))
			: (SESSIONS_BY_LEVEL[input.level] ?? 12);
	const maxTokens = maxTokensForMode(mode, sessions);

	const systemByMode: Record<LessonOutputMode, string> = {
		outline:
			"You write detailed university course outlines in Markdown for lecturers. Use bold-only section titles — never hash headings. Outlines must be level-appropriate, sequenced, and ready to teach from.",
		session:
			"You write precise, timed university session plans in Markdown for lecturers. Use bold-only section titles — never hash headings. Plans must be classroom-ready.",
		activities:
			"You write printable higher-education activity sheets in Markdown. Use bold-only section titles — never hash headings. Tasks must be clear for students and useful for tutors.",
		rubric:
			"You write fair, criterion-referenced assessment rubrics in Markdown for university coursework. Use bold-only section titles — never hash headings.",
	};

	const { text: rawOutline } = await completeOpenRouterChat(
		[
			{
				role: "system",
				content: systemByMode[mode],
			},
			{
				role: "user",
				content: buildPrompt(input),
			},
		],
		{ signal: options?.signal, maxTokens, model: getOpenRouterFastModel() },
	);

	const outline = rawOutline.trim();
	if (!outline) {
		throw new Error("Course outline generation returned empty content.");
	}

	return { outline };
}

/** @deprecated Use generateCourseOutline */
export const generateLessonPlan = generateCourseOutline;
