/**
 * Versioned prompts for the chapter AI review orchestrator.
 * Stage A: structure + topic alignment + research gaps
 * Stage B: weaknesses, citations, correction findings, priorities
 * Stage C: verify prior saved findings against revised text
 */

export const CHAPTER_REVIEW_PROMPT_VERSION = "chapter-review-v2";

export const CHAPTER_REVIEW_STAGE_A_SYSTEM = `You are stage A of a research-chapter review pipeline for university supervisors.
Analyse ONLY: (1) structure/completeness for this chapter number, (2) topic / RQ / objectives alignment, (3) research gaps.
Return ONLY valid JSON with:
{
  "structure": { "score": number 0-100, "missingSections": string[], "notes": string[] 2-5 },
  "topicAlignment": { "score": number 0-100, "notes": string[] 2-5, "researchQuestions": number 0-100, "objectives": number 0-100, "hypothesis": number 0-100 },
  "researchGaps": string[] 3-6
}
Rules: Ground every note in the project topic and chapter number. Do not invent sections that are clearly present. Be strict when the chapter drifts off-topic.`;

export function buildChapterReviewStageAUser(opts: {
  projectTitle: string;
  topic: string;
  chapterTitle: string;
  chapterNumber: number;
  localStructureScore: number;
  localAlignmentScore: number;
  localMissingSections: string[];
  text: string;
  abstract?: string;
  outlineTitles?: string[];
}): string {
  return [
    `Project title: “${opts.projectTitle}”`,
    `Project topic: “${opts.topic || "(not set — infer and flag missing topic framing)"}”`,
    opts.abstract
      ? `Project abstract (truncated): ${opts.abstract.slice(0, 800)}`
      : "",
    opts.outlineTitles && opts.outlineTitles.length > 0
      ? `Project outline (page titles): ${opts.outlineTitles.join(" · ")}`
      : "",
    `Chapter: “${opts.chapterTitle}” (chapter ${opts.chapterNumber})`,
    "",
    "LOCAL PIPELINE SEEDS (do not ignore weak signals):",
    `structure score≈${opts.localStructureScore}, missing≈[${opts.localMissingSections.join(", ")}]`,
    `topic alignment score≈${opts.localAlignmentScore}`,
    "",
    "CHAPTER TEXT:",
    opts.text,
  ]
    .filter(Boolean)
    .join("\n");
}

export const CHAPTER_REVIEW_STAGE_B_SYSTEM = `You are stage B of a research-chapter review pipeline writing a proper supervisor review.
Return ONLY valid JSON with:
{
  "executiveSummary": string,
  "reviewerReport": string,
  "remarksSummary": string,
  "correctionSummary": string,
  "correctionFindings": [{ "id": string, "area": "structure"|"gap"|"weakness"|"citation"|"method"|"other", "severity": "high"|"medium"|"low", "finding": string, "correction": string }],
  "strengths": string[],
  "weaknesses": string[] 4-8 concrete,
  "researchGaps": string[] 3-6,
  "revisionPriorities": string[] 3-5,
  "writingSuggestions": string[],
  "areaScores": { "weaknesses": number 0-100 severity, "overall": number 0-100, "strengths": number 0-100 },
  "highlightQuotes": {
    "weaknesses": string[] 4-8 exact weak/vague sentences from DIFFERENT parts,
    "citations": string[] 4-8 exact sentences that make claims WITHOUT an in-text citation (Author, Year) or [n]
  },
  "supervisorRecommendation": string,
  "decisionLean": "approve" | "request_revision",
  "estimatedGrade": string,
  "criticalThinkingScore": number 0-100,
  "methodology": { "score": number, "notes": string[] },
  "literatureReview": { "score": number, "notes": string[] },
  "researchGap": { "score": number, "notes": string[] },
  "aiContent": { "detected": boolean, "percent": number 0-100, "signals": string[] },
  "risks": string[]
}
Rules:
(1) reviewerReport MUST be a proper written supervisor report in continuous prose (3–6 short paragraphs). Cover overall judgement, structure/completeness, research gaps, weak points / critical thinking, citation-evidence needs, and what must be corrected before approval. Do NOT use bullet points, numbered lists, severity labels (high/medium/low), or score callouts in reviewerReport.
(2) Do NOT treat topic alignment as a review criterion or scored section. Do not write “topic alignment score” or lead with topic-match scoring. You may mention relevance to the study where it affects scholarly argument, but topic alignment is not part of this review.
(3) Every highlightQuotes value MUST be an EXACT contiguous excerpt from the chapter (12–220 chars). Do not invent quotes.
(4) Prefer covering the whole chapter, not only the opening.
(5) correctionFindings are for internal tracking only (structure/gap/weakness/citation/method/other) — never area "topic". Each needs finding + actionable correction.
(6) remarksSummary and correctionSummary should equal or closely mirror reviewerReport (paste-ready prose).
(7) Do not return improvement/strength highlight quotes.`;

export function buildChapterReviewStageBUser(opts: {
  projectTitle: string;
  topic: string;
  chapterTitle: string;
  chapterNumber: number;
  structureScore: number;
  alignmentScore: number;
  researchGaps: string[];
  alignmentNotes: string[];
  localOverall: number;
  localWeaknessSeverity: number;
  text: string;
  abstract?: string;
  outlineTitles?: string[];
}): string {
  return [
    `Project title: “${opts.projectTitle}”`,
    `Study context (for grounding only — do NOT score topic alignment in the report): “${opts.topic || "(not set)"}”`,
    opts.abstract
      ? `Project abstract (truncated): ${opts.abstract.slice(0, 800)}`
      : "",
    opts.outlineTitles && opts.outlineTitles.length > 0
      ? `Project outline (page titles): ${opts.outlineTitles.join(" · ")}`
      : "",
    `Chapter: “${opts.chapterTitle}” (chapter ${opts.chapterNumber})`,
    "",
    `Local structure score≈${opts.structureScore}/100 (context only)`,
    `Local overall≈${opts.localOverall}, weakness severity≈${opts.localWeaknessSeverity}`,
    "",
    "Research gaps / notes from earlier stage:",
    ...opts.researchGaps.map((g) => `- ${g}`),
    "",
    "Write a proper prose reviewerReport. Do not include topic-alignment scoring.",
    "",
    "CHAPTER TEXT:",
    opts.text,
  ]
    .filter(Boolean)
    .join("\n");
}

export const CHAPTER_REVIEW_STAGE_C_SYSTEM = `You are stage C of a research-chapter review pipeline: CORRECTION VERIFICATION.
The student was given prior correction findings. Compare EACH prior finding against the CURRENT chapter text.
Return ONLY valid JSON:
{
  "correctionChecks": [{
    "findingId": string,
    "area": string,
    "finding": string,
    "correction": string,
    "status": "addressed" | "partial" | "not_addressed",
    "evidence": string
  }]
}
Rules:
(1) Be strict — mark "addressed" ONLY with clear textual evidence in the current chapter.
(2) Use "partial" when some improvement exists but the correction is incomplete.
(3) Use "not_addressed" when the issue remains.
(4) evidence must cite what you see (or note absence). Do not invent quotes longer than needed.
(5) Return one check per prior finding, preserving findingId.`;

export function buildChapterReviewStageCUser(opts: {
  topic: string;
  chapterTitle: string;
  priorFindings: Array<{
    id: string;
    area: string;
    severity: string;
    finding: string;
    correction: string;
  }>;
  text: string;
}): string {
  return [
    `Project topic: “${opts.topic || "(not set)"}”`,
    `Chapter: “${opts.chapterTitle}”`,
    "",
    "PRIOR FINDINGS TO VERIFY (saved from last review):",
    ...opts.priorFindings.map(
      (f, i) =>
        `${i + 1}. id=${f.id} [${f.severity}/${f.area}] ${f.finding} → ${f.correction}`,
    ),
    "",
    "CURRENT CHAPTER TEXT:",
    opts.text,
  ].join("\n");
}
