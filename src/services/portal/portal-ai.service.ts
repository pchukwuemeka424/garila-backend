import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../lib/portal-errors.js";
import { AiReviewStatus } from "../../lib/portal-enums.js";
import { createAIProvider } from "../../lib/portal-ai/provider.js";
import {
  pickFallbackHighlightQuotes,
  computeAreaScores,
  parseAreaScores,
  mergeHighlightQuotes,
  quotesFromFactCheckClaims,
} from "../../lib/portal-review/apply-highlights.js";
import {
  runAssignmentReviewPipeline,
  ceilAiScore,
  mergeAssignmentGates,
  outOfScopeRecommendedScore,
  buildOutOfScopeRemarks,
  fitRemarksToWordCount,
  appendSectionRemarks,
  type AssignmentBriefContext,
  type AssignmentGateResult,
  type AssignmentMatchClassification,
  type InstructionComplianceResult,
  type RubricCriterionScore,
  type TopicAlignmentResult,
  type AcademicQualityCheck,
} from "../../lib/portal-review/assignment-ai-analysis.js";
import {
  runChapterReviewPipeline,
  pipelineToAiFeedbackReport,
  buildCorrectionFindings,
  parseCorrectionFindings,
  parseCorrectionChecks,
  verifyCorrectionFindings,
  inferChapterNumber,
  type ChapterReviewPipelineResult,
  type CorrectionFinding,
  type CorrectionCheck,
} from "../../lib/portal-review/chapter-ai-analysis.js";
import {
  CHAPTER_REVIEW_PROMPT_VERSION,
  CHAPTER_REVIEW_STAGE_A_SYSTEM,
  CHAPTER_REVIEW_STAGE_B_SYSTEM,
  CHAPTER_REVIEW_STAGE_C_SYSTEM,
  buildChapterReviewStageAUser,
  buildChapterReviewStageBUser,
  buildChapterReviewStageCUser,
} from "../../lib/portal-ai/chapter-review.js";
import {
  ASSIGNMENT_REVIEW_PROMPT_VERSION,
  ASSIGNMENT_GATEKEEPER_SYSTEM,
  ASSIGNMENT_MARKER_SYSTEM,
  ASSIGNMENT_MODERATOR_SYSTEM,
  buildGatekeeperUserPrompt,
  buildMarkerUserPrompt,
  buildModeratorUserPrompt,
} from "../../lib/portal-ai/assignment-review.js";
import { aiReviewRepository } from "./portal-ai.repo.js";
import { chapterRepository } from "./portal-chapter.repo.js";
import { isSinglePageProjectType } from "../../lib/portal-project-types.js";

export type AiFeedbackReport = {
  executiveSummary: string;
  strengths: string[];
  weaknesses: string[];
  grammar: { score: number; issues: string[] };
  academicWriting: { score: number; notes: string[] };
  criticalThinkingScore: number;
  citations: {
    apa7: { score: number; issues: string[] };
    harvard: { score: number; issues: string[] };
    ieee: { score: number; issues: string[] };
  };
  referenceValidation: { score: number; issues: string[] };
  researchGap: { score: number; notes: string[] };
  methodology: { score: number; notes: string[] };
  literatureReview: { score: number; notes: string[] };
  alignment: {
    topic: number;
    researchQuestions: number;
    objectives: number;
    hypothesis: number;
  };
  consistency: { score: number; issues: string[] };
  completeness: { score: number; notes: string[] };
  missingSections: string[];
  readabilityScore: number;
  similarityScore?: number;
  writingSuggestions: string[];
  supervisorRecommendation: string;
  estimatedGrade: string;
  risks: string[];
};

function buildDeterministicReport(sourceHint?: string): AiFeedbackReport {
  return {
    executiveSummary:
      "Automated academic review completed. The submission shows a coherent structure with opportunities to deepen critical analysis and citation consistency.",
    strengths: [
      "Clear organisation of sections",
      "Topic remains identifiable throughout",
      "Attempt at academic tone",
    ],
    weaknesses: [
      "Limited critical engagement with literature",
      "Methodology justification could be stronger",
    ],
    grammar: { score: 82, issues: ["Occasional long sentences reduce clarity"] },
    academicWriting: {
      score: 78,
      notes: ["Prefer cautious hedging over absolute claims"],
    },
    criticalThinkingScore: 74,
    citations: {
      apa7: { score: 70, issues: ["Check italicisation of journal titles"] },
      harvard: { score: 68, issues: ["Inconsistent year placement"] },
      ieee: { score: 65, issues: ["Numbered citations incomplete"] },
    },
    referenceValidation: {
      score: 72,
      issues: ["Verify all in-text citations appear in the reference list"],
    },
    researchGap: {
      score: 71,
      notes: ["State the gap more explicitly in the introduction"],
    },
    methodology: {
      score: 73,
      notes: ["Add sampling rationale and limitations"],
    },
    literatureReview: {
      score: 70,
      notes: ["Move from summary toward thematic synthesis"],
    },
    alignment: {
      topic: 84,
      researchQuestions: 76,
      objectives: 78,
      hypothesis: 70,
    },
    consistency: {
      score: 77,
      issues: ["Terminology for key constructs varies across sections"],
    },
    completeness: {
      score: 80,
      notes: ["Core expected sections present"],
    },
    missingSections: [],
    readabilityScore: 76,
    similarityScore: undefined,
    writingSuggestions: [
      "Use topic sentences to open each paragraph",
      "Reduce passive voice where agency matters",
      "Add transition phrases between major sections",
    ],
    supervisorRecommendation:
      "Approve for supervisor review after student addresses citation consistency and methodology rationale.",
    estimatedGrade: "B",
    risks: [
      "Citation style drift",
      "Under-specified methodology",
      sourceHint ||
        (process.env.OPENROUTER_API_KEY
          ? "Provider-assisted review pending enrichment"
          : "Deterministic local review (no OPENAI_API_KEY)"),
    ],
  };
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value.filter((v): v is string => typeof v === "string");
  return items.length > 0 ? items : fallback;
}

function asScoreNotes(
  value: unknown,
  fallback: { score: number; notes: string[] },
) {
  if (!value || typeof value !== "object") return fallback;
  const obj = value as { score?: unknown; notes?: unknown; issues?: unknown };
  return {
    score: typeof obj.score === "number" ? obj.score : fallback.score,
    notes: asStringArray(obj.notes ?? obj.issues, fallback.notes),
  };
}

function asScoreIssues(
  value: unknown,
  fallback: { score: number; issues: string[] },
) {
  if (!value || typeof value !== "object") return fallback;
  const obj = value as { score?: unknown; issues?: unknown };
  return {
    score: typeof obj.score === "number" ? obj.score : fallback.score,
    issues: asStringArray(obj.issues, fallback.issues),
  };
}

/** Merge LLM JSON into the full report shape, falling back field-by-field. */
function mergeProviderReport(
  raw: unknown,
  fallback: AiFeedbackReport,
): AiFeedbackReport {
  if (!raw || typeof raw !== "object") return fallback;
  const data = raw as Record<string, unknown>;
  const alignment =
    data.alignment && typeof data.alignment === "object"
      ? (data.alignment as Record<string, unknown>)
      : {};
  const citations =
    data.citations && typeof data.citations === "object"
      ? (data.citations as Record<string, unknown>)
      : {};

  return {
    executiveSummary:
      typeof data.executiveSummary === "string"
        ? data.executiveSummary
        : fallback.executiveSummary,
    strengths: asStringArray(data.strengths, fallback.strengths),
    weaknesses: asStringArray(data.weaknesses, fallback.weaknesses),
    grammar: asScoreIssues(data.grammar, fallback.grammar),
    academicWriting: asScoreNotes(
      data.academicWriting,
      fallback.academicWriting,
    ),
    criticalThinkingScore:
      typeof data.criticalThinkingScore === "number"
        ? data.criticalThinkingScore
        : fallback.criticalThinkingScore,
    citations: {
      apa7: asScoreIssues(citations.apa7, fallback.citations.apa7),
      harvard: asScoreIssues(citations.harvard, fallback.citations.harvard),
      ieee: asScoreIssues(citations.ieee, fallback.citations.ieee),
    },
    referenceValidation: asScoreIssues(
      data.referenceValidation,
      fallback.referenceValidation,
    ),
    researchGap: asScoreNotes(data.researchGap, fallback.researchGap),
    methodology: asScoreNotes(data.methodology, fallback.methodology),
    literatureReview: asScoreNotes(
      data.literatureReview,
      fallback.literatureReview,
    ),
    alignment: {
      topic:
        typeof alignment.topic === "number"
          ? alignment.topic
          : fallback.alignment.topic,
      researchQuestions:
        typeof alignment.researchQuestions === "number"
          ? alignment.researchQuestions
          : fallback.alignment.researchQuestions,
      objectives:
        typeof alignment.objectives === "number"
          ? alignment.objectives
          : fallback.alignment.objectives,
      hypothesis:
        typeof alignment.hypothesis === "number"
          ? alignment.hypothesis
          : fallback.alignment.hypothesis,
    },
    consistency: asScoreIssues(data.consistency, fallback.consistency),
    completeness: asScoreNotes(data.completeness, fallback.completeness),
    missingSections: asStringArray(
      data.missingSections,
      fallback.missingSections,
    ),
    readabilityScore:
      typeof data.readabilityScore === "number"
        ? data.readabilityScore
        : fallback.readabilityScore,
    similarityScore:
      typeof data.similarityScore === "number"
        ? data.similarityScore
        : fallback.similarityScore,
    writingSuggestions: asStringArray(
      data.writingSuggestions,
      fallback.writingSuggestions,
    ),
    supervisorRecommendation:
      typeof data.supervisorRecommendation === "string"
        ? data.supervisorRecommendation
        : fallback.supervisorRecommendation,
    estimatedGrade:
      typeof data.estimatedGrade === "string"
        ? data.estimatedGrade
        : fallback.estimatedGrade,
    risks: asStringArray(data.risks, fallback.risks),
  };
}

function extractVersionText(version: {
  richTextJson?: unknown;
  content?: unknown;
}): string {
  const rich = version.richTextJson as { html?: string } | undefined;
  const html = rich?.html ? String(rich.html) : "";
  const stripped = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped) return stripped.slice(0, 12000);
  return "";
}

function asScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

/**
 * Optional Stage A/B LLM enrichment on top of the local chapter pipeline.
 * Returns the (possibly enriched) pipeline plus model id.
 */
async function enrichChapterPipelineWithLlm(
  pipeline: ChapterReviewPipelineResult,
  opts: {
    projectTitle: string;
    topic: string;
    chapterTitle: string;
    chapterNumber: number;
    abstract?: string;
    outlineTitles?: string[];
  },
): Promise<{ pipeline: ChapterReviewPipelineResult; model: string }> {
  const text = pipeline.stages.normalize.plainText;
  if (!process.env.OPENROUTER_API_KEY || pipeline.stages.normalize.tooShort) {
    return {
      pipeline,
      model: process.env.OPENROUTER_API_KEY
        ? "chapter-pipeline-local"
        : "chapter-pipeline-local-no-key",
    };
  }

  try {
    const provider = createAIProvider();

    const stageARaw = await provider.complete(
      [
        { role: "system", content: CHAPTER_REVIEW_STAGE_A_SYSTEM },
        {
          role: "user",
          content: buildChapterReviewStageAUser({
            projectTitle: opts.projectTitle,
            topic: opts.topic,
            chapterTitle: opts.chapterTitle,
            chapterNumber: opts.chapterNumber,
            localStructureScore: pipeline.stages.structure.score,
            localAlignmentScore: pipeline.stages.alignment.score,
            localMissingSections: pipeline.stages.structure.missingSections,
            text,
            abstract: opts.abstract,
            outlineTitles: opts.outlineTitles,
          }),
        },
      ],
      { json: true },
    );
    const stageA = JSON.parse(stageARaw) as Record<string, unknown>;

    let structure = { ...pipeline.stages.structure };
    if (stageA.structure && typeof stageA.structure === "object") {
      const s = stageA.structure as Record<string, unknown>;
      structure = {
        ...structure,
        score: asScore(s.score, structure.score),
        missingSections: asStringArray(s.missingSections, structure.missingSections),
        notes: asStringArray(s.notes, structure.notes),
      };
    }

    let alignment = { ...pipeline.stages.alignment };
    if (stageA.topicAlignment && typeof stageA.topicAlignment === "object") {
      const ta = stageA.topicAlignment as Record<string, unknown>;
      alignment = {
        ...alignment,
        score: asScore(ta.score, alignment.score),
        notes: asStringArray(ta.notes, alignment.notes),
        researchQuestions: asScore(
          ta.researchQuestions,
          alignment.researchQuestions,
        ),
        objectives: asScore(ta.objectives, alignment.objectives),
        hypothesis: asScore(ta.hypothesis, alignment.hypothesis),
      };
    }

    const stageAGaps = asStringArray(stageA.researchGaps, pipeline.researchGaps);

    const stageBRaw = await provider.complete(
      [
        { role: "system", content: CHAPTER_REVIEW_STAGE_B_SYSTEM },
        {
          role: "user",
          content: buildChapterReviewStageBUser({
            projectTitle: opts.projectTitle,
            topic: opts.topic,
            chapterTitle: opts.chapterTitle,
            chapterNumber: opts.chapterNumber,
            structureScore: structure.score,
            alignmentScore: alignment.score,
            researchGaps: stageAGaps,
            alignmentNotes: alignment.notes,
            localOverall: pipeline.areaScores.overall,
            localWeaknessSeverity: pipeline.areaScores.weaknesses,
            text,
            abstract: opts.abstract,
            outlineTitles: opts.outlineTitles,
          }),
        },
      ],
      { json: true },
    );
    const stageB = JSON.parse(stageBRaw) as Record<string, unknown>;
    const quotesRaw =
      stageB.highlightQuotes && typeof stageB.highlightQuotes === "object"
        ? (stageB.highlightQuotes as Record<string, unknown>)
        : {};
    const aiRaw =
      stageB.aiContent && typeof stageB.aiContent === "object"
        ? (stageB.aiContent as Record<string, unknown>)
        : {};

    const localQuotes = {
      strengths: pipeline.highlightQuotes.strengths || [],
      weaknesses: pipeline.highlightQuotes.weaknesses || [],
      citations: pipeline.highlightQuotes.citations || [],
      wrongClaims: pipeline.highlightQuotes.wrongClaims || [],
    };
    const aiQuotes = {
      strengths: asStringArray(quotesRaw.strengths, localQuotes.strengths),
      weaknesses: asStringArray(quotesRaw.weaknesses, localQuotes.weaknesses),
      citations: asStringArray(quotesRaw.citations, localQuotes.citations),
      wrongClaims: asStringArray(quotesRaw.wrongClaims, localQuotes.wrongClaims),
    };
    const highlightQuotes = mergeHighlightQuotes(aiQuotes, localQuotes);

    const areaScores = parseAreaScores(stageB.areaScores, pipeline.areaScores);
    if (alignment.score < 40) {
      areaScores.overall = Math.min(areaScores.overall, 45);
    }

    const decisionLean =
      stageB.decisionLean === "approve" || stageB.decisionLean === "request_revision"
        ? stageB.decisionLean
        : pipeline.decisionLean;

    const methodology =
      stageB.methodology && typeof stageB.methodology === "object"
        ? asScoreNotes(stageB.methodology, pipeline.stages.academic.methodology)
        : pipeline.stages.academic.methodology;
    const literatureReview =
      stageB.literatureReview && typeof stageB.literatureReview === "object"
        ? asScoreNotes(
            stageB.literatureReview,
            pipeline.stages.academic.literatureReview,
          )
        : pipeline.stages.academic.literatureReview;
    const researchGap =
      stageB.researchGap && typeof stageB.researchGap === "object"
        ? asScoreNotes(stageB.researchGap, pipeline.stages.academic.researchGap)
        : pipeline.stages.academic.researchGap;

    const aiPercent = asScore(aiRaw.percent, pipeline.aiContent.percent);
    const aiDetected =
      typeof aiRaw.detected === "boolean"
        ? aiRaw.detected
        : aiPercent >= 45;

    const enriched: ChapterReviewPipelineResult = {
      ...pipeline,
      stages: {
        ...pipeline.stages,
        structure,
        alignment,
        academic: {
          ...pipeline.stages.academic,
          criticalThinkingScore: asScore(
            stageB.criticalThinkingScore,
            pipeline.criticalThinkingScore,
          ),
          methodology,
          literatureReview,
          researchGap,
        },
        risks: {
          ...pipeline.stages.risks,
          risks: asStringArray(stageB.risks, pipeline.stages.risks.risks),
          aiContent: {
            detected: aiDetected,
            percent: aiPercent,
            signals: asStringArray(aiRaw.signals, pipeline.aiContent.signals),
          },
        },
        feedback: {
          ...pipeline.stages.feedback,
          executiveSummary:
            typeof stageB.executiveSummary === "string"
              ? stageB.executiveSummary
              : pipeline.executiveSummary,
          remarksSummary:
            typeof stageB.remarksSummary === "string" &&
            stageB.remarksSummary.trim().length > 40
              ? stageB.remarksSummary.trim()
              : pipeline.remarksSummary,
          strengths: asStringArray(stageB.strengths, pipeline.strengths),
          weaknesses: asStringArray(stageB.weaknesses, pipeline.weaknesses),
          researchGaps: asStringArray(stageB.researchGaps, stageAGaps),
          revisionPriorities: asStringArray(
            stageB.revisionPriorities,
            pipeline.revisionPriorities,
          ),
          writingSuggestions: asStringArray(
            stageB.writingSuggestions,
            pipeline.writingSuggestions,
          ),
          supervisorRecommendation:
            typeof stageB.supervisorRecommendation === "string"
              ? stageB.supervisorRecommendation
              : pipeline.supervisorRecommendation,
          decisionLean,
          estimatedGrade:
            typeof stageB.estimatedGrade === "string"
              ? stageB.estimatedGrade
              : pipeline.estimatedGrade,
        },
      },
      areaScores,
      highlightQuotes,
      researchGaps: asStringArray(stageB.researchGaps, stageAGaps),
      revisionPriorities: asStringArray(
        stageB.revisionPriorities,
        pipeline.revisionPriorities,
      ),
      remarksSummary:
        typeof stageB.remarksSummary === "string" &&
        stageB.remarksSummary.trim().length > 40
          ? stageB.remarksSummary.trim()
          : pipeline.remarksSummary,
      executiveSummary:
        typeof stageB.executiveSummary === "string"
          ? stageB.executiveSummary
          : pipeline.executiveSummary,
      strengths: asStringArray(stageB.strengths, pipeline.strengths),
      weaknesses: asStringArray(stageB.weaknesses, pipeline.weaknesses),
      supervisorRecommendation:
        typeof stageB.supervisorRecommendation === "string"
          ? stageB.supervisorRecommendation
          : pipeline.supervisorRecommendation,
      estimatedGrade:
        typeof stageB.estimatedGrade === "string"
          ? stageB.estimatedGrade
          : pipeline.estimatedGrade,
      decisionLean,
      writingSuggestions: asStringArray(
        stageB.writingSuggestions,
        pipeline.writingSuggestions,
      ),
      criticalThinkingScore: asScore(
        stageB.criticalThinkingScore,
        pipeline.criticalThinkingScore,
      ),
      aiContent: {
        detected: aiDetected,
        percent: aiPercent,
        signals: asStringArray(aiRaw.signals, pipeline.aiContent.signals),
      },
      topicAlignment: {
        topic: null,
        score: null,
        notes: [],
      },
      correctionFindings: pipeline.correctionFindings,
      correctionSummary: pipeline.correctionSummary,
      reviewerReport: pipeline.reviewerReport,
    };

    const localBuilt = buildCorrectionFindings(enriched);
    const correctionFindings = parseCorrectionFindings(
      stageB.correctionFindings,
      localBuilt.findings,
    ).filter((f) => f.area !== "topic");

    const reviewerReport =
      typeof stageB.reviewerReport === "string" &&
      stageB.reviewerReport.trim().length > 80
        ? stageB.reviewerReport.trim()
        : typeof stageB.correctionSummary === "string" &&
            stageB.correctionSummary.trim().length > 80 &&
            !/^\s*\d+\.\s*\[/.test(stageB.correctionSummary)
          ? stageB.correctionSummary.trim()
          : localBuilt.reviewerReport;

    enriched.correctionFindings = correctionFindings;
    enriched.correctionSummary = reviewerReport;
    enriched.reviewerReport = reviewerReport;
    enriched.remarksSummary = reviewerReport;
    enriched.topicAlignment = { topic: null, score: null, notes: [] };

    return {
      pipeline: enriched,
      model: `${process.env.OPENAI_MODEL || "gpt-4o-mini"}+${CHAPTER_REVIEW_PROMPT_VERSION}`,
    };
  } catch {
    return {
      pipeline,
      model: "chapter-pipeline-fallback",
    };
  }
}

async function verifyPriorFindingsWithLlm(opts: {
  priorFindings: CorrectionFinding[];
  topic: string;
  chapterTitle: string;
  text: string;
}): Promise<CorrectionCheck[]> {
  const local = verifyCorrectionFindings(opts.priorFindings, opts.text, {
    topic: opts.topic,
  });
  if (!process.env.OPENROUTER_API_KEY || opts.priorFindings.length === 0) {
    return local;
  }
  try {
    const provider = createAIProvider();
    const raw = await provider.complete(
      [
        { role: "system", content: CHAPTER_REVIEW_STAGE_C_SYSTEM },
        {
          role: "user",
          content: buildChapterReviewStageCUser({
            topic: opts.topic,
            chapterTitle: opts.chapterTitle,
            priorFindings: opts.priorFindings,
            text: opts.text,
          }),
        },
      ],
      { json: true },
    );
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parseCorrectionChecks(parsed.correctionChecks, local);
  } catch {
    return local;
  }
}

async function generateReport(versionId: string, tenantId: string) {
  const fallback = buildDeterministicReport();
  const version = await chapterRepository.findVersion(tenantId, versionId);
  if (!version) return { report: fallback, model: "deterministic-local" };

  const { projectRepository } = await import("./portal-project.repo.js");
  const chapter = await chapterRepository.findById(
    tenantId,
    String(version.chapterId),
  );
  const project = await projectRepository.findById(
    tenantId,
    String(version.projectId),
  );

  const html =
    (version.richTextJson as { html?: string } | undefined)?.html ||
    extractVersionText(version);

  const local = runChapterReviewPipeline({
    htmlOrText: html,
    project: {
      title: project ? String(project.title || "") : "",
      topic: project ? String(project.topic || "") : "",
      abstract: project ? String(project.abstract || "") : "",
    },
    chapter: {
      title: chapter ? String(chapter.title || "") : "Chapter",
      number: chapter ? Number(chapter.number) || 1 : 1,
    },
  });

  const sourceHint = local.stages.normalize.tooShort
    ? "Deterministic local review (empty or very short submission text)"
    : !process.env.OPENROUTER_API_KEY
      ? "Chapter pipeline local review (no OPENAI_API_KEY)"
      : undefined;

  const { pipeline, model } = await enrichChapterPipelineWithLlm(local, {
    projectTitle: project ? String(project.title || "") : "",
    topic: project ? String(project.topic || "") : "",
    chapterTitle: chapter ? String(chapter.title || "") : "Chapter",
    chapterNumber: chapter ? Number(chapter.number) || 1 : 1,
  });

  const report = mergeProviderReport(
    pipelineToAiFeedbackReport(pipeline, sourceHint),
    fallback,
  );

  return { report, model };
}


function letterFromPercent(pct: number): string {
  if (pct >= 70) return "A";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  if (pct >= 30) return "E";
  return "F";
}

function parseRequirementChecks(
  raw: unknown,
  fallback: InstructionComplianceResult["requirementChecks"],
) {
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      if (typeof obj.item !== "string") return null;
      return {
        item: obj.item,
        met: Boolean(obj.met),
        note:
          typeof obj.note === "string"
            ? obj.note
            : obj.met
              ? "Met"
              : "Not met",
      };
    })
    .filter(
      (c): c is { item: string; met: boolean; note: string } => c != null,
    );
  return parsed.length > 0 ? parsed : fallback;
}

function parseCriterionScores(
  raw: unknown,
  fallback: RubricCriterionScore[],
): RubricCriterionScore[] {
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name : "";
      const score =
        typeof obj.score === "number" ? obj.score : Number(obj.score);
      const maxMarks =
        typeof obj.maxMarks === "number"
          ? obj.maxMarks
          : Number(obj.maxMarks);
      if (!name || !Number.isFinite(score) || !Number.isFinite(maxMarks))
        return null;
      return {
        name,
        score: Math.min(maxMarks, Math.ceil(Math.max(0, score))),
        maxMarks,
        comment:
          typeof obj.comment === "string"
            ? obj.comment
            : "Scored against the brief",
      };
    })
    .filter(
      (
        c,
      ): c is {
        name: string;
        score: number;
        maxMarks: number;
        comment: string;
      } => c != null,
    );
  return parsed.length > 0 ? parsed : fallback;
}

function parseQualityChecks(
  raw: unknown,
  fallback: AcademicQualityCheck[],
): AcademicQualityCheck[] {
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name : "";
      const score =
        typeof obj.score === "number" ? obj.score : Number(obj.score);
      if (!name || !Number.isFinite(score)) return null;
      return {
        name,
        score: Math.max(0, Math.min(100, Math.round(score))),
        comment:
          typeof obj.comment === "string"
            ? obj.comment
            : "Academic quality diagnostic",
      };
    })
    .filter(
      (c): c is AcademicQualityCheck => c != null,
    );
  return parsed.length > 0 ? parsed : fallback;
}

function applyScoreCaps(opts: {
  score: number;
  maxScore: number;
  localCap: number;
  weaknessSeverity: number;
  requirementChecks: InstructionComplianceResult["requirementChecks"];
  topicScore: number;
  classification?: AssignmentMatchClassification;
  markingSkipped?: boolean;
}) {
  if (opts.markingSkipped) {
    return outOfScopeRecommendedScore(opts.maxScore);
  }
  let aiSuggestedScore = opts.score;
  const metCount = opts.requirementChecks.filter((c) => c.met).length;
  const metRatio =
    opts.requirementChecks.length > 0
      ? metCount / opts.requirementChecks.length
      : 1;
  if (opts.weaknessSeverity >= 85) {
    aiSuggestedScore = Math.min(aiSuggestedScore, opts.maxScore * 0.22);
  } else if (opts.weaknessSeverity >= 75) {
    aiSuggestedScore = Math.min(aiSuggestedScore, opts.maxScore * 0.32);
  }
  if (metRatio < 0.4) {
    aiSuggestedScore = Math.min(aiSuggestedScore, opts.maxScore * 0.35);
  }
  if (metRatio === 0 && opts.requirementChecks.length > 0) {
    aiSuggestedScore = Math.min(aiSuggestedScore, opts.maxScore * 0.22);
  }
  if (opts.topicScore < 40) {
    return outOfScopeRecommendedScore(opts.maxScore);
  }
  if (opts.classification === "PARTIAL_MATCH") {
    aiSuggestedScore = Math.min(aiSuggestedScore, opts.maxScore * 0.85);
  }
  aiSuggestedScore = Math.min(
    aiSuggestedScore,
    opts.localCap + opts.maxScore * 0.1,
  );
  return ceilAiScore(aiSuggestedScore, opts.maxScore);
}

function clampScore100(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseGateFromLlm(
  raw: Record<string, unknown>,
  local: AssignmentGateResult,
): AssignmentGateResult {
  const alignmentRaw =
    raw.alignment && typeof raw.alignment === "object"
      ? (raw.alignment as Record<string, unknown>)
      : {};
  const classificationRaw = String(raw.classification || "").toUpperCase();
  const validClasses: AssignmentMatchClassification[] = [
    "FULL_MATCH",
    "PARTIAL_MATCH",
    "WEAK_MATCH",
    "OUT_OF_SCOPE",
  ];
  const classification = validClasses.includes(
    classificationRaw as AssignmentMatchClassification,
  )
    ? (classificationRaw as AssignmentMatchClassification)
    : undefined;
  const confidenceRaw = String(raw.confidence || "");
  const confidence =
    confidenceRaw === "High" ||
    confidenceRaw === "Medium" ||
    confidenceRaw === "Low"
      ? confidenceRaw
      : undefined;

  return mergeAssignmentGates(local, {
    classification,
    shouldStopMarking:
      typeof raw.shouldStopMarking === "boolean"
        ? raw.shouldStopMarking
        : undefined,
    expectedDiscipline:
      typeof raw.expectedDiscipline === "string"
        ? raw.expectedDiscipline
        : undefined,
    detectedDiscipline:
      typeof raw.detectedDiscipline === "string"
        ? raw.detectedDiscipline
        : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    confidence,
    alignment: {
      assignmentIntentMatch: clampScore100(
        alignmentRaw.assignmentIntentMatch,
        local.alignment.assignmentIntentMatch,
      ),
      learningOutcomeMatch: clampScore100(
        alignmentRaw.learningOutcomeMatch,
        local.alignment.learningOutcomeMatch,
      ),
      knowledgeDomainMatch: clampScore100(
        alignmentRaw.knowledgeDomainMatch,
        local.alignment.knowledgeDomainMatch,
      ),
      conceptMatch: clampScore100(
        alignmentRaw.conceptMatch,
        local.alignment.conceptMatch,
      ),
      semanticSimilarity: clampScore100(
        alignmentRaw.semanticSimilarity,
        local.alignment.semanticSimilarity,
      ),
      overallTopicAlignment: clampScore100(
        alignmentRaw.overallTopicAlignment,
        local.alignment.overallTopicAlignment,
      ),
    },
  });
}

function buildAssignmentGatePayload(gate: AssignmentGateResult) {
  return {
    confidence: gate.confidence,
    expectedDiscipline: gate.expectedDiscipline,
    detectedDiscipline: gate.detectedDiscipline,
    reason: gate.reason,
    assignmentIntentMatch: gate.alignment.assignmentIntentMatch,
    learningOutcomeMatch: gate.alignment.learningOutcomeMatch,
    knowledgeDomainMatch: gate.alignment.knowledgeDomainMatch,
    conceptMatch: gate.alignment.conceptMatch,
    semanticSimilarity: gate.alignment.semanticSimilarity,
    overallTopicAlignment: gate.alignment.overallTopicAlignment,
  };
}


export const aiReviewService = {
  /**
   * Creates (or returns) an AI review for a chapter version.
   * Uses a structured deterministic report when no provider key is set;
   * workers reprocess queued jobs with a live LLM when available.
   */
  async enqueue(tenantId: string, versionId: string) {
    const existing = await aiReviewRepository.findByVersion(tenantId, versionId);
    if (existing) return existing;

    const version = await chapterRepository.findVersion(tenantId, versionId);
    if (!version) throw new NotFoundError("Chapter version not found");

    const hasProvider = Boolean(process.env.OPENROUTER_API_KEY);

    if (!hasProvider) {
      const { report, model } = await generateReport(versionId, tenantId);
      return aiReviewRepository.create({
        tenantId,
        versionId,
        chapterId: version.chapterId,
        projectId: version.projectId,
        status: AiReviewStatus.Completed,
        model,
        report,
        completedAt: new Date(),
        tokensUsed: 0,
      });
    }

    return aiReviewRepository.create({
      tenantId,
      versionId,
      chapterId: version.chapterId,
      projectId: version.projectId,
      status: AiReviewStatus.Queued,
      model: process.env.FEYNMAN_FAST_MODEL || "openai/gpt-4o-mini",
      report: buildDeterministicReport("Provider-assisted review pending"),
      tokensUsed: 0,
    });
  },

  async get(tenantId: string, id: string) {
    const review = await aiReviewRepository.findById(tenantId, id);
    if (!review) throw new NotFoundError("AI review not found");
    return review;
  },

  async getByVersion(tenantId: string, versionId: string) {
    const review = await aiReviewRepository.findByVersion(tenantId, versionId);
    if (!review) throw new NotFoundError("AI review not found for version");
    return review;
  },

  async listByProject(tenantId: string, projectId: string) {
    return aiReviewRepository.listByProject(tenantId, projectId);
  },

  async listForStudent(tenantId: string, studentId: string) {
    const { projectRepository } = await import("./portal-project.repo.js");
    const projects = await projectRepository.list(tenantId, { studentId });
    const ids = projects.map((p) => String(p._id));
    if (ids.length === 0) return [];
    return aiReviewRepository.listByProjects(tenantId, ids);
  },

  /**
   * Supervisor on-demand page AI review.
   * Research/project pages → chapter agent (topic, gaps, weaknesses, citations).
   * Assignment pages → brief/rubric pipeline.
   */
  async summarizePage(
    tenantId: string,
    projectId: string,
    pageId: string,
    supervisorId: string,
  ) {
    const { projectRepository } = await import("./portal-project.repo.js");
    const project = await projectRepository.findById(tenantId, projectId);
    if (!project) throw new NotFoundError("Project not found");
    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only summarise pages on projects assigned to you",
      );
    }
    const page = project.pages?.id(pageId);
    if (!page) throw new NotFoundError("Page not found");

    if (!isSinglePageProjectType(String(project.projectType))) {
      return this.summarizeResearchPage(project, page, pageId);
    }

    const { assignmentBriefRepository } = await import("./portal-assignment.repo.js");

    if (!project.assignmentBriefId) {
      throw new ValidationError(
        "Attach a lecturer assignment brief before running AI review. AI grades against the brief topic, instructions, and rubric.",
      );
    }

    const briefDoc = await assignmentBriefRepository.findById(
      tenantId,
      String(project.assignmentBriefId),
    );
    if (!briefDoc) {
      throw new ValidationError(
        "Assignment brief not found. Re-attach a valid lecturer brief, then run AI review again.",
      );
    }

    const briefTitle = String(briefDoc.title || "").trim();
    const briefInstructions = String(briefDoc.instructions || "").slice(0, 6000);
    const maxScore =
      typeof briefDoc.maxScore === "number" && briefDoc.maxScore > 0
        ? briefDoc.maxScore
        : 100;
    const requiredItems = Array.isArray(briefDoc.requiredItems)
      ? briefDoc.requiredItems
          .map((s: string) => String(s))
          .filter((s: string) => s.trim())
      : [];
    const rubric = Array.isArray(briefDoc.rubric)
      ? briefDoc.rubric
          .map((r: { name?: string; maxMarks?: number }) => ({
            name: String(r.name || "").trim(),
            maxMarks: Number(r.maxMarks) || 0,
          }))
          .filter(
            (r: { name: string; maxMarks: number }) =>
              Boolean(r.name) && r.maxMarks > 0,
          )
      : [];
    const wordCountMin =
      typeof briefDoc.wordCountMin === "number" ? briefDoc.wordCountMin : null;
    const wordCountMax =
      typeof briefDoc.wordCountMax === "number" ? briefDoc.wordCountMax : null;

    const projectTopic =
      String(project.topic || "").trim() || briefTitle || String(project.title || "");

    if (!briefInstructions.trim() && requiredItems.length === 0 && !projectTopic) {
      throw new ValidationError(
        "Assignment brief is missing topic and instructions. Add topic/instructions on the brief, then retry AI review.",
      );
    }

    const briefContext: AssignmentBriefContext = {
      title: briefTitle || String(project.title || "Assignment"),
      instructions: briefInstructions,
      topic: projectTopic,
      requiredItems,
      rubric,
      maxScore,
      wordCountMin,
      wordCountMax,
    };

    const pageHtml = String(page.content || "");
    const heuristicScores = computeAreaScores(
      pageHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );

    // Local multi-stage pipeline (always runs — testable ground truth)
    const pipeline = runAssignmentReviewPipeline({
      htmlOrText: pageHtml,
      brief: briefContext,
      baseOverall: heuristicScores.overall,
      weaknessSeverity: heuristicScores.weaknesses,
    });

    const text = pipeline.stages.normalize.plainText;
    const fallbackQuotes = mergeHighlightQuotes(
      pipeline.highlightQuotes,
      mergeHighlightQuotes(
        quotesFromFactCheckClaims(pipeline.factCheckAudit?.claims),
        pickFallbackHighlightQuotes(text),
      ),
    );
    let gate: AssignmentGateResult = pipeline.gate;

    const buildPipelineStages = (
      g: AssignmentGateResult,
      topicAlignment: TopicAlignmentResult,
      instructionCompliance: InstructionComplianceResult,
      score: number,
      grade: string,
      agents?: {
        gatekeeper?: string;
        marker?: string;
        moderator?: string;
      },
    ) => ({
      normalize: {
        wordCount: pipeline.stages.normalize.wordCount,
        tooShort: pipeline.stages.normalize.tooShort,
      },
      topicAlignment: {
        score: topicAlignment.score,
        coverage: topicAlignment.coverage,
        notes: topicAlignment.notes,
      },
      instructionCompliance: {
        requirementsMetCount: instructionCompliance.requirementsMetCount,
        requirementsTotal: instructionCompliance.requirementsTotal,
        instructionCoverage: instructionCompliance.instructionCoverage,
        notes: instructionCompliance.notes,
      },
      gate: {
        classification: g.classification,
        shouldStopMarking: g.shouldStopMarking,
        overallTopicAlignment: g.alignment.overallTopicAlignment,
        knowledgeDomainMatch: g.alignment.knowledgeDomainMatch,
        learningOutcomeMatch: g.alignment.learningOutcomeMatch,
      },
      scoring: {
        aiSuggestedScore: score,
        estimatedGrade: grade,
      },
      agents: agents || {
        gatekeeper: "local",
        marker: g.shouldStopMarking ? "skipped" : "local",
        moderator: g.shouldStopMarking ? "skipped" : "local",
      },
    });

    const fallback = {
      executiveSummary: pipeline.executiveSummary,
      remarksSummary: pipeline.remarksSummary,
      strengths: pipeline.strengths,
      weaknesses: pipeline.weaknesses,
      highlightQuotes: {
        strengths: fallbackQuotes.strengths || [],
        weaknesses: fallbackQuotes.weaknesses || [],
        citations: fallbackQuotes.citations || [],
        wrongClaims: fallbackQuotes.wrongClaims || [],
      },
      areaScores: {
        ...heuristicScores,
        weaknesses: pipeline.weaknessSeverity,
        overall: pipeline.overallQuality,
      },
      aiContent: {
        detected: pipeline.aiContent.detected,
        percent: pipeline.aiContent.percent,
        signals: pipeline.aiContent.signals,
      },
      aiSuggestedScore: pipeline.aiSuggestedScore,
      maxScore: pipeline.maxScore,
      requirementChecks: pipeline.requirementChecks,
      criterionScores: pipeline.criterionScores,
      qualityChecks: pipeline.qualityChecks || [],
      supervisorRecommendation: pipeline.supervisorRecommendation,
      estimatedGrade: pipeline.estimatedGrade,
      projectTopic: pipeline.projectTopic,
      topicAlignment: {
        topic: pipeline.topicAlignment.topic,
        score: Math.min(
          pipeline.topicAlignment.score,
          gate.alignment.overallTopicAlignment,
        ),
        notes: pipeline.topicAlignment.notes,
      },
      assignmentStatus: gate.classification,
      assignmentGate: buildAssignmentGatePayload(gate),
      markingSkipped: gate.shouldStopMarking,
      factCheckAudit: pipeline.factCheckAudit,
      promptVersion: ASSIGNMENT_REVIEW_PROMPT_VERSION,
      pipelineStages: buildPipelineStages(
        gate,
        pipeline.topicAlignment,
        pipeline.stages.instructionCompliance,
        pipeline.aiSuggestedScore,
        pipeline.estimatedGrade,
      ),
      model: "assignment-pipeline-local" as string,
    };

    let result = fallback;

    // Three-agent LLM enrichment when a provider key is available
    if (process.env.OPENROUTER_API_KEY && !pipeline.stages.normalize.tooShort) {
      try {
        const provider = createAIProvider();
        const rubricHint =
          rubric.length > 0
            ? rubric
                .map((r: { name: string; maxMarks: number }) =>
                  `${r.name} (max ${r.maxMarks})`,
                )
                .join("; ")
            : "Task / brief compliance; Content accuracy & subject knowledge; Argument / thesis clarity; Critical thinking & analysis; Organisation & coherence; Evidence & examples; Referencing & academic integrity; Academic style & language accuracy";
        const mustIncludeHint =
          requiredItems.length > 0
            ? requiredItems
                .map((i: string, n: number) => `${n + 1}. ${i}`)
                .join("\n")
            : "(none listed — infer from instructions)";

        // Agent 1 — Assignment Intelligence (Gatekeeper)
        const gateRaw = await provider.complete(
          [
            {
              role: "system",
              content: ASSIGNMENT_GATEKEEPER_SYSTEM,
            },
            {
              role: "user",
              content: buildGatekeeperUserPrompt({
                briefTitle: briefContext.title,
                topic: projectTopic,
                instructions: briefInstructions,
                mustIncludeHint,
                localTopicScore: pipeline.topicAlignment.score,
                localTopicCoverage: pipeline.topicAlignment.coverage,
                localInstructionCoverage:
                  pipeline.stages.instructionCompliance.instructionCoverage,
                localRequirementsMet:
                  pipeline.stages.instructionCompliance.requirementsMetCount,
                localRequirementsTotal:
                  pipeline.stages.instructionCompliance.requirementsTotal,
                text,
              }),
            },
          ],
          { json: true },
        );
        const gateParsed = JSON.parse(gateRaw) as Record<string, unknown>;
        gate = parseGateFromLlm(gateParsed, pipeline.gate);

        let instructionCompliance: InstructionComplianceResult = {
          ...pipeline.stages.instructionCompliance,
        };
        if (Array.isArray(gateParsed.requirementChecks)) {
          const checks = parseRequirementChecks(
            gateParsed.requirementChecks,
            pipeline.requirementChecks,
          );
          instructionCompliance = {
            requirementChecks: checks,
            requirementsMetCount: checks.filter((c) => c.met).length,
            requirementsTotal: checks.length,
            instructionCoverage:
              typeof gateParsed.instructionCoverage === "number"
                ? Math.max(0, Math.min(1, gateParsed.instructionCoverage))
                : pipeline.stages.instructionCompliance.instructionCoverage,
            notes: asStringArray(
              gateParsed.notes,
              pipeline.stages.instructionCompliance.notes,
            ),
          };
        }

        const topicAlignment: TopicAlignmentResult = {
          topic: projectTopic,
          score: Math.min(
            pipeline.topicAlignment.score,
            gate.alignment.overallTopicAlignment,
          ),
          notes: asStringArray(
            gateParsed.notes,
            pipeline.topicAlignment.notes,
          ),
          coverage: pipeline.topicAlignment.coverage,
        };

        // Hard stop — skip Marker + Moderator
        if (gate.shouldStopMarking) {
          const aiSuggestedScore = outOfScopeRecommendedScore(maxScore);
          const remarksSummary = buildOutOfScopeRemarks({
            brief: briefContext,
            gate,
            recommendedScore: aiSuggestedScore,
            maxScore,
          });
          result = {
            executiveSummary: `Assignment Status: ${gate.classification}. Marking stopped — expected ${gate.expectedDiscipline}; detected ${gate.detectedDiscipline}. Recommended mark ${aiSuggestedScore}/${maxScore}.`,
            remarksSummary,
            strengths: [],
            weaknesses: [
              gate.reason,
              ...topicAlignment.notes.slice(0, 2),
              ...instructionCompliance.notes.slice(0, 3),
            ].slice(0, 8),
            highlightQuotes: {
              strengths: [] as string[],
              weaknesses: (fallbackQuotes.weaknesses || []).slice(0, 2),
              citations: fallbackQuotes.citations || [],
              wrongClaims: (pipeline.factCheckAudit?.claims || [])
                .filter(
                  (c) =>
                    c.status === "wrong_claim" ||
                    c.status === "mismatched_citation",
                )
                .map((c) => c.sentence),
            },
            areaScores: {
              ...heuristicScores,
              weaknesses: 90,
              overall: clampScore100((aiSuggestedScore / maxScore) * 100, 15),
            },
            aiContent: {
              detected: pipeline.aiContent.detected,
              percent: pipeline.aiContent.percent,
              signals: pipeline.aiContent.signals,
            },
            aiSuggestedScore,
            maxScore,
            requirementChecks: instructionCompliance.requirementChecks,
            criterionScores: pipeline.criterionScores.map((c) => ({
              ...c,
              score: ceilAiScore(
                (aiSuggestedScore / maxScore) * c.maxMarks,
                c.maxMarks,
              ),
              comment:
                "Marking skipped — submission out of scope / weak match",
            })),
            qualityChecks: [],
            supervisorRecommendation: `Do not award a full mark. Assignment Status ${gate.classification}. Recommended ${aiSuggestedScore}/${maxScore}.`,
            estimatedGrade: letterFromPercent((aiSuggestedScore / maxScore) * 100),
            projectTopic,
            topicAlignment: {
              topic: topicAlignment.topic,
              score: topicAlignment.score,
              notes: topicAlignment.notes,
            },
            assignmentStatus: gate.classification,
            assignmentGate: buildAssignmentGatePayload(gate),
            markingSkipped: true,
            promptVersion: ASSIGNMENT_REVIEW_PROMPT_VERSION,
            pipelineStages: buildPipelineStages(
              gate,
              topicAlignment,
              instructionCompliance,
              aiSuggestedScore,
              letterFromPercent((aiSuggestedScore / maxScore) * 100),
              {
                gatekeeper: "llm",
                marker: "skipped",
                moderator: "skipped",
              },
            ),
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            factCheckAudit: pipeline.factCheckAudit,
          };
        } else {
          const alignmentSummary = [
            `overallTopicAlignment: ${gate.alignment.overallTopicAlignment}/100`,
            `knowledgeDomainMatch: ${gate.alignment.knowledgeDomainMatch}/100`,
            `learningOutcomeMatch: ${gate.alignment.learningOutcomeMatch}/100`,
            `assignmentIntentMatch: ${gate.alignment.assignmentIntentMatch}/100`,
            `conceptMatch: ${gate.alignment.conceptMatch}/100`,
            `semanticSimilarity: ${gate.alignment.semanticSimilarity}/100`,
          ].join("; ");

          const wordCountLine =
            wordCountMin != null || wordCountMax != null
              ? `Word count target: ${wordCountMin ?? "—"}–${wordCountMax ?? "—"} (student ≈ ${pipeline.stages.normalize.wordCount} words)`
              : `Student word count ≈ ${pipeline.stages.normalize.wordCount}`;

          // Agent 2 — Academic Marker
          const markerRaw = await provider.complete(
            [
              {
                role: "system",
                content: ASSIGNMENT_MARKER_SYSTEM,
              },
              {
                role: "user",
                content: buildMarkerUserPrompt({
                  briefTitle: briefContext.title,
                  pageTitle: String(page.title || "Submission"),
                  maxScore,
                  wordCountLine,
                  topic: projectTopic,
                  classification: gate.classification,
                  alignmentSummary,
                  gateNotes: [gate.reason, ...topicAlignment.notes].slice(0, 6),
                  instructions: briefInstructions,
                  complianceLines: instructionCompliance.requirementChecks.map(
                    (c) =>
                      `- [${c.met ? "MET" : "MISSING"}] ${c.item} — ${c.note}`,
                  ),
                  instructionCoverage: instructionCompliance.instructionCoverage,
                  rubricHint,
                  localSuggestedMark: pipeline.aiSuggestedScore,
                  text,
                }),
              },
            ],
            { json: true },
          );
          const markerParsed = JSON.parse(markerRaw) as Record<string, unknown>;
          const quotesRaw =
            markerParsed.highlightQuotes &&
            typeof markerParsed.highlightQuotes === "object"
              ? (markerParsed.highlightQuotes as Record<string, unknown>)
              : {};
          const aiRaw =
            markerParsed.aiContent && typeof markerParsed.aiContent === "object"
              ? (markerParsed.aiContent as Record<string, unknown>)
              : {};

          const highlightQuotes = mergeHighlightQuotes(
            {
              strengths: asStringArray(quotesRaw.strengths, []),
              weaknesses: asStringArray(quotesRaw.weaknesses, []),
              citations: asStringArray(quotesRaw.citations, []),
              wrongClaims: asStringArray(quotesRaw.wrongClaims, []),
            },
            fallbackQuotes,
          );
          const quoteCount =
            (highlightQuotes.strengths?.length || 0) +
            (highlightQuotes.weaknesses?.length || 0) +
            (highlightQuotes.citations?.length || 0) +
            (highlightQuotes.wrongClaims?.length || 0);

          const areaScores = parseAreaScores(markerParsed.areaScores, {
            ...heuristicScores,
            weaknesses: pipeline.weaknessSeverity,
            overall: pipeline.overallQuality,
          });

          const criterionScores = parseCriterionScores(
            markerParsed.criterionScores,
            pipeline.criterionScores,
          );
          const qualityChecks = parseQualityChecks(
            markerParsed.qualityChecks,
            pipeline.qualityChecks || [],
          );
          const requirementChecks = instructionCompliance.requirementChecks;
          const rubricTotal = criterionScores.reduce((s, c) => s + c.score, 0);
          const rubricMax = criterionScores.reduce((s, c) => s + c.maxMarks, 0);

          let markerScore =
            typeof markerParsed.aiSuggestedScore === "number"
              ? markerParsed.aiSuggestedScore
              : rubricMax > 0
                ? (rubricTotal / rubricMax) * maxScore
                : pipeline.aiSuggestedScore;

          markerScore = applyScoreCaps({
            score: markerScore,
            maxScore,
            localCap: pipeline.aiSuggestedScore,
            weaknessSeverity: areaScores.weaknesses,
            requirementChecks,
            topicScore: topicAlignment.score,
            classification: gate.classification,
            markingSkipped: false,
          });

          const markerRemarks =
            typeof markerParsed.remarksSummary === "string" &&
            markerParsed.remarksSummary.trim().length > 40
              ? fitRemarksToWordCount(markerParsed.remarksSummary.trim(), 200, 25)
              : fallback.remarksSummary;
          const markerExecutive =
            typeof markerParsed.executiveSummary === "string"
              ? markerParsed.executiveSummary
              : fallback.executiveSummary;
          const markerStrengths = asStringArray(
            markerParsed.strengths,
            fallback.strengths,
          );
          const markerWeaknesses = asStringArray(
            markerParsed.weaknesses,
            fallback.weaknesses,
          );
          const markerGrade =
            typeof markerParsed.estimatedGrade === "string"
              ? markerParsed.estimatedGrade
              : letterFromPercent((markerScore / maxScore) * 100);

          // Agent 3 — Academic Moderator
          const moderatorRaw = await provider.complete(
            [
              {
                role: "system",
                content: ASSIGNMENT_MODERATOR_SYSTEM,
              },
              {
                role: "user",
                content: buildModeratorUserPrompt({
                  briefTitle: briefContext.title,
                  topic: projectTopic,
                  classification: gate.classification,
                  maxScore,
                  markerScore,
                  estimatedGrade: markerGrade,
                  remarksSummary: markerRemarks,
                  executiveSummary: markerExecutive,
                  strengths: markerStrengths,
                  weaknesses: markerWeaknesses,
                  criterionLines: criterionScores.map(
                    (c) =>
                      `- ${c.name}: ${c.score}/${c.maxMarks} — ${c.comment}`,
                  ),
                  alignmentSummary,
                  expectedDiscipline: gate.expectedDiscipline,
                  detectedDiscipline: gate.detectedDiscipline,
                }),
              },
            ],
            { json: true },
          );
          const modParsed = JSON.parse(moderatorRaw) as Record<string, unknown>;

          const markingStillValid =
            typeof modParsed.markingStillValid === "boolean"
              ? modParsed.markingStillValid
              : true;

          if (!markingStillValid) {
            gate = {
              ...gate,
              classification: "OUT_OF_SCOPE",
              shouldStopMarking: true,
              reason:
                typeof modParsed.remarksSummary === "string"
                  ? modParsed.remarksSummary
                  : gate.reason,
            };
            const aiSuggestedScore = outOfScopeRecommendedScore(maxScore);
            result = {
              executiveSummary:
                typeof modParsed.executiveSummary === "string"
                  ? modParsed.executiveSummary
                  : `Assignment Status: OUT_OF_SCOPE. Moderator rejected marking. Recommended ${aiSuggestedScore}/${maxScore}.`,
              remarksSummary:
                typeof modParsed.remarksSummary === "string" &&
                modParsed.remarksSummary.trim().length > 40
                  ? fitRemarksToWordCount(
                      modParsed.remarksSummary.trim(),
                      200,
                      25,
                    )
                  : buildOutOfScopeRemarks({
                      brief: briefContext,
                      gate,
                      recommendedScore: aiSuggestedScore,
                      maxScore,
                    }),
              strengths: [],
              weaknesses: markerWeaknesses.slice(0, 8),
              highlightQuotes:
                quoteCount > 0
                  ? {
                      strengths: highlightQuotes.strengths || [],
                      weaknesses: highlightQuotes.weaknesses || [],
                      citations: highlightQuotes.citations || [],
                      wrongClaims:
                        (pipeline.factCheckAudit?.claims || [])
                          .filter(
                            (c) =>
                              c.status === "wrong_claim" ||
                              c.status === "mismatched_citation",
                          )
                          .map((c) => c.sentence),
                    }
                  : {
                      strengths: [] as string[],
                      weaknesses: (fallbackQuotes.weaknesses || []).slice(0, 2),
                      citations: fallbackQuotes.citations || [],
                      wrongClaims:
                        (pipeline.factCheckAudit?.claims || [])
                          .filter(
                            (c) =>
                              c.status === "wrong_claim" ||
                              c.status === "mismatched_citation",
                          )
                          .map((c) => c.sentence),
                    },
              areaScores: {
                ...areaScores,
                weaknesses: 90,
                overall: 15,
              },
              aiContent: {
                detected:
                  typeof aiRaw.detected === "boolean"
                    ? aiRaw.detected
                    : pipeline.aiContent.detected,
                percent:
                  typeof aiRaw.percent === "number"
                    ? Math.max(0, Math.min(100, Math.round(aiRaw.percent)))
                    : pipeline.aiContent.percent,
                signals: asStringArray(aiRaw.signals, pipeline.aiContent.signals),
              },
              aiSuggestedScore,
              maxScore,
              requirementChecks,
              criterionScores: criterionScores.map((c) => ({
                ...c,
                score: ceilAiScore(
                  (aiSuggestedScore / maxScore) * c.maxMarks,
                  c.maxMarks,
                ),
                comment: "Marking invalidated by Academic Moderator",
              })),
              qualityChecks: [],
              supervisorRecommendation:
                typeof modParsed.supervisorRecommendation === "string"
                  ? modParsed.supervisorRecommendation
                  : `Moderator rejected marking. Recommended ${aiSuggestedScore}/${maxScore}.`,
              estimatedGrade: letterFromPercent(
                (aiSuggestedScore / maxScore) * 100,
              ),
              projectTopic,
              topicAlignment: {
                topic: topicAlignment.topic,
                score: topicAlignment.score,
                notes: topicAlignment.notes,
              },
              assignmentStatus: "OUT_OF_SCOPE",
              assignmentGate: buildAssignmentGatePayload(gate),
              markingSkipped: true,
              promptVersion: ASSIGNMENT_REVIEW_PROMPT_VERSION,
              pipelineStages: buildPipelineStages(
                gate,
                topicAlignment,
                instructionCompliance,
                aiSuggestedScore,
                letterFromPercent((aiSuggestedScore / maxScore) * 100),
                {
                  gatekeeper: "llm",
                  marker: "llm",
                  moderator: "llm-rejected",
                },
              ),
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              factCheckAudit: pipeline.factCheckAudit,
            };
          } else {
            let aiSuggestedScore =
              typeof modParsed.adjustedScore === "number"
                ? modParsed.adjustedScore
                : markerScore;
            // Prefer not raising more than 5% of max above marker
            aiSuggestedScore = Math.min(
              aiSuggestedScore,
              markerScore + maxScore * 0.05,
            );
            aiSuggestedScore = applyScoreCaps({
              score: aiSuggestedScore,
              maxScore,
              localCap: pipeline.aiSuggestedScore,
              weaknessSeverity: areaScores.weaknesses,
              requirementChecks,
              topicScore: topicAlignment.score,
              classification: gate.classification,
              markingSkipped: false,
            });

            const pct = (aiSuggestedScore / maxScore) * 100;
            const estimatedGrade =
              typeof modParsed.estimatedGrade === "string"
                ? modParsed.estimatedGrade
                : letterFromPercent(pct);

            const aiPercent =
              typeof aiRaw.percent === "number"
                ? Math.max(0, Math.min(100, Math.round(aiRaw.percent)))
                : pipeline.aiContent.percent;
            const aiDetected =
              typeof aiRaw.detected === "boolean"
                ? aiRaw.detected
                : aiPercent >= 45;

            result = {
              executiveSummary:
                typeof modParsed.executiveSummary === "string"
                  ? modParsed.executiveSummary
                  : markerExecutive,
              remarksSummary:
                typeof modParsed.remarksSummary === "string" &&
                modParsed.remarksSummary.trim().length > 40
                  ? fitRemarksToWordCount(
                      modParsed.remarksSummary.trim(),
                      200,
                      25,
                    )
                  : markerRemarks,
              strengths: markerStrengths,
              weaknesses: markerWeaknesses,
              areaScores,
              highlightQuotes:
                quoteCount > 0
                  ? {
                      strengths: highlightQuotes.strengths || [],
                      weaknesses: highlightQuotes.weaknesses || [],
                      citations: highlightQuotes.citations || [],
                      wrongClaims:
                        (pipeline.factCheckAudit?.claims || [])
                          .filter(
                            (c) =>
                              c.status === "wrong_claim" ||
                              c.status === "mismatched_citation",
                          )
                          .map((c) => c.sentence),
                    }
                  : {
                      strengths: [] as string[],
                      weaknesses: (fallbackQuotes.weaknesses || []).slice(0, 2),
                      citations: fallbackQuotes.citations || [],
                      wrongClaims:
                        (pipeline.factCheckAudit?.claims || [])
                          .filter(
                            (c) =>
                              c.status === "wrong_claim" ||
                              c.status === "mismatched_citation",
                          )
                          .map((c) => c.sentence),
                    },
              aiContent: {
                detected: aiDetected,
                percent: aiPercent,
                signals: asStringArray(
                  aiRaw.signals,
                  pipeline.aiContent.signals,
                ),
              },
              aiSuggestedScore,
              maxScore,
              requirementChecks,
              criterionScores,
              qualityChecks,
              supervisorRecommendation:
                typeof modParsed.supervisorRecommendation === "string"
                  ? modParsed.supervisorRecommendation
                  : typeof markerParsed.supervisorRecommendation === "string"
                    ? markerParsed.supervisorRecommendation
                    : `AI mark ${aiSuggestedScore}/${maxScore} after Gatekeeper → Marker → Moderator (${gate.classification}). Approve or enter a manual score.`,
              estimatedGrade,
              projectTopic,
              topicAlignment: {
                topic: topicAlignment.topic,
                score: topicAlignment.score,
                notes: topicAlignment.notes,
              },
              assignmentStatus: gate.classification,
              assignmentGate: buildAssignmentGatePayload(gate),
              markingSkipped: false,
              promptVersion: ASSIGNMENT_REVIEW_PROMPT_VERSION,
              pipelineStages: buildPipelineStages(
                gate,
                topicAlignment,
                instructionCompliance,
                aiSuggestedScore,
                estimatedGrade,
                {
                  gatekeeper: "llm",
                  marker: "llm",
                  moderator: "llm",
                },
              ),
              model: process.env.OPENAI_MODEL || "gpt-4o-mini",
              factCheckAudit: pipeline.factCheckAudit,
            };
          }
        }
      } catch {
        result = {
          ...fallback,
          assignmentStatus: pipeline.gate.classification,
          assignmentGate: buildAssignmentGatePayload(pipeline.gate),
          markingSkipped: pipeline.gate.shouldStopMarking,
          promptVersion: ASSIGNMENT_REVIEW_PROMPT_VERSION,
          model: "assignment-pipeline-fallback",
          factCheckAudit: pipeline.factCheckAudit,
        };
      }
    }

    result.remarksSummary = appendSectionRemarks(
      result.remarksSummary,
      pipeline.sectionRemarks,
    );
    const mergedQuotes = mergeHighlightQuotes(
      result.highlightQuotes,
      fallbackQuotes,
    );
    result.highlightQuotes = {
      strengths: mergedQuotes.strengths || [],
      weaknesses: mergedQuotes.weaknesses || [],
      citations: mergedQuotes.citations || [],
      wrongClaims: mergedQuotes.wrongClaims || [],
    };

    if (isSinglePageProjectType(String(project.projectType))) {
      project.set("aiSuggestedScore", result.aiSuggestedScore);
      project.set("aiGeneratedPercent", result.aiContent.percent);
      project.set("aiReviewSnapshot", {
        executiveSummary: result.executiveSummary,
        remarksSummary: result.remarksSummary,
        strengths: result.strengths,
        weaknesses: result.weaknesses,
        highlightQuotes: result.highlightQuotes,
        aiContent: result.aiContent,
        aiSuggestedScore: result.aiSuggestedScore,
        maxScore: result.maxScore,
        estimatedGrade: result.estimatedGrade,
        supervisorRecommendation: result.supervisorRecommendation,
        areaScores: result.areaScores,
        requirementChecks: result.requirementChecks,
        criterionScores: result.criterionScores,
        qualityChecks: result.qualityChecks,
        topicAlignment: result.topicAlignment,
        assignmentStatus: result.assignmentStatus,
        assignmentGate: result.assignmentGate,
        markingSkipped: result.markingSkipped,
        promptVersion: result.promptVersion,
        pipelineStages: result.pipelineStages,
        model: result.model,
        pageId: String(page._id),
        factCheckAudit: result.factCheckAudit || pipeline.factCheckAudit,
      });
      project.set("aiReviewedAt", new Date());

      // Auto-save assignment score and rubric criteria so marks are immediately persistent
      if (typeof result.aiSuggestedScore === "number") {
        project.set("score", result.aiSuggestedScore);
        project.set("scoreSource", "ai_approved");
        project.set("scoredAt", new Date());
        project.set("scoredBy", supervisorId);
        if (Array.isArray(result.criterionScores) && result.criterionScores.length > 0) {
          project.set(
            "criterionScores",
            result.criterionScores.map((c) => ({
              name: c.name,
              score: Math.round(c.score),
              maxMarks: c.maxMarks,
            })),
          );
        }
      }

      if (result.remarksSummary) {
        page.set("reviewRemark", result.remarksSummary);
        page.set("reviewedAt", new Date());
        page.set("reviewedBy", supervisorId);
        project.markModified("pages");
      }

      await project.save();
    }

    return result;
  },

  /**
   * Autonomous chapter agent for research/project pages (not assignment briefs).
   * Saves findings on the page; on re-review verifies prior corrections.
   */
  async summarizeResearchPage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    project: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page: any,
    pageId: string,
  ) {
    const topic = String(project.topic || "").trim();
    const pageHtml = String(page.content || "");
    const chapterTitle = String(page.title || "Chapter").trim();
    const chapterNumber = inferChapterNumber(chapterTitle, page.order);
    const abstract = String(project.abstract || "").trim();
    const outlineTitles = [...(project.pages || [])]
      .sort(
        (a: { order?: number }, b: { order?: number }) =>
          (a.order ?? 0) - (b.order ?? 0),
      )
      .map((p: { title?: string }) => String(p.title || "").trim())
      .filter(Boolean);

    const priorRaw = Array.isArray(page.aiCorrectionFindings)
      ? page.aiCorrectionFindings
      : [];
    const priorFindings = parseCorrectionFindings(priorRaw, []).filter(
      (f) =>
        f.area !== "topic" &&
        !/align(?:ment)? with the project topic|topic alignment/i.test(
          `${f.finding} ${f.correction}`,
        ),
    );

    const local = runChapterReviewPipeline({
      htmlOrText: pageHtml,
      project: {
        title: String(project.title || ""),
        topic,
        abstract,
      },
      chapter: {
        title: chapterTitle,
        number: chapterNumber,
      },
    });

    if (local.stages.normalize.tooShort) {
      throw new ValidationError(
        "This page has too little text for AI review (need at least ~40 words). Ask the student to expand the chapter, then retry.",
      );
    }

    const { pipeline, model } = await enrichChapterPipelineWithLlm(local, {
      projectTitle: String(project.title || ""),
      topic,
      chapterTitle,
      chapterNumber,
      abstract,
      outlineTitles,
    });

    let correctionChecks: CorrectionCheck[] = [];
    if (priorFindings.length > 0) {
      correctionChecks = await verifyPriorFindingsWithLlm({
        priorFindings,
        topic,
        chapterTitle,
        text: pipeline.stages.normalize.plainText,
      });
    }

    // Structured findings for re-verification only (never topic alignment)
    pipeline.correctionFindings = pipeline.correctionFindings.filter(
      (f) =>
        f.area !== "topic" &&
        !/align(?:ment)? with the project topic|topic alignment/i.test(
          `${f.finding} ${f.correction}`,
        ),
    );

    const reviewerReport =
      pipeline.reviewerReport ||
      pipeline.correctionSummary ||
      buildCorrectionFindings(pipeline).reviewerReport;

    const result = {
      executiveSummary: pipeline.executiveSummary,
      reviewerReport,
      remarksSummary: reviewerReport,
      correctionSummary: reviewerReport,
      correctionFindings: pipeline.correctionFindings,
      // Correction-check UI removed from lecturer view; still persist checks on page
      correctionChecks: undefined,
      addressedCount: undefined,
      partialCount: undefined,
      outstandingCount: undefined,
      priorFindingsCount: undefined,
      strengths: pipeline.strengths,
      weaknesses: pipeline.weaknesses.filter((w) => !/topic alignment/i.test(w)),
      researchGaps: pipeline.researchGaps,
      revisionPriorities: pipeline.revisionPriorities,
      writingSuggestions: pipeline.writingSuggestions,
      highlightQuotes: pipeline.highlightQuotes,
      areaScores: pipeline.areaScores,
      // Topic alignment is not part of the lecturer-facing review
      topicAlignment: undefined,
      projectTopic: undefined,
      supervisorRecommendation: pipeline.supervisorRecommendation,
      estimatedGrade: pipeline.estimatedGrade,
      decisionLean: pipeline.decisionLean,
      readabilityScore: pipeline.readabilityScore,
      criticalThinkingScore: pipeline.criticalThinkingScore,
      aiContent: {
        detected: pipeline.aiContent.detected,
        percent: pipeline.aiContent.percent,
        signals: pipeline.aiContent.signals,
      },
      pipelineStages: {
        normalize: {
          wordCount: pipeline.stages.normalize.wordCount,
          tooShort: pipeline.stages.normalize.tooShort,
        },
        structure: {
          score: pipeline.stages.structure.score,
          missingSections: pipeline.stages.structure.missingSections,
        },
        evidence: {
          score: pipeline.stages.evidence.score,
          citationCount: pipeline.stages.evidence.citationCount,
        },
        academic: {
          criticalThinkingScore: pipeline.criticalThinkingScore,
          methodologyScore: pipeline.stages.academic.methodology.score,
          literatureScore: pipeline.stages.academic.literatureReview.score,
          researchGapScore: pipeline.stages.academic.researchGap.score,
        },
        risks: {
          aiPercent: pipeline.aiContent.percent,
          riskCount: pipeline.stages.risks.risks.length,
        },
      },
      model,
      promptVersion: CHAPTER_REVIEW_PROMPT_VERSION,
      chapterTitle,
      pageId: String(pageId),
      hideTopicAlignment: true,
    };

    // Persist on the page (source of truth for next verification)
    page.aiCorrectionFindings = pipeline.correctionFindings;
    page.aiCorrectionSummary = reviewerReport;
    page.aiCorrectionChecks = correctionChecks;
    page.aiReviewedAt = new Date();
    page.aiReviewModel = model;
    if (typeof page.markModified === "function") {
      page.markModified("aiCorrectionFindings");
      page.markModified("aiCorrectionChecks");
    }
    project.markModified("pages");

    project.set("aiReviewSnapshot", {
      ...result,
      highlightQuotes: result.highlightQuotes,
      pageId: String(page._id),
    });
    project.set("aiReviewedAt", new Date());
    project.set("aiGeneratedPercent", pipeline.aiContent.percent);
    await project.save();

    return result;
  },

  /**
   * On-demand supervisor AI Reviewer: uses the project topic to analyse a
   * submitted chapter for weaknesses, research gaps, and topic misalignment.
   */
  async analyzeChapterWeaknesses(
    tenantId: string,
    chapterId: string,
    supervisorId: string,
  ) {
    const { projectRepository } = await import("./portal-project.repo.js");

    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    const project = await projectRepository.findById(
      tenantId,
      String(chapter.projectId),
    );
    if (!project) throw new NotFoundError("Project not found");

    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only run AI Reviewer on projects assigned to you",
      );
    }

    let version = chapter.currentVersionId
      ? await chapterRepository.findVersion(
          tenantId,
          String(chapter.currentVersionId),
        )
      : null;
    if (!version) {
      version = await chapterRepository.lastVersion(tenantId, chapterId);
    }
    if (!version) {
      throw new NotFoundError("No submitted version found for this chapter");
    }

    const topic = String(project.topic || "").trim();
    const html =
      (version.richTextJson as { html?: string } | undefined)?.html ||
      extractVersionText(version);

    const local = runChapterReviewPipeline({
      htmlOrText: html,
      project: {
        title: String(project.title || ""),
        topic,
        abstract: String(project.abstract || ""),
      },
      chapter: {
        title: String(chapter.title || ""),
        number: Number(chapter.number) || 1,
      },
    });

    const { pipeline, model } = await enrichChapterPipelineWithLlm(local, {
      projectTitle: String(project.title || ""),
      topic,
      chapterTitle: String(chapter.title || ""),
      chapterNumber: Number(chapter.number) || 1,
    });

    return {
      executiveSummary: pipeline.executiveSummary,
      reviewerReport: pipeline.reviewerReport,
      remarksSummary: pipeline.reviewerReport || pipeline.remarksSummary,
      correctionSummary: pipeline.reviewerReport || pipeline.correctionSummary,
      correctionFindings: pipeline.correctionFindings.filter(
        (f) => f.area !== "topic",
      ),
      strengths: pipeline.strengths,
      weaknesses: pipeline.weaknesses.filter((w) => !/topic alignment/i.test(w)),
      researchGaps: pipeline.researchGaps,
      revisionPriorities: pipeline.revisionPriorities,
      writingSuggestions: pipeline.writingSuggestions,
      highlightQuotes: pipeline.highlightQuotes,
      areaScores: pipeline.areaScores,
      topicAlignment: undefined,
      projectTopic: undefined,
      hideTopicAlignment: true,
      supervisorRecommendation: pipeline.supervisorRecommendation,
      estimatedGrade: pipeline.estimatedGrade,
      decisionLean: pipeline.decisionLean,
      readabilityScore: pipeline.readabilityScore,
      criticalThinkingScore: pipeline.criticalThinkingScore,
      aiContent: {
        detected: pipeline.aiContent.detected,
        percent: pipeline.aiContent.percent,
        signals: pipeline.aiContent.signals,
      },
      pipelineStages: {
        normalize: {
          wordCount: pipeline.stages.normalize.wordCount,
          tooShort: pipeline.stages.normalize.tooShort,
        },
        structure: {
          score: pipeline.stages.structure.score,
          missingSections: pipeline.stages.structure.missingSections,
        },
        evidence: {
          score: pipeline.stages.evidence.score,
          citationCount: pipeline.stages.evidence.citationCount,
        },
        academic: {
          criticalThinkingScore: pipeline.criticalThinkingScore,
          methodologyScore: pipeline.stages.academic.methodology.score,
          literatureScore: pipeline.stages.academic.literatureReview.score,
          researchGapScore: pipeline.stages.academic.researchGap.score,
        },
        risks: {
          aiPercent: pipeline.aiContent.percent,
          riskCount: pipeline.stages.risks.risks.length,
        },
      },
      model,
      promptVersion: CHAPTER_REVIEW_PROMPT_VERSION,
      chapterTitle: String(chapter.title || ""),
    };
  },

  /** Worker entry: mark processing → completed with provider or deterministic report. */
  async processQueued(tenantId: string, reviewId: string) {
    const review = await aiReviewRepository.findById(tenantId, reviewId);
    if (!review) throw new NotFoundError("AI review not found");

    review.status = AiReviewStatus.Processing;
    await review.save();

    try {
      const { report, model } = await generateReport(
        String(review.versionId),
        tenantId,
      );
      review.report = report;
      review.set("model", String(model));
      review.status = AiReviewStatus.Completed;
      review.completedAt = new Date();
      review.error = undefined;
      await review.save();
      return review;
    } catch (error) {
      review.status = AiReviewStatus.Failed;
      review.error = error instanceof Error ? error.message : "AI processing failed";
      await review.save();
      throw error;
    }
  },
};
