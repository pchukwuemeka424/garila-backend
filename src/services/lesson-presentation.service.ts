import { getOpenRouterFastModel } from "../config/env.js";
import { completeOpenRouterChat } from "./llm.service.js";
import type { TeachingLevel } from "./lesson-planner.service.js";

export type PresentationSlide = {
	title: string;
	explanation: string;
	bullets: string[];
	imageUrl: string | null;
};

export type CoursePresentation = {
	title: string;
	slides: PresentationSlide[];
};

export type GeneratePresentationInput = {
	title: string;
	departmentLabel: string;
	level: TeachingLevel;
	outline: string;
};

function extractJsonObject(raw: string): unknown {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = (fenced?.[1] ?? raw).trim();
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		throw new Error("Presentation response did not contain JSON.");
	}
	return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}

function normalizeSlide(value: unknown, index: number): PresentationSlide {
	if (!value || typeof value !== "object") {
		throw new Error(`Slide ${index + 1} is invalid.`);
	}
	const slide = value as Record<string, unknown>;
	const title = typeof slide.title === "string" ? slide.title.trim() : "";
	const explanation =
		typeof slide.explanation === "string"
			? slide.explanation.trim()
			: typeof slide.content === "string"
				? slide.content.trim()
				: "";
	const bullets = Array.isArray(slide.bullets)
		? slide.bullets.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
		: [];

	if (!title || !explanation) {
		throw new Error(`Slide ${index + 1} is missing required fields.`);
	}

	return { title, explanation, bullets, imageUrl: null };
}

function parsePresentationJson(raw: string, fallbackTitle: string): CoursePresentation {
	const parsed = extractJsonObject(raw) as Record<string, unknown>;
	const title =
		typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
	if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
		throw new Error("Presentation response did not include slides.");
	}

	const slides = parsed.slides.slice(0, 12).map(normalizeSlide);
	return { title, slides };
}

function buildPrompt(input: GeneratePresentationInput): string {
	return `You are an expert university lecturer preparing an introductory lecture slide deck.

Use the course outline below only as background knowledge. Do **not** reproduce, summarise, or list the outline structure on the slides.

**Course title:** ${input.title.trim()}
**Department:** ${input.departmentLabel.trim()}
**Teaching level:** ${input.level}

**Course outline (reference only — do not list this on slides):**
${input.outline.trim()}

Return **only** valid JSON (no markdown fences, no commentary) matching this schema:
{
  "title": "Presentation title",
  "slides": [
    {
      "title": "Slide title (max 8 words)",
      "explanation": "3–5 sentences that teach and explain this topic in depth. Give context, why it matters, and how it connects to the course. Write as spoken lecture notes.",
      "bullets": ["Key point or example", "Another distinct point"]
    }
  ]
}

Rules:
- Create 8–10 slides as a coherent first-lecture narrative: hook, why the course matters, core ideas explained in depth, applied examples, how students will learn, assessment in plain terms, and a motivating close.
- Each slide must **explain** one idea — never copy outline headings, session numbers, weekly maps, or learning-outcome lists verbatim.
- Use **bullets** when they help students scan the slide: key facts, steps, criteria, examples, comparisons, or takeaways. Include 2–5 bullets on those slides.
- Use an empty bullets array \`[]\` only for purely narrative slides (e.g. welcome or closing) where bullets would not add value.
- Keep explanations level-appropriate, informative, and conversational — add enough detail that a student learns something concrete from each slide.
- Bullets must be short (max 15 words each) and must not repeat the explanation verbatim.
- Do not invent URLs or cite specific readings.`;
}

export async function generateCoursePresentation(
	input: GeneratePresentationInput,
	options?: { signal?: AbortSignal },
): Promise<CoursePresentation> {
	const { text: raw } = await completeOpenRouterChat(
		[
			{
				role: "system",
				content:
					"You write detailed university lecture slide decks as JSON. Each slide has a rich explanation plus bullets where they aid learning. Output only valid JSON.",
			},
			{
				role: "user",
				content: buildPrompt(input),
			},
		],
		{ signal: options?.signal, maxTokens: 6500, model: getOpenRouterFastModel() },
	);

	return parsePresentationJson(raw, input.title.trim());
}
