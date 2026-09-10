/**
 * Multi-stage chapter AI review for research supervisors.
 * Local heuristics always run; LLM enrichment (optional) merges on top.
 */

import {
  computeAreaScores,
  pickFallbackHighlightQuotes,
  type AreaScores,
  type ReviewTextHighlights,
} from "./apply-highlights.js";
import {
  estimateAiGeneratedContent,
  normalizeSubmission,
  assessTopicAlignment,
  type AiContentDetection,
  type NormalizedSubmission,
  type TopicAlignmentResult,
} from "./assignment-ai-analysis.js";

export type ChapterReviewContext = {
  projectTitle: string;
  topic: string;
  chapterTitle: string;
  chapterNumber: number;
  /** Optional abstract / overview for richer alignment. */
  abstract?: string;
};

export type StructureCompletenessResult = {
  score: number;
  missingSections: string[];
  notes: string[];
  wordCount: number;
  expectedMinWords: number;
};

export type EvidenceCitationsResult = {
  score: number;
  citationCount: number;
  uncitedClaimSignals: number;
  notes: string[];
  /** Exact-ish excerpts for citation highlights (from local heuristics). */
  citationQuotes: string[];
};

export type AcademicDepthResult = {
  criticalThinkingScore: number;
  methodology: { score: number; notes: string[] };
  literatureReview: { score: number; notes: string[] };
  researchGap: { score: number; notes: string[] };
  notes: string[];
};

export type RiskAssessmentResult = {
  risks: string[];
  overclaimSignals: number;
  aiContent: AiContentDetection;
};

export type ChapterFeedbackSynthesis = {
  executiveSummary: string;
  remarksSummary: string;
  strengths: string[];
  weaknesses: string[];
  researchGaps: string[];
  revisionPriorities: string[];
  writingSuggestions: string[];
  supervisorRecommendation: string;
  /** approve | request_revision lean for the lecturer. */
  decisionLean: "approve" | "request_revision";
  estimatedGrade: string;
  readabilityScore: number;
};

export type ChapterPipelineStages = {
  normalize: NormalizedSubmission;
  structure: StructureCompletenessResult;
  alignment: TopicAlignmentResult & {
    researchQuestions: number;
    objectives: number;
    hypothesis: number;
  };
  evidence: EvidenceCitationsResult;
  academic: AcademicDepthResult;
  risks: RiskAssessmentResult;
  feedback: ChapterFeedbackSynthesis;
};

export type CorrectionFindingArea =
  | "topic"
  | "structure"
  | "gap"
  | "weakness"
  | "citation"
  | "method"
  | "other";

export type CorrectionFinding = {
  id: string;
  area: CorrectionFindingArea;
  severity: "high" | "medium" | "low";
  finding: string;
  correction: string;
};

export type CorrectionCheck = {
  findingId: string;
  area: CorrectionFindingArea;
  finding: string;
  correction: string;
  status: "addressed" | "partial" | "not_addressed";
  evidence: string;
};

export type ChapterReviewPipelineResult = {
  stages: ChapterPipelineStages;
  areaScores: AreaScores;
  highlightQuotes: ReviewTextHighlights;
  researchGaps: string[];
  revisionPriorities: string[];
  remarksSummary: string;
  executiveSummary: string;
  strengths: string[];
  weaknesses: string[];
  supervisorRecommendation: string;
  estimatedGrade: string;
  decisionLean: "approve" | "request_revision";
  writingSuggestions: string[];
  readabilityScore: number;
  criticalThinkingScore: number;
  aiContent: AiContentDetection;
  projectTopic: string;
  chapterTitle: string;
  topicAlignment: {
    topic: string | null;
    score: number | null;
    notes: string[];
  };
  correctionFindings: CorrectionFinding[];
  correctionSummary: string;
  /** Proper prose supervisor report for the lecturer UI / remarks. */
  reviewerReport: string;
};

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/**
 * Infer chapter number from page/chapter title, else order + 1.
 */
export function inferChapterNumber(
  title?: string | null,
  order?: number | null,
): number {
  const t = String(title || "").trim();
  const numbered = t.match(/chapter\s*(\d+)/i);
  if (numbered) {
    const n = Number(numbered[1]);
    if (n >= 1 && n <= 20) return n;
  }
  const lower = t.toLowerCase();
  if (/literature|lit\.?\s*review|related work/.test(lower)) return 2;
  if (/methodolog|methods?|research design|materials and methods/.test(lower))
    return 3;
  if (/findings?|results?|data analysis|analysis of (?:data|results)/.test(lower))
    return 4;
  if (/discussion/.test(lower)) return 5;
  if (/conclusion|recommendation|summary and conclusion/.test(lower)) return 6;
  if (/introduction|background|problem statement/.test(lower)) return 1;
  return Math.max(1, (typeof order === "number" ? order : 0) + 1);
}

function findingId(area: CorrectionFindingArea, index: number) {
  return `${area}-${index + 1}`;
}

/**
 * Build structured findings for re-verification only (not lecturer bullet UI).
 * Topic alignment is intentionally excluded from review findings.
 */
export function buildCorrectionFindings(
  pipeline: ChapterReviewPipelineResult,
): { findings: CorrectionFinding[]; summary: string; reviewerReport: string } {
  const findings: CorrectionFinding[] = [];
  const structure = pipeline.stages.structure;
  const evidence = pipeline.stages.evidence;
  const academic = pipeline.stages.academic;

  if (structure.score < 55 || structure.missingSections.length > 0) {
    findings.push({
      id: findingId("structure", findings.length),
      area: "structure",
      severity: structure.score < 40 ? "high" : "medium",
      finding:
        structure.missingSections.length > 0
          ? `Structure is thin — missing cues for: ${structure.missingSections.slice(0, 3).join(", ")}`
          : "Chapter structure / completeness is below expectations",
      correction:
        structure.missingSections.length > 0
          ? `Add clearer sections covering ${structure.missingSections.slice(0, 3).join(", ")}`
          : "Strengthen headings, transitions, and expected chapter sections",
    });
  }

  if (evidence.score < 60 || evidence.uncitedClaimSignals >= 2) {
    findings.push({
      id: findingId("citation", findings.length),
      area: "citation",
      severity:
        evidence.citationCount === 0 && structure.wordCount >= 80
          ? "high"
          : "medium",
      finding:
        evidence.citationCount === 0
          ? "Little or no in-text citation practice detected"
          : `${evidence.uncitedClaimSignals} claim-like sentences appear without in-text citations`,
      correction:
        "Add (Author, Year) or [n] citations to factual claims and align the reference list",
    });
  }

  for (const gap of pipeline.researchGaps.slice(0, 3)) {
    if (
      /detected|present|cues/i.test(gap) &&
      !/not |missing|unclear|need/i.test(gap)
    ) {
      continue;
    }
    findings.push({
      id: findingId("gap", findings.length),
      area: "gap",
      severity: "medium",
      finding: gap,
      correction:
        "State the research gap and contribution explicitly in one clear paragraph",
    });
  }

  for (const w of pipeline.weaknesses.slice(0, 4)) {
    if (/citation|topic alignment|structure|gap/i.test(w)) continue;
    findings.push({
      id: findingId("weakness", findings.length),
      area: "weakness",
      severity: pipeline.areaScores.weaknesses >= 70 ? "high" : "medium",
      finding: w,
      correction:
        "Revise this weakness with clearer argument, evidence, and critique",
    });
  }

  if (
    academic.methodology.score < 55 &&
    /method/i.test(
      pipeline.chapterTitle + String(pipeline.stages.structure.notes),
    )
  ) {
    findings.push({
      id: findingId("method", findings.length),
      area: "method",
      severity: "high",
      finding: "Methodology justification is underdeveloped",
      correction:
        "Justify design, sampling, data collection, and limitations clearly",
    });
  }

  if (findings.length === 0 && pipeline.decisionLean === "request_revision") {
    findings.push({
      id: findingId("other", 0),
      area: "other",
      severity: "medium",
      finding: "Chapter needs targeted revision before approval",
      correction:
        pipeline.revisionPriorities[0] ||
        "Strengthen critical analysis, evidence, and chapter completeness",
    });
  }

  const sorted = findings
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 8);

  const areaCounts: Record<string, number> = {};
  const unique = sorted.map((f) => {
    const n = areaCounts[f.area] ?? 0;
    areaCounts[f.area] = n + 1;
    return { ...f, id: findingId(f.area, n) };
  });

  const reviewerReport = buildReviewerReport(pipeline, unique);
  return {
    findings: unique,
    summary: reviewerReport,
    reviewerReport,
  };
}

/**
 * Continuous prose supervisor report (no bullet checklist / severity labels).
 */
export function buildReviewerReport(
  pipeline: ChapterReviewPipelineResult,
  findings?: CorrectionFinding[],
): string {
  const items = findings ?? pipeline.correctionFindings;
  const structure = pipeline.stages.structure;
  const evidence = pipeline.stages.evidence;
  const academic = pipeline.stages.academic;
  const chapter = pipeline.chapterTitle || "this chapter";
  const lean =
    pipeline.decisionLean === "approve"
      ? "The chapter is approaching a standard suitable for approval, subject to light polishing."
      : "On balance, the chapter is not yet ready for approval and should be returned for revision.";

  const paras: string[] = [];

  paras.push(
    `This review of “${chapter}” considers the quality of the argument, the completeness of the chapter structure, the handling of research gaps, the strength of critical engagement, and the adequacy of citation practice. ${lean}`,
  );

  if (structure.wordCount < 80) {
    paras.push(
      `The submission is currently too brief to support a full academic reading. At approximately ${structure.wordCount} words, the chapter needs substantial expansion before the analytical and evidentiary claims can be assessed fairly.`,
    );
  } else if (structure.score < 55 || structure.missingSections.length > 0) {
    const missing =
      structure.missingSections.length > 0
        ? ` In particular, the draft would benefit from clearer development of ${structure.missingSections
            .slice(0, 3)
            .join(", ")}.`
        : "";
    paras.push(
      `Structurally, the chapter remains under-developed for this stage of the work.${missing} Clearer sectioning, transitions, and fuller treatment of the expected elements would help the reader follow the scholarly argument.`,
    );
  } else {
    paras.push(
      `The organisation of the chapter is broadly workable for review. Continued attention to section clarity and transitions will help sustain academic coherence as the argument develops.`,
    );
  }

  const gapNotes = pipeline.researchGaps
    .filter((g) => /not |missing|unclear|need|should|explicit/i.test(g))
    .slice(0, 2);
  if (gapNotes.length > 0 || academic.researchGap.score < 55) {
    paras.push(
      `The research gap and contribution need fuller articulation. ${
        gapNotes[0] ||
        "The draft should state more explicitly what prior work leaves unresolved and how this chapter advances the study."
      } A concise, well-placed gap statement will strengthen the scholarly purpose of the writing.`,
    );
  }

  if (pipeline.weaknesses.length > 0 || academic.criticalThinkingScore < 55) {
    const weak = pipeline.weaknesses
      .filter((w) => !/topic alignment/i.test(w))
      .slice(0, 2)
      .join(" ");
    paras.push(
      `On the quality of argument, critical engagement remains a priority. ${
        weak ||
        "The writing tends toward summary where stronger comparison, critique, and justified stance are expected."
      } Strengthening the analytical voice—rather than restating sources—will improve the academic value of the chapter.`,
    );
  }

  if (evidence.score < 60 || evidence.uncitedClaimSignals >= 2) {
    paras.push(
      evidence.citationCount === 0
        ? `Citation practice is currently insufficient. Key claims are advanced with little or no in-text referencing, which weakens academic integrity and makes it difficult to verify the evidence base. The student should attach appropriate citations to factual and literature-based claims and ensure the reference list is complete and consistent.`
        : `Evidence and referencing require attention. Several claim-like passages appear without clear in-text citations. The student should verify that every substantive claim is supported, that in-text citations match the reference list, and that a single referencing style is applied consistently.`,
    );
  }

  if (
    academic.methodology.score < 55 &&
    /method/i.test(pipeline.chapterTitle)
  ) {
    paras.push(
      `As a methods-focused chapter, the justification of design, sampling, data collection, and limitations remains underdeveloped. These elements should be stated explicitly so that the methodological choices are transparent and defensible.`,
    );
  }

  const corrections = items
    .slice(0, 4)
    .map((f) => f.correction)
    .filter(Boolean);
  if (corrections.length > 0) {
    paras.push(
      `Before resubmission, the student should concentrate on the following corrections. ${corrections
        .map((c, i) => {
          if (i === 0) return c.endsWith(".") ? c : `${c}.`;
          return c.endsWith(".") ? c : `${c}.`;
        })
        .join(" ")} ${pipeline.supervisorRecommendation || ""}`.trim(),
    );
  } else if (pipeline.supervisorRecommendation) {
    paras.push(pipeline.supervisorRecommendation);
  }

  return paras.filter(Boolean).join("\n\n");
}

/**
 * Local verification of prior correction findings against current text.
 */
export function verifyCorrectionFindings(
  prior: CorrectionFinding[],
  htmlOrText: string,
  opts?: { topic?: string },
): CorrectionCheck[] {
  const plain = String(htmlOrText || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const topic = String(opts?.topic || "").toLowerCase();
  const citeCount = (
    plain.match(/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./g) || []
  ).length;
  const wordCount = plain.split(/\s+/).filter(Boolean).length;

  return prior.map((f) => {
    const correctionTokens = f.correction
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 8);
    let hits = 0;
    for (const t of correctionTokens) {
      if (plain.includes(t)) hits += 1;
    }
    const coverage =
      correctionTokens.length === 0 ? 0 : hits / correctionTokens.length;

    let status: CorrectionCheck["status"] = "not_addressed";
    let evidence = "Little evidence the requested correction appears in the revised text";

    if (f.area === "citation") {
      if (citeCount >= 3) {
        status = "addressed";
        evidence = `In-text citation signals increased (≈${citeCount} hits)`;
      } else if (citeCount >= 1) {
        status = "partial";
        evidence = `Some citations present (≈${citeCount}) but coverage still thin`;
      }
    } else if (f.area === "topic" && topic) {
      const topicTokens = topic.split(/\s+/).filter((w) => w.length > 3);
      let tHits = 0;
      for (const t of topicTokens) {
        if (plain.includes(t)) tHits += 1;
      }
      const tCov = topicTokens.length ? tHits / topicTokens.length : 0;
      if (tCov >= 0.55) {
        status = "addressed";
        evidence = `Topic keyword coverage ≈${Math.round(tCov * 100)}%`;
      } else if (tCov >= 0.3) {
        status = "partial";
        evidence = `Partial topic overlap ≈${Math.round(tCov * 100)}%`;
      }
    } else if (f.area === "structure") {
      if (wordCount >= 400 && coverage >= 0.35) {
        status = "addressed";
        evidence = "Length and section-related language improved";
      } else if (wordCount >= 200 || coverage >= 0.2) {
        status = "partial";
        evidence = "Some structural improvement; expected sections may still be thin";
      }
    } else if (coverage >= 0.45) {
      status = "addressed";
      evidence = `Revised text reflects key correction terms (${hits}/${correctionTokens.length})`;
    } else if (coverage >= 0.25) {
      status = "partial";
      evidence = `Partial overlap with the requested correction (${hits}/${correctionTokens.length} terms)`;
    }

    return {
      findingId: f.id,
      area: f.area,
      finding: f.finding,
      correction: f.correction,
      status,
      evidence,
    };
  });
}

export function parseCorrectionFindings(
  raw: unknown,
  fallback: CorrectionFinding[],
): CorrectionFinding[] {
  if (!Array.isArray(raw)) return fallback;
  const areas: CorrectionFindingArea[] = [
    "topic",
    "structure",
    "gap",
    "weakness",
    "citation",
    "method",
    "other",
  ];
  const parsed = raw
    .map((row, i) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const finding = typeof obj.finding === "string" ? obj.finding.trim() : "";
      const correction =
        typeof obj.correction === "string" ? obj.correction.trim() : "";
      if (!finding || !correction) return null;
      const area = areas.includes(obj.area as CorrectionFindingArea)
        ? (obj.area as CorrectionFindingArea)
        : "other";
      const severity =
        obj.severity === "high" || obj.severity === "medium" || obj.severity === "low"
          ? obj.severity
          : "medium";
      return {
        id:
          typeof obj.id === "string" && obj.id.trim()
            ? obj.id.trim()
            : findingId(area, i),
        area,
        severity,
        finding,
        correction,
      } satisfies CorrectionFinding;
    })
    .filter((f): f is CorrectionFinding => f != null);
  return parsed.length > 0 ? parsed.slice(0, 8) : fallback;
}

export function parseCorrectionChecks(
  raw: unknown,
  fallback: CorrectionCheck[],
): CorrectionCheck[] {
  if (!Array.isArray(raw)) return fallback;
  const statuses = ["addressed", "partial", "not_addressed"] as const;
  const parsed = raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const findingIdVal =
        typeof obj.findingId === "string" ? obj.findingId : "";
      const finding = typeof obj.finding === "string" ? obj.finding : "";
      const correction =
        typeof obj.correction === "string" ? obj.correction : "";
      if (!findingIdVal || !finding) return null;
      const status = statuses.includes(obj.status as (typeof statuses)[number])
        ? (obj.status as CorrectionCheck["status"])
        : "not_addressed";
      const area = (
        ["topic", "structure", "gap", "weakness", "citation", "method", "other"] as const
      ).includes(obj.area as CorrectionFindingArea)
        ? (obj.area as CorrectionFindingArea)
        : "other";
      return {
        findingId: findingIdVal,
        area,
        finding,
        correction,
        status,
        evidence:
          typeof obj.evidence === "string" && obj.evidence.trim()
            ? obj.evidence.trim()
            : status === "addressed"
              ? "Marked addressed by AI verification"
              : "No clear evidence of correction",
      } satisfies CorrectionCheck;
    })
    .filter((c): c is CorrectionCheck => c != null);
  return parsed.length > 0 ? parsed : fallback;
}

function letterFromPercent(pct: number): string {
  if (pct >= 70) return "A";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  if (pct >= 30) return "E";
  return "F";
}

function expectedSectionsForChapter(chapterNumber: number): string[] {
  switch (chapterNumber) {
    case 1:
      return [
        "introduction",
        "background",
        "problem",
        "objective",
        "research question",
      ];
    case 2:
      return ["literature", "theoretical", "conceptual", "gap", "review"];
    case 3:
      return [
        "methodology",
        "method",
        "design",
        "sampling",
        "data collection",
        "limitation",
      ];
    case 4:
      return ["result", "finding", "analysis", "presentation"];
    case 5:
      return ["discussion", "implication", "interpretation"];
    case 6:
    case 7:
      return ["conclusion", "recommendation", "contribution", "summary"];
    default:
      return ["introduction", "conclusion", "analysis"];
  }
}

function expectedMinWords(chapterNumber: number): number {
  if (chapterNumber <= 1) return 800;
  if (chapterNumber === 2) return 1500;
  if (chapterNumber === 3) return 1000;
  return 800;
}

/** Stage 2 — structure / completeness vs chapter-type expectations. */
export function assessStructureCompleteness(
  text: string,
  chapterNumber: number,
  chapterTitle: string,
): StructureCompletenessResult {
  const plain = text.replace(/\s+/g, " ").trim();
  const words = plain.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const lower = plain.toLowerCase();
  const titleLower = chapterTitle.toLowerCase();
  const expected = expectedSectionsForChapter(chapterNumber);
  const minWords = expectedMinWords(chapterNumber);

  const missingSections: string[] = [];
  const notes: string[] = [];

  for (const section of expected) {
    const present =
      lower.includes(section) ||
      titleLower.includes(section) ||
      // Allow plural / related forms
      (section === "research question" &&
        /\bresearch questions?\b|\bRQs?\b/i.test(plain)) ||
      (section === "objective" && /\bobjectives?\b/i.test(plain)) ||
      (section === "gap" && /\bresearch gap|knowledge gap|gap in\b/i.test(plain));
    if (!present) missingSections.push(section);
  }

  let score = 78;
  if (wordCount < 80) {
    score = 18;
    notes.push("Chapter text is far too short for academic review");
  } else if (wordCount < minWords * 0.35) {
    score = Math.min(score, 35);
    notes.push(
      `Word count (${wordCount}) is well below the expected ~${minWords} for chapter ${chapterNumber}`,
    );
  } else if (wordCount < minWords * 0.6) {
    score = Math.min(score, 55);
    notes.push(
      `Word count (${wordCount}) is thin for chapter ${chapterNumber} (target ~${minWords}+)`,
    );
  } else {
    notes.push(`Word count ${wordCount} is in a workable range for this chapter`);
  }

  if (missingSections.length > 0) {
    score -= Math.min(40, missingSections.length * 8);
    notes.push(
      `Possible missing framing: ${missingSections.slice(0, 4).join(", ")}`,
    );
  } else {
    notes.push("Expected section cues for this chapter type appear present");
  }

  return {
    score: clamp(score),
    missingSections,
    notes: notes.slice(0, 6),
    wordCount,
    expectedMinWords: minWords,
  };
}

/** Stage 4 — evidence & citation signals. */
export function assessEvidenceCitations(text: string): EvidenceCitationsResult {
  const plain = text.replace(/\s+/g, " ").trim();
  const words = plain.split(/\s+/).filter(Boolean);
  const count = words.length;
  const notes: string[] = [];

  const citationMatches =
    plain.match(
      /\((?:[A-Z][a-zA-Z\-]+(?:\s+(?:&|and)\s+[A-Z][a-zA-Z\-]+)*(?:,\s*)?(?:et al\.)?,?\s*)?\d{4}[a-z]?\)|\[\d+\]|et al\./g,
    ) || [];
  const citationCount = citationMatches.length;

  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40);

  const claimPattern =
    /\b(studies? (?:show|have shown|indicate|suggest)|research (?:shows|indicates|suggests)|it (?:is|has been) (?:shown|found|established)|findings? (?:show|indicate|suggest)|according to|evidence (?:shows|suggests)|researchers? (?:have|found)|significant (?:effect|impact|difference)|proves? that|demonstrates? that)\b/i;

  const citationQuotes: string[] = [];
  let uncitedClaimSignals = 0;
  for (const sentence of sentences) {
    if (!claimPattern.test(sentence)) continue;
    if (/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./i.test(sentence)) continue;
    uncitedClaimSignals += 1;
    if (citationQuotes.length < 8) {
      citationQuotes.push(sentence.slice(0, 220));
    }
  }

  let score = 70;
  if (count >= 120 && citationCount === 0) {
    score = 28;
    notes.push("No in-text citations detected in a substantial chapter draft");
  } else if (citationCount === 1 && count >= 200) {
    score = 45;
    notes.push("Only one citation signal — evidence base looks thin");
  } else if (citationCount >= 5) {
    score = 82;
    notes.push(`${citationCount} in-text citation signals found`);
  } else if (citationCount >= 2) {
    score = 68;
    notes.push(`${citationCount} citation signals — expand referencing coverage`);
  }

  if (uncitedClaimSignals >= 3) {
    score = Math.min(score, 48);
    notes.push(
      `${uncitedClaimSignals} claim-like sentences appear without in-text citations`,
    );
  } else if (uncitedClaimSignals >= 1) {
    score = Math.min(score, 62);
    notes.push("Some claims may need in-text citations");
  }

  const hasReferenceList = /\breferences?\b|\bbibliography\b/i.test(plain);
  if (!hasReferenceList && citationCount > 0 && count >= 300) {
    notes.push("In-text citations present but no clear reference list heading");
    score = Math.min(score, score - 5);
  }

  // Style drift hint (multiple styles mixed)
  const hasApaHarvard = /\([A-Z][a-z]+(?:[^)]*),\s*\d{4}/.test(plain);
  const hasIeee = /\[\d+\]/.test(plain);
  if (hasApaHarvard && hasIeee) {
    notes.push("Mixed citation styles (author-year and numbered) — pick one style");
    score = Math.min(score, score - 8);
  }

  return {
    score: clamp(score),
    citationCount,
    uncitedClaimSignals,
    notes: notes.slice(0, 6),
    citationQuotes,
  };
}

/** Stage 5 — argument / method / lit-review / gap (chapter-aware). */
export function assessAcademicDepth(
  text: string,
  chapterNumber: number,
): AcademicDepthResult {
  const plain = text.replace(/\s+/g, " ").trim();
  const lower = plain.toLowerCase();
  const count = plain.split(/\s+/).filter(Boolean).length;
  const notes: string[] = [];

  const criticalMarkers = (
    plain.match(
      /\b(however|although|whereas|in contrast|critique|critically|nevertheless|conversely|limitation|argue|contends?|debate)\b/gi,
    ) || []
  ).length;
  const summaryMarkers = (
    plain.match(
      /\b(according to|stated that|mentioned that|defined as|is defined|refers to)\b/gi,
    ) || []
  ).length;

  let criticalThinkingScore = 55;
  criticalThinkingScore += Math.min(25, criticalMarkers * 4);
  criticalThinkingScore -= Math.min(20, Math.max(0, summaryMarkers - 3) * 3);
  if (count < 120) criticalThinkingScore = Math.min(criticalThinkingScore, 35);
  criticalThinkingScore = clamp(criticalThinkingScore);

  if (criticalMarkers < 2 && count >= 200) {
    notes.push("Limited critical engagement markers — reads more like summary");
  } else if (criticalMarkers >= 4) {
    notes.push("Some critical / comparative language present");
  }

  // Literature review
  let litScore = 55;
  const litNotes: string[] = [];
  if (chapterNumber === 2 || /\bliterature\b/i.test(plain)) {
    const synthesis =
      /\b(theme|thematic|synthes|body of (?:work|literature)|consensus|divergence)\b/i.test(
        plain,
      );
    const gapMention =
      /\b(gap|under[- ]?explored|scarcity|limited research|few studies)\b/i.test(
        plain,
      );
    litScore = synthesis ? 78 : 52;
    if (!synthesis) {
      litNotes.push("Move from study-by-study summary toward thematic synthesis");
    } else {
      litNotes.push("Thematic / synthesis cues detected");
    }
    if (!gapMention && chapterNumber === 2) {
      litScore = Math.min(litScore, 48);
      litNotes.push("Research gap is not stated clearly in the literature chapter");
    }
  } else {
    litNotes.push("Literature depth is secondary for this chapter type");
    litScore = 65;
  }

  // Methodology
  let methodScore = 55;
  const methodNotes: string[] = [];
  if (chapterNumber === 3 || /\bmethodolog/i.test(plain)) {
    const hasDesign =
      /\b(qualitative|quantitative|mixed[- ]methods?|case study|survey|interview|experiment)\b/i.test(
        plain,
      );
    const hasSampling = /\b(sample|sampling|participant|respondent|population)\b/i.test(
      plain,
    );
    const hasLimits = /\b(limitation|threat to validity|bias|generalisab|generalizab)\b/i.test(
      plain,
    );
    methodScore = 40;
    if (hasDesign) methodScore += 20;
    else methodNotes.push("Research design / approach is unclear");
    if (hasSampling) methodScore += 15;
    else methodNotes.push("Sampling / participants need clearer justification");
    if (hasLimits) methodScore += 15;
    else methodNotes.push("Add methodological limitations");
    if (hasDesign && hasSampling && hasLimits) {
      methodNotes.push("Core methodology elements appear present");
    }
  } else {
    methodNotes.push("Methodology depth is secondary for this chapter type");
    methodScore = 68;
  }

  // Research gap
  let gapScore = 50;
  const gapNotes: string[] = [];
  const gapExplicit =
    /\b(research gap|knowledge gap|gap in (?:the )?literature|this study (?:addresses|fills|seeks to)|contribution (?:is|of this))\b/i.test(
      plain,
    );
  if (gapExplicit) {
    gapScore = 78;
    gapNotes.push("Explicit gap / contribution framing detected");
  } else if (chapterNumber <= 2) {
    gapScore = 38;
    gapNotes.push("State the research gap more explicitly");
  } else {
    gapScore = 55;
    gapNotes.push("Gap framing is lighter outside intro/lit-review chapters");
  }

  if (lower.includes("delve") || lower.includes("tapestry")) {
    notes.push("Watch for generic AI phrasing that weakens academic voice");
  }

  return {
    criticalThinkingScore,
    methodology: { score: clamp(methodScore), notes: methodNotes.slice(0, 4) },
    literatureReview: { score: clamp(litScore), notes: litNotes.slice(0, 4) },
    researchGap: { score: clamp(gapScore), notes: gapNotes.slice(0, 4) },
    notes: notes.slice(0, 5),
  };
}

/** Stage 6 — risks (AI tone, overclaiming). No fake similarity %. */
export function assessChapterRisks(text: string): RiskAssessmentResult {
  const plain = text.replace(/\s+/g, " ").trim();
  const aiContent = estimateAiGeneratedContent(plain);
  const risks: string[] = [];

  const overclaimMatches =
    plain.match(
      /\b(proves?|undeniabl[ye]|always|never|all scholars|completely|without doubt|irrefutable|the only)\b/gi,
    ) || [];
  const overclaimSignals = overclaimMatches.length;

  if (aiContent.detected) {
    risks.push(
      `Possible AI-assisted writing (≈${aiContent.percent}% stylistic signal)`,
    );
  }
  if (overclaimSignals >= 3) {
    risks.push("Absolute / overclaiming language — prefer cautious academic hedging");
  }
  if (
    plain.split(/\s+/).length >= 200 &&
    !/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./i.test(plain)
  ) {
    risks.push("Academic integrity risk: polished prose without citations");
  }

  // Light repetition hook (same 6-word window twice)
  const tokens = plain.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length >= 80) {
    const windows = new Map<string, number>();
    for (let i = 0; i < tokens.length - 5; i++) {
      const key = tokens.slice(i, i + 6).join(" ");
      windows.set(key, (windows.get(key) || 0) + 1);
    }
    let repeats = 0;
    for (const n of windows.values()) {
      if (n >= 3) repeats += 1;
    }
    if (repeats >= 2) {
      risks.push(
        "Repetitive phrasing detected — check for copy-paste / integrity issues",
      );
    }
  }

  if (risks.length === 0) {
    risks.push("No high-severity integrity risks flagged by local heuristics");
  }

  return {
    risks: risks.slice(0, 6),
    overclaimSignals,
    aiContent,
  };
}

function synthesizeChapterFeedback(opts: {
  context: ChapterReviewContext;
  normalize: NormalizedSubmission;
  structure: StructureCompletenessResult;
  alignment: ChapterPipelineStages["alignment"];
  evidence: EvidenceCitationsResult;
  academic: AcademicDepthResult;
  risks: RiskAssessmentResult;
  areaScores: AreaScores;
}): ChapterFeedbackSynthesis {
  const { context, structure, alignment, evidence, academic, risks, areaScores } =
    opts;
  void (context.topic || "(topic not set)");
  const weaknesses: string[] = [];
  const strengths: string[] = [];
  const researchGaps: string[] = [];
  const revisionPriorities: string[] = [];
  const writingSuggestions: string[] = [];

  if (structure.wordCount < 80) {
    weaknesses.push("Insufficient chapter content for a rigorous academic review");
  }
  if (structure.missingSections.length > 0) {
    weaknesses.push(
      `Under-developed structure — missing cues for: ${structure.missingSections.slice(0, 3).join(", ")}`,
    );
  }
  if (evidence.citationCount === 0 && structure.wordCount >= 80) {
    weaknesses.push("Limited or missing in-text citations");
  }
  if (evidence.uncitedClaimSignals >= 2) {
    weaknesses.push("Several claim-like sentences lack in-text citations");
  }
  if (academic.criticalThinkingScore < 55) {
    weaknesses.push("Limited critical engagement with literature or evidence");
  }
  if (academic.methodology.score < 55 && context.chapterNumber === 3) {
    weaknesses.push("Methodology justification is underdeveloped");
  }
  if (academic.literatureReview.score < 55 && context.chapterNumber === 2) {
    weaknesses.push("Literature review needs stronger thematic synthesis");
  }
  if (weaknesses.length === 0) {
    weaknesses.push("Argument structure and evidence could still be tightened");
  }

  if (structure.wordCount >= structure.expectedMinWords * 0.6) {
    strengths.push("Adequate length for chapter-level review");
  }
  if ((alignment.score ?? 0) >= 65) {
    strengths.push("Chapter stays recognisably on the project topic");
  }
  if (evidence.citationCount >= 3) {
    strengths.push("In-text citation practice is underway");
  }
  if (academic.criticalThinkingScore >= 70) {
    strengths.push("Critical / comparative language is present");
  }
  if (strengths.length === 0) {
    strengths.push("Draft is organised enough to support targeted feedback");
  }

  for (const n of academic.researchGap.notes) {
    if (/not stated|unclear|missing|need|should|more explicit/i.test(n)) {
      researchGaps.push(n);
    }
  }
  if (context.topic) {
    researchGaps.push(
      `Make the contribution relative to “${context.topic.slice(0, 100)}” more explicit`,
    );
  }
  if (context.chapterNumber <= 2) {
    researchGaps.push(
      "Clarify what prior studies leave unresolved that this work addresses",
    );
  }
  if (researchGaps.length < 3) {
    researchGaps.push("Deepen the link between evidence and the stated research problem");
  }

  // Priorities: worst dimensions first (topic alignment excluded from review)
  const dims: Array<{ label: string; score: number; action: string }> = [
    {
      label: "structure",
      score: structure.score,
      action:
        structure.missingSections.length > 0
          ? `Add clearer ${structure.missingSections[0]} framing for chapter ${context.chapterNumber}`
          : "Strengthen section headings and transitions",
    },
    {
      label: "citations",
      score: evidence.score,
      action: "Add in-text citations to claim sentences and align the reference list",
    },
    {
      label: "critical",
      score: academic.criticalThinkingScore,
      action: "Replace summary with critique, comparison, and justified stance",
    },
    {
      label: "gap",
      score: academic.researchGap.score,
      action: "State the research gap and contribution in one explicit paragraph",
    },
  ];
  if (context.chapterNumber === 3) {
    dims.push({
      label: "method",
      score: academic.methodology.score,
      action: "Justify design, sampling, and limitations more clearly",
    });
  }
  dims
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .forEach((d) => revisionPriorities.push(d.action));

  writingSuggestions.push("Open paragraphs with a clear topic sentence");
  writingSuggestions.push("Use cautious hedging instead of absolute claims");
  if (evidence.uncitedClaimSignals > 0) {
    writingSuggestions.push(
      "Attach (Author, Year) or [n] citations to every factual claim",
    );
  }

  const overall = areaScores.overall;
  const decisionLean: "approve" | "request_revision" =
    overall >= 72 &&
    structure.wordCount >= 120 &&
    areaScores.weaknesses < 55
      ? "approve"
      : "request_revision";

  const estimatedGrade = letterFromPercent(overall);
  const supervisorRecommendation =
    decisionLean === "approve"
      ? `Lean toward approval after a light pass on: ${revisionPriorities.slice(0, 2).join("; ") || "minor polish"}.`
      : `Request revision. Priority fixes: ${revisionPriorities.slice(0, 3).join("; ")}.`;

  const executiveSummary = `This review of “${context.chapterTitle}” (chapter ${context.chapterNumber}) considers structure, research gaps, critical engagement, and citation practice. ${
    decisionLean === "request_revision"
      ? "Revision is advised before approval."
      : "Near ready for supervisor approval with light edits."
  }`;

  const remarksParts = [
    executiveSummary,
    revisionPriorities.length
      ? `Priority revisions: ${revisionPriorities.slice(0, 4).join("; ")}.`
      : "",
    weaknesses.slice(0, 3).length
      ? `Key weaknesses: ${weaknesses.slice(0, 3).join("; ")}.`
      : "",
    evidence.uncitedClaimSignals > 0
      ? `${evidence.uncitedClaimSignals} passage(s) flagged for missing in-text citations.`
      : "",
    risks.aiContent.detected
      ? `AI-writing signal ≈ ${risks.aiContent.percent}%.`
      : "",
  ].filter(Boolean);

  const avgSentence =
    structure.wordCount /
    Math.max(
      1,
      opts.normalize.plainText.split(/(?<=[.!?])\s+/).filter((s) => s.trim())
        .length,
    );
  const readabilityScore = clamp(
    88 - Math.max(0, avgSentence - 28) * 2 - (structure.wordCount < 80 ? 30 : 0),
  );

  return {
    executiveSummary,
    remarksSummary: remarksParts.join(" "),
    strengths: strengths.slice(0, 6),
    weaknesses: weaknesses.slice(0, 8),
    researchGaps: researchGaps.slice(0, 6),
    revisionPriorities: revisionPriorities.slice(0, 5),
    writingSuggestions: writingSuggestions.slice(0, 6),
    supervisorRecommendation,
    decisionLean,
    estimatedGrade,
    readabilityScore,
  };
}

/**
 * Full local chapter review pipeline (deterministic; no API key required).
 */
export function runChapterReviewPipeline(opts: {
  htmlOrText: string;
  project: {
    title?: string;
    topic?: string;
    abstract?: string;
  };
  chapter: {
    title?: string;
    number?: number;
  };
}): ChapterReviewPipelineResult {
  const context: ChapterReviewContext = {
    projectTitle: String(opts.project.title || "").trim(),
    topic: String(opts.project.topic || "").trim(),
    chapterTitle: String(opts.chapter.title || "Chapter").trim(),
    chapterNumber: Number(opts.chapter.number) || 1,
    abstract: String(opts.project.abstract || "").trim() || undefined,
  };

  const normalize = normalizeSubmission(opts.htmlOrText, 12000);
  const text = normalize.plainText;

  const structure = assessStructureCompleteness(
    text,
    context.chapterNumber,
    context.chapterTitle,
  );

  const baseAlignment = assessTopicAlignment(
    text,
    context.topic || context.projectTitle,
  );
  // Lightweight RQ / objectives / hypothesis proxies from keyword presence
  const rqScore = /\bresearch questions?\b|\bRQs?\b|\bhypothes/i.test(text)
    ? clamp(baseAlignment.score + 5)
    : clamp(baseAlignment.score - 15);
  const objScore = /\bobjectives?\b|\baim(s)? of (?:this|the) (?:study|chapter|research)\b/i.test(
    text,
  )
    ? clamp(baseAlignment.score + 3)
    : clamp(baseAlignment.score - 10);
  const hypScore = /\bhypothes[ei]s\b|\bnull hypothesis\b/i.test(text)
    ? clamp(baseAlignment.score)
    : clamp(Math.min(baseAlignment.score, 55));

  const alignment: ChapterPipelineStages["alignment"] = {
    ...baseAlignment,
    researchQuestions: rqScore,
    objectives: objScore,
    hypothesis: hypScore,
  };

  const evidence = assessEvidenceCitations(text);
  const academic = assessAcademicDepth(text, context.chapterNumber);
  const risks = assessChapterRisks(text);

  const heuristic = computeAreaScores(text);
  const overall = clamp(
    heuristic.overall * 0.35 +
      structure.score * 0.15 +
      alignment.score * 0.2 +
      evidence.score * 0.15 +
      academic.criticalThinkingScore * 0.15,
  );
  const weaknessesSeverity = clamp(
    heuristic.weaknesses * 0.5 +
      (100 - evidence.score) * 0.25 +
      (100 - alignment.score) * 0.25,
  );
  const areaScores: AreaScores = {
    strengths: clamp(100 - weaknessesSeverity * 0.7 + heuristic.strengths * 0.3),
    weaknesses: weaknessesSeverity,
    overall,
  };

  const feedback = synthesizeChapterFeedback({
    context,
    normalize,
    structure,
    alignment,
    evidence,
    academic,
    risks,
    areaScores,
  });

  const localQuotes = pickFallbackHighlightQuotes(text);
  const highlightQuotes: ReviewTextHighlights = {
    strengths: localQuotes.strengths || [],
    weaknesses: localQuotes.weaknesses || [],
    citations:
      evidence.citationQuotes.length > 0
        ? evidence.citationQuotes
        : localQuotes.citations || [],
    wrongClaims: localQuotes.wrongClaims || [],
  };

  const baseResult: ChapterReviewPipelineResult = {
    stages: {
      normalize,
      structure,
      alignment,
      evidence,
      academic,
      risks,
      feedback,
    },
    areaScores,
    highlightQuotes,
    researchGaps: feedback.researchGaps,
    revisionPriorities: feedback.revisionPriorities,
    remarksSummary: feedback.remarksSummary,
    executiveSummary: feedback.executiveSummary,
    strengths: feedback.strengths,
    weaknesses: feedback.weaknesses,
    supervisorRecommendation: feedback.supervisorRecommendation,
    estimatedGrade: feedback.estimatedGrade,
    decisionLean: feedback.decisionLean,
    writingSuggestions: feedback.writingSuggestions,
    readabilityScore: feedback.readabilityScore,
    criticalThinkingScore: academic.criticalThinkingScore,
    aiContent: risks.aiContent,
    projectTopic: context.topic,
    chapterTitle: context.chapterTitle,
    topicAlignment: {
      topic: context.topic || null,
      score: context.topic ? alignment.score : null,
      notes: alignment.notes,
    },
    correctionFindings: [],
    correctionSummary: "",
    reviewerReport: "",
  };

  const built = buildCorrectionFindings(baseResult);
  return {
    ...baseResult,
    correctionFindings: built.findings,
    correctionSummary: built.reviewerReport,
    reviewerReport: built.reviewerReport,
    remarksSummary: built.reviewerReport || feedback.remarksSummary,
  };
}

/** Map pipeline output into the full auto-review AiFeedbackReport shape. */
export function pipelineToAiFeedbackReport(
  pipeline: ChapterReviewPipelineResult,
  sourceHint?: string,
): {
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
} {
  const citeScore = pipeline.stages.evidence.score;
  const citeIssues = pipeline.stages.evidence.notes;
  return {
    executiveSummary: pipeline.executiveSummary,
    strengths: pipeline.strengths,
    weaknesses: pipeline.weaknesses,
    grammar: {
      score: clamp(pipeline.readabilityScore),
      issues:
        pipeline.readabilityScore < 60
          ? ["Long or unclear sentences reduce readability"]
          : [],
    },
    academicWriting: {
      score: clamp(pipeline.areaScores.overall),
      notes: pipeline.writingSuggestions.slice(0, 3),
    },
    criticalThinkingScore: pipeline.criticalThinkingScore,
    citations: {
      apa7: { score: citeScore, issues: citeIssues },
      harvard: { score: citeScore, issues: citeIssues },
      ieee: { score: citeScore, issues: citeIssues },
    },
    referenceValidation: {
      score: citeScore,
      issues: citeIssues,
    },
    researchGap: pipeline.stages.academic.researchGap,
    methodology: pipeline.stages.academic.methodology,
    literatureReview: pipeline.stages.academic.literatureReview,
    alignment: {
      topic: pipeline.stages.alignment.score,
      researchQuestions: pipeline.stages.alignment.researchQuestions,
      objectives: pipeline.stages.alignment.objectives,
      hypothesis: pipeline.stages.alignment.hypothesis,
    },
    consistency: {
      score: clamp(pipeline.areaScores.overall),
      issues: [],
    },
    completeness: {
      score: pipeline.stages.structure.score,
      notes: pipeline.stages.structure.notes,
    },
    missingSections: pipeline.stages.structure.missingSections,
    readabilityScore: pipeline.readabilityScore,
    similarityScore: undefined,
    writingSuggestions: pipeline.writingSuggestions,
    supervisorRecommendation: pipeline.supervisorRecommendation,
    estimatedGrade: pipeline.estimatedGrade,
    risks: [
      ...pipeline.stages.risks.risks,
      ...(sourceHint ? [sourceHint] : []),
    ],
  };
}
