/**
 * Assignment AI grading against lecturer brief:
 * instructions, must-include items, rubric, word count, and quality.
 */

export type AiContentDetection = {
  /** Estimated share of the submission that appears AI-generated (0–100). */
  percent: number;
  detected: boolean;
  signals: string[];
};

export type RequirementCheck = {
  item: string;
  met: boolean;
  note: string;
};

export type RubricCriterionScore = {
  name: string;
  score: number;
  maxMarks: number;
  comment: string;
};

/** Diagnostic academic quality dimensions (0–100), used across all assignment types. */
export type AcademicQualityCheck = {
  name: string;
  score: number;
  comment: string;
};

export type BriefGradeResult = {
  /** Suggested total mark out of maxScore. */
  aiSuggestedScore: number;
  maxScore: number;
  /** 0–100 quality after brief penalties (used for areaScores.overall). */
  overallQuality: number;
  /** 0–100 issue severity. */
  weaknessSeverity: number;
  requirementChecks: RequirementCheck[];
  requirementsMetCount: number;
  requirementsTotal: number;
  criterionScores: RubricCriterionScore[];
  /** Universal academic diagnostics (not always part of the official rubric total). */
  qualityChecks: AcademicQualityCheck[];
  weaknesses: string[];
  estimatedGrade: string;
  wordCount: number;
};

/** Default official rubric when the brief has none — balanced for any discipline. */
export function defaultAssignmentRubric(
  maxScore: number,
): Array<{ name: string; maxMarks: number }> {
  const max = maxScore > 0 ? maxScore : 100;
  const parts = [
    { name: "Task / brief compliance", share: 0.1 },
    { name: "Content accuracy & subject knowledge", share: 0.2 },
    { name: "Argument / thesis clarity", share: 0.15 },
    { name: "Critical thinking & analysis", share: 0.15 },
    { name: "Organisation & coherence", share: 0.1 },
    { name: "Evidence & examples", share: 0.1 },
    { name: "Referencing & academic integrity", share: 0.1 },
    { name: "Academic style & language accuracy", share: 0.1 },
  ];
  const rows = parts.map((p) => ({
    name: p.name,
    maxMarks: Math.round(max * p.share),
  }));
  const sum = rows.reduce((s, r) => s + r.maxMarks, 0);
  const drift = max - sum;
  if (drift !== 0 && rows.length > 0) {
    rows[1].maxMarks = Math.max(1, rows[1].maxMarks + drift);
  }
  return rows;
}

const AI_BUZZWORDS =
  /\b(delve|tapestry|landscape|pivotal|underscore|underscore[sd]?|realm|moreover|furthermore|in conclusion|it is (?:important|crucial|essential) to note|in today's (?:world|society)|plays? a (?:crucial|vital|significant) role|multifaceted|holistic|paradigm|leverage|synergy|cutting-edge|robust framework|comprehensive (?:overview|analysis))\b/gi;

const PERSONAL_VOICE =
  /\b(I |my |we |our |me |myself|in my (?:view|opinion|experience)|I (?:argue|believe|found|observed|conducted))\b/gi;

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Round an AI suggested mark up to a whole number (no decimals).
 * Caps at maxScore; non-finite / negative → 0.
 */
export function ceilAiScore(score: number, maxScore: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0;
  const max = maxScore > 0 ? maxScore : 100;
  return Math.min(max, Math.ceil(score));
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/**
 * Lightweight AI-writing likelihood estimate from stylistic signals.
 */
export function estimateAiGeneratedContent(text: string): AiContentDetection {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length < 40) {
    return {
      percent: 0,
      detected: false,
      signals: ["Insufficient text to assess AI likelihood"],
    };
  }

  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const words = plain.split(/\s+/).filter(Boolean);
  const count = words.length;

  let score = 18;
  const signals: string[] = [];

  const buzzMatches = plain.match(AI_BUZZWORDS) || [];
  if (buzzMatches.length >= 2) {
    score += Math.min(28, buzzMatches.length * 5);
    signals.push(`Common AI phrasing (${buzzMatches.length} hits)`);
  }

  const personal = plain.match(PERSONAL_VOICE) || [];
  if (count >= 120 && personal.length === 0) {
    score += 14;
    signals.push("Little or no personal academic voice");
  } else if (personal.length >= 3) {
    score -= 10;
  }

  if (sentences.length >= 4) {
    const lengths = sentences.map((s) => s.split(/\s+/).length);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance =
      lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
    const std = Math.sqrt(variance);
    if (std < 4.5 && mean >= 14 && mean <= 28) {
      score += 16;
      signals.push("Very uniform sentence length (low burstiness)");
    } else if (std > 10) {
      score -= 6;
    }
  }

  const transitionHits = (
    plain.match(
      /\b(furthermore|moreover|additionally|consequently|thus|hence|in summary|to summarise|to summarize)\b/gi,
    ) || []
  ).length;
  if (transitionHits >= 3) {
    score += 10;
    signals.push("Heavy use of formal transition markers");
  }

  const citationHits = (
    plain.match(/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./gi) || []
  ).length;
  if (count >= 200 && citationHits === 0 && score >= 40) {
    score += 8;
    signals.push("Polished prose without in-text citations");
  }

  const percent = clamp(score);
  const detected = percent >= 45;
  if (signals.length === 0) {
    signals.push(
      detected
        ? "Stylistic patterns consistent with AI-assisted writing"
        : "No strong AI-writing signals detected",
    );
  }

  return { percent, detected, signals };
}

/**
 * Check whether a must-include item appears to be addressed in the submission.
 * Conservative: short / rubbish work fails most items.
 */
export function checkRequiredItem(
  text: string,
  item: string,
): RequirementCheck {
  const plain = text.replace(/\s+/g, " ").trim();
  const count = wordCount(plain);
  const itemLower = item.toLowerCase();

  if (count < 40) {
    return {
      item,
      met: false,
      note: "Submission too short to satisfy this requirement",
    };
  }

  // Structural heuristics keyed off common brief wording
  if (/introduction|thesis|main argument/.test(itemLower)) {
    const met =
      count >= 120 &&
      (/introduction|this essay|this paper|this assignment|argues that|the purpose of/i.test(
        plain,
      ) ||
        plain.split(/(?<=[.!?])\s+/).length >= 4);
    return {
      item,
      met,
      note: met
        ? "Opening frames a purpose or argument"
        : "No clear introduction / thesis found",
    };
  }

  if (/body paragraph|three|developed/.test(itemLower)) {
    const paragraphs = plain.split(/\n+/).filter((p) => p.trim().length > 40);
    const sentences = plain.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
    const met = paragraphs.length >= 3 || sentences.length >= 8;
    return {
      item,
      met,
      note: met
        ? "Enough development for multiple body points"
        : "Body is underdeveloped — fewer than three clear points",
    };
  }

  if (/conclusion|recommendation/.test(itemLower)) {
    const met =
      /\b(in conclusion|to conclude|therefore|overall|in summary|recommend|students should)\b/i.test(
        plain,
      ) && count >= 100;
    return {
      item,
      met,
      note: met
        ? "Closing / recommendation language present"
        : "Missing a clear conclusion or practical recommendation",
    };
  }

  if (/reference|citation|apa|harvard|source/.test(itemLower)) {
    const cites = (
      plain.match(/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\.|https?:\/\//gi) ||
      []
    ).length;
    const met = cites >= 2 || /\breferences?\b/i.test(plain);
    return {
      item,
      met,
      note: met
        ? "Some referencing signals found"
        : "Fewer than two academic references / citations",
    };
  }

  if (/formal|tone|academic|word/.test(itemLower)) {
    const slang =
      /\b(lol|lmao|gonna|wanna|u |ur |idk|omg|yeah|bro|stuff|thingy)\b/i.test(
        plain,
      );
    const met = count >= 200 && !slang;
    return {
      item,
      met,
      note: met
        ? "Length and tone look broadly academic"
        : slang
          ? "Informal language present"
          : "Too short / thin for formal academic tone requirement",
    };
  }

  // Generic keyword overlap for other must-include lines
  const itemTokens = tokenize(item).filter(
    (t) =>
      ![
        "with",
        "clear",
        "least",
        "must",
        "include",
        "throughout",
        "students",
        "year",
      ].includes(t),
  );
  const textSet = new Set(tokenize(plain));
  let hits = 0;
  for (const t of itemTokens) {
    if (textSet.has(t)) hits += 1;
  }
  const coverage = itemTokens.length === 0 ? 0 : hits / itemTokens.length;
  const met = count >= 150 && coverage >= 0.35;
  return {
    item,
    met,
    note: met
      ? "Submission touches this requirement"
      : "Little evidence this must-include item was addressed",
  };
}

function letterFromPercent(pct: number): string {
  if (pct >= 70) return "A";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  if (pct >= 30) return "E";
  return "F";
}

/**
 * Universal academic quality diagnostics (0–100) for any discipline / brief.
 * These complement the official rubric; they do not replace lecturer max marks.
 */
export function buildAcademicQualityChecks(opts: {
  text: string;
  wordCount: number;
  requirementRatio: number;
  weaknessSeverity: number;
  overallQuality: number;
  aiGeneratedPercent: number;
  criterionScores?: RubricCriterionScore[];
}): AcademicQualityCheck[] {
  const plain = opts.text.replace(/\s+/g, " ").trim();
  const hasEvidence =
    /\b(for example|for instance|such as|according to|evidence|studies?|data|findings)\b/i.test(
      plain,
    );
  const hasAnalysis =
    /\b(however|therefore|whereas|in contrast|this (?:suggests|implies|indicates)|argue|critique|evaluate|nevertheless)\b/i.test(
      plain,
    );
  const cites = (
    plain.match(/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./gi) || []
  ).length;
  const fromCriterion = (pattern: RegExp, fallback: number) => {
    const hit = (opts.criterionScores || []).find((c) =>
      pattern.test(c.name.toLowerCase()),
    );
    if (!hit || hit.maxMarks <= 0) return fallback;
    return clamp((hit.score / hit.maxMarks) * 100);
  };

  const task = clamp(
    opts.requirementRatio * 70 + opts.overallQuality * 0.3,
  );
  const content = fromCriterion(
    /content|subject|knowledge|argument/,
    opts.overallQuality,
  );
  const thesis = fromCriterion(
    /thesis|argument|clarity/,
    clamp(opts.overallQuality * (hasAnalysis ? 1 : 0.75)),
  );
  const critical = clamp(
    fromCriterion(/critical|analysis|thinking/, opts.overallQuality) *
      (hasAnalysis ? 1 : 0.55),
  );
  const organisation = fromCriterion(
    /organis|organiz|coherence/,
    opts.wordCount >= 200 ? clamp(opts.overallQuality) : 35,
  );
  const evidence = fromCriterion(
    /evidence|example/,
    hasEvidence ? clamp(opts.overallQuality * 0.9) : 28,
  );
  const referencing = fromCriterion(
    /referenc|citation|integrity/,
    cites >= 2 ? 72 : cites === 1 ? 42 : 18,
  );
  const language = fromCriterion(
    /language|grammar|style|accuracy/,
    clamp(100 - opts.weaknessSeverity * 0.85),
  );
  const originality = clamp(
    100 -
      Math.max(0, opts.aiGeneratedPercent - 25) * 0.9 -
      (opts.aiGeneratedPercent >= 70 ? 20 : 0),
  );
  const completeness = clamp(
    opts.wordCount < 80
      ? 15
      : opts.requirementRatio * 55 + Math.min(40, opts.wordCount / 25),
  );

  const mk = (name: string, score: number, low: string, mid: string, high: string) => ({
    name,
    score,
    comment: score < 40 ? low : score < 70 ? mid : high,
  });

  return [
    mk(
      "Task / brief compliance",
      task,
      "Limited evidence of addressing the set task",
      "Partially addresses the set task",
      "Clearly addresses the set task",
    ),
    mk(
      "Content accuracy & subject knowledge",
      content,
      "Subject knowledge is thin or insecure",
      "Adequate subject knowledge with gaps",
      "Sound subject knowledge for the level",
    ),
    mk(
      "Argument / thesis clarity",
      thesis,
      "Thesis or main claim is unclear",
      "Argument present but unevenly developed",
      "Clear and sustained main argument",
    ),
    mk(
      "Critical thinking & analysis",
      critical,
      "Mostly descriptive; little critical analysis",
      "Some analysis but limited depth",
      "Clear critical engagement with ideas",
    ),
    mk(
      "Organisation & coherence",
      organisation,
      "Structure and paragraphing need substantial work",
      "Organisation is uneven; improve flow between points",
      "Generally coherent structure and progression",
    ),
    mk(
      "Evidence & examples",
      evidence,
      "Claims lack supporting examples or evidence",
      "Some evidence used; more support needed",
      "Evidence and examples support key claims",
    ),
    mk(
      "Use of sources / referencing",
      referencing,
      "Referencing is missing or inadequate",
      "Some referencing present; consistency needed",
      "Referencing supports academic integrity",
    ),
    mk(
      "Academic style & language accuracy",
      language,
      "Language and academic register impede clarity",
      "Language is workable but accuracy needs attention",
      "Language is largely clear and appropriately formal",
    ),
    mk(
      "Originality / academic integrity signals",
      originality,
      "Strong AI-like or integrity risk signals — review carefully",
      "Some integrity risk signals; verify authorship",
      "No strong adverse integrity signals from style alone",
    ),
    mk(
      "Completeness vs required deliverables",
      completeness,
      "Incomplete relative to expected length or deliverables",
      "Partly complete; some deliverables underdeveloped",
      "Length and coverage are broadly appropriate",
    ),
  ];
}

/**
 * Grade a submission using the lecturer brief (instructions context via
 * required items + word limits + optional rubric). Strict on missing must-includes.
 */
export function gradeAgainstBrief(opts: {
  text: string;
  maxScore: number;
  requiredItems?: string[];
  rubric?: Array<{ name: string; maxMarks: number }>;
  wordCountMin?: number | null;
  wordCountMax?: number | null;
  /** Existing heuristic quality 0–100 (optional). */
  baseOverall?: number;
  weaknessSeverity?: number;
  aiGeneratedPercent?: number;
}): BriefGradeResult {
  const plain = opts.text.replace(/\s+/g, " ").trim();
  const count = wordCount(plain);
  const maxScore = opts.maxScore > 0 ? opts.maxScore : 100;
  const requiredItems = (opts.requiredItems || [])
    .map((i) => i.trim())
    .filter(Boolean);

  const requirementChecks = requiredItems.map((item) =>
    checkRequiredItem(plain, item),
  );
  const requirementsMetCount = requirementChecks.filter((c) => c.met).length;
  const requirementsTotal = requirementChecks.length;
  const requirementRatio =
    requirementsTotal === 0 ? 0.5 : requirementsMetCount / requirementsTotal;

  // Word-count compliance vs brief
  let wordScoreFactor = 1;
  const min = opts.wordCountMin ?? null;
  const max = opts.wordCountMax ?? null;
  if (min != null && count < min) {
    // Linear penalty: half length → ~0.25 factor floor
    wordScoreFactor = Math.max(0.15, count / min);
  } else if (max != null && count > max * 1.25) {
    wordScoreFactor = 0.85;
  }

  // Base quality — do not inflate rubbish
  let quality =
    typeof opts.baseOverall === "number" ? clamp(opts.baseOverall) / 100 : 0.45;
  const weakness =
    typeof opts.weaknessSeverity === "number"
      ? clamp(opts.weaknessSeverity)
      : 50;

  // High weakness severity must crush the mark
  quality *= Math.max(0.05, 1 - weakness / 110);

  // Must-include completion dominates
  if (requirementsTotal > 0) {
    // 0 met → hard fail band; all met → full credit for this factor
    quality *= 0.15 + requirementRatio * 0.85;
  }

  quality *= wordScoreFactor;

  const aiPct = opts.aiGeneratedPercent ?? 0;
  if (aiPct >= 70) quality *= 0.7;
  else if (aiPct >= 45) quality *= 0.85;

  // Absolute caps for clearly inadequate work
  if (count < 80) quality = Math.min(quality, 0.18);
  else if (count < 200 && min != null && min >= 500)
    quality = Math.min(quality, 0.28);
  if (requirementsTotal > 0 && requirementsMetCount === 0)
    quality = Math.min(quality, 0.22);
  else if (requirementsTotal > 0 && requirementRatio < 0.4)
    quality = Math.min(quality, 0.35);
  if (weakness >= 75) quality = Math.min(quality, 0.32);
  if (weakness >= 85) quality = Math.min(quality, 0.22);

  quality = Math.max(0.05, Math.min(0.95, quality));
  const aiSuggestedScore =
    Math.round(quality * maxScore * 10) / 10;

  // Build criterion scores from rubric (or a default academic rubric)
  const rubric =
    opts.rubric && opts.rubric.length > 0
      ? opts.rubric
      : defaultAssignmentRubric(maxScore);

  // Distribute mark across criteria with per-criterion adjustments
  let criterionScores: RubricCriterionScore[] = rubric.map((row) => {
    let factor = quality;
    const nameLower = row.name.toLowerCase();
    if (/task|brief|compliance/.test(nameLower)) {
      factor *= 0.55 + requirementRatio * 0.45;
    }
    if (/content|argument|subject|knowledge|thesis/.test(nameLower)) {
      factor *= 0.7 + requirementRatio * 0.3;
    }
    if (/critical|analysis|thinking/.test(nameLower)) {
      const hasAnalysis =
        /\b(however|therefore|whereas|in contrast|this (?:suggests|implies|indicates)|argue|critique|evaluate)\b/i.test(
          plain,
        );
      factor *= hasAnalysis ? 0.85 : 0.45;
    }
    if (/organis|organiz|coherence/.test(nameLower)) {
      factor *= count >= 200 ? 0.9 : 0.45;
    }
    if (/language|grammar|vocab|accuracy|style|academic style/.test(nameLower)) {
      factor *= weakness >= 70 ? 0.4 : weakness >= 50 ? 0.65 : 0.9;
    }
    if (/example|evidence/.test(nameLower)) {
      const hasEvidence =
        /\b(for example|for instance|such as|according to|evidence|studies?)\b/i.test(
          plain,
        );
      factor *= hasEvidence ? 0.85 : 0.35;
    }
    if (/referenc|citation|integrity/.test(nameLower)) {
      const cites = (
        plain.match(/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./gi) || []
      ).length;
      factor *= cites >= 2 ? 0.9 : cites === 1 ? 0.45 : 0.15;
    }
    const score =
      Math.round(Math.max(0, Math.min(row.maxMarks, factor * row.maxMarks)) * 10) /
      10;
    return {
      name: row.name,
      score,
      maxMarks: row.maxMarks,
      comment:
        score / row.maxMarks < 0.4
          ? "Does not meet brief expectations for this criterion"
          : score / row.maxMarks < 0.7
            ? "Partially meets the brief"
            : "Mostly meets the brief for this criterion",
    };
  });

  // Prefer rubric total when available (keeps AI mark consistent with criteria)
  const rubricTotal = criterionScores.reduce((s, c) => s + c.score, 0);
  const rubricMax = criterionScores.reduce((s, c) => s + c.maxMarks, 0);
  let finalScore = aiSuggestedScore;
  if (rubricMax > 0) {
    finalScore =
      Math.round((rubricTotal / rubricMax) * maxScore * 10) / 10;
  }

  // Re-apply hard caps after rubric aggregation
  if (count < 80) finalScore = Math.min(finalScore, maxScore * 0.18);
  if (requirementsTotal > 0 && requirementsMetCount === 0)
    finalScore = Math.min(finalScore, maxScore * 0.22);
  if (requirementsTotal > 0 && requirementRatio < 0.4)
    finalScore = Math.min(finalScore, maxScore * 0.35);
  if (weakness >= 85) finalScore = Math.min(finalScore, maxScore * 0.22);
  else if (weakness >= 75) finalScore = Math.min(finalScore, maxScore * 0.32);
  if (min != null && count < min * 0.35)
    finalScore = Math.min(finalScore, maxScore * 0.25);

  finalScore = ceilAiScore(finalScore, maxScore);

  // Keep criterion scores; lightly rescale so they track finalScore proportionally
  if (rubricMax > 0 && rubricTotal > 0) {
    const targetTotal = (finalScore / maxScore) * rubricMax;
    const scale = targetTotal / rubricTotal;
    criterionScores = criterionScores.map((c) => ({
      ...c,
      score: Math.min(c.maxMarks, Math.ceil(c.score * scale)),
    }));
  }

  const scoredOverall = clamp((finalScore / maxScore) * 100);
  const qualityChecks = buildAcademicQualityChecks({
    text: plain,
    wordCount: count,
    requirementRatio,
    weaknessSeverity: weakness,
    overallQuality: scoredOverall,
    aiGeneratedPercent: aiPct,
    criterionScores,
  });

  const weaknesses: string[] = [];
  if (min != null && count < min) {
    weaknesses.push(
      `Word count ${count} is below the required minimum of ${min}`,
    );
  }
  for (const check of requirementChecks) {
    if (!check.met) weaknesses.push(`Must include not met: ${check.item}`);
  }
  if (weakness >= 60) {
    weaknesses.push("High weakness severity — analysis, clarity, or evidence is poor");
  }
  if (count < 80) {
    weaknesses.push("Submission is far too short for a graded academic essay");
  }
  for (const q of qualityChecks) {
    if (q.score < 40) weaknesses.push(`${q.name}: ${q.comment}`);
  }
  if (weaknesses.length === 0) {
    weaknesses.push("Limited depth relative to the assignment brief");
  }

  const pct = (finalScore / maxScore) * 100;

  return {
    aiSuggestedScore: finalScore,
    maxScore,
    overallQuality: scoredOverall,
    weaknessSeverity: weakness,
    requirementChecks,
    requirementsMetCount,
    requirementsTotal,
    criterionScores,
    qualityChecks,
    weaknesses: weaknesses.slice(0, 10),
    estimatedGrade: letterFromPercent(pct),
    wordCount: count,
  };
}

/** @deprecated Use gradeAgainstBrief — kept for call-site compatibility. */
export function suggestAssignmentScore(opts: {
  overall: number;
  aiGeneratedPercent: number;
  maxScore: number;
  weaknessSeverity?: number;
  requiredItems?: string[];
  text?: string;
  wordCountMin?: number | null;
  wordCountMax?: number | null;
  rubric?: Array<{ name: string; maxMarks: number }>;
}): number {
  return gradeAgainstBrief({
    text: opts.text || "",
    maxScore: opts.maxScore,
    requiredItems: opts.requiredItems,
    rubric: opts.rubric,
    wordCountMin: opts.wordCountMin,
    wordCountMax: opts.wordCountMax,
    baseOverall: opts.overall,
    weaknessSeverity: opts.weaknessSeverity,
    aiGeneratedPercent: opts.aiGeneratedPercent,
  }).aiSuggestedScore;
}

/* -------------------------------------------------------------------------- */
/* Agent pipeline — distinct stages for assignment AI review                   */
/* -------------------------------------------------------------------------- */

export type AssignmentBriefContext = {
  title: string;
  instructions: string;
  /** Lecturer topic: project topic, or brief title as fallback. */
  topic: string;
  requiredItems: string[];
  rubric: Array<{ name: string; maxMarks: number }>;
  maxScore: number;
  wordCountMin: number | null;
  wordCountMax: number | null;
};

export type NormalizedSubmission = {
  plainText: string;
  wordCount: number;
  tooShort: boolean;
};

export type TopicAlignmentResult = {
  score: number;
  notes: string[];
  coverage: number;
  topic: string;
};

export type InstructionComplianceResult = {
  requirementChecks: RequirementCheck[];
  requirementsMetCount: number;
  requirementsTotal: number;
  /** 0–1 overlap of instruction keywords with the submission. */
  instructionCoverage: number;
  notes: string[];
};

export type SynthesizedFeedback = {
  executiveSummary: string;
  /**
   * Lecturer-facing prose consolidating everything noted — suitable to
   * paste into review remarks / feedback.
   */
  remarksSummary: string;
  strengths: string[];
  weaknesses: string[];
  supervisorRecommendation: string;
  estimatedGrade: string;
};

/** Match classification from Assignment Review Agent v2 Stage 5. */
export type AssignmentMatchClassification =
  | "FULL_MATCH"
  | "PARTIAL_MATCH"
  | "WEAK_MATCH"
  | "OUT_OF_SCOPE";

export type SemanticAlignmentScores = {
  assignmentIntentMatch: number;
  learningOutcomeMatch: number;
  knowledgeDomainMatch: number;
  conceptMatch: number;
  semanticSimilarity: number;
  overallTopicAlignment: number;
};

export type AssignmentGateResult = {
  classification: AssignmentMatchClassification;
  shouldStopMarking: boolean;
  alignment: SemanticAlignmentScores;
  expectedDiscipline: string;
  detectedDiscipline: string;
  reason: string;
  confidence: "High" | "Medium" | "Low";
};

export type AssignmentPipelineStages = {
  normalize: NormalizedSubmission;
  topicAlignment: TopicAlignmentResult;
  instructionCompliance: InstructionComplianceResult;
  gate: AssignmentGateResult;
  scoring: BriefGradeResult;
  feedback: SynthesizedFeedback;
};

export type AssignmentReviewPipelineResult = {
  stages: AssignmentPipelineStages;
  aiContent: AiContentDetection;
  aiSuggestedScore: number;
  maxScore: number;
  overallQuality: number;
  weaknessSeverity: number;
  requirementChecks: RequirementCheck[];
  criterionScores: RubricCriterionScore[];
  qualityChecks: AcademicQualityCheck[];
  estimatedGrade: string;
  projectTopic: string;
  executiveSummary: string;
  /** Overall summary of what was noted — for lecturer remarks. */
  remarksSummary: string;
  strengths: string[];
  weaknesses: string[];
  supervisorRecommendation: string;
  topicAlignment: TopicAlignmentResult;
  gate: AssignmentGateResult;
  assignmentStatus: AssignmentMatchClassification;
  markingSkipped: boolean;
};

const STOP_WORDS = new Set([
  "with",
  "that",
  "this",
  "from",
  "have",
  "will",
  "your",
  "their",
  "about",
  "into",
  "than",
  "then",
  "them",
  "they",
  "were",
  "been",
  "being",
  "also",
  "more",
  "most",
  "some",
  "such",
  "only",
  "over",
  "under",
  "after",
  "before",
  "between",
  "through",
  "during",
  "should",
  "would",
  "could",
  "must",
  "include",
  "using",
  "based",
  "write",
  "essay",
  "assignment",
  "student",
  "students",
  "lecturer",
  "please",
  "words",
  "word",
  "page",
  "pages",
]);

function significantTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOP_WORDS.has(t) && t.length > 3);
}

function tokenCoverage(source: string, haystack: string): number {
  const tokens = significantTokens(source);
  if (tokens.length === 0) return 0;
  const set = new Set(tokenize(haystack));
  let hits = 0;
  for (const t of tokens) {
    if (set.has(t)) hits += 1;
  }
  return hits / tokens.length;
}

/** Stage 1 — strip HTML / normalise whitespace for downstream stages. */
export function normalizeSubmission(
  htmlOrText: string,
  maxChars = 12000,
): NormalizedSubmission {
  const plainText = String(htmlOrText || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
  const count = wordCount(plainText);
  return {
    plainText,
    wordCount: count,
    tooShort: count < 40,
  };
}

/**
 * Stage 2 — does the write-up address the lecturer topic?
 * Grounded in topic token overlap + structural signals.
 */
export function assessTopicAlignment(
  text: string,
  topic: string,
): TopicAlignmentResult {
  const plain = text.replace(/\s+/g, " ").trim();
  const topicTrim = topic.replace(/\s+/g, " ").trim();
  const notes: string[] = [];

  if (!topicTrim) {
    return {
      score: 40,
      notes: ["No lecturer topic on file — alignment cannot be confirmed"],
      coverage: 0,
      topic: "",
    };
  }

  if (plain.length < 40) {
    return {
      score: 8,
      notes: [
        `Submission is too short to address the topic “${topicTrim.slice(0, 120)}”`,
      ],
      coverage: 0,
      topic: topicTrim,
    };
  }

  const coverage = tokenCoverage(topicTrim, plain);
  let score = clamp(coverage * 100);

  const topicLower = topicTrim.toLowerCase();
  const plainLower = plain.toLowerCase();
  if (topicLower.length >= 12 && plainLower.includes(topicLower)) {
    score = Math.max(score, 78);
    notes.push("Topic phrase appears in the submission");
  } else if (coverage >= 0.55) {
    notes.push("Strong keyword overlap with the lecturer topic");
  } else if (coverage >= 0.3) {
    notes.push("Partial overlap with the lecturer topic — deepen focus");
    score = Math.min(score, 58);
  } else {
    notes.push(
      `Weak match to lecturer topic “${topicTrim.slice(0, 100)}” — re-centre the argument`,
    );
    score = Math.min(score, 32);
  }

  const count = wordCount(plain);
  if (count < 80) {
    score = Math.min(score, 25);
    notes.push("Length is insufficient to develop the topic");
  }

  return {
    score: clamp(score),
    notes: notes.slice(0, 6),
    coverage: Math.round(coverage * 100) / 100,
    topic: topicTrim,
  };
}

/**
 * Stage 3 — instruction / must-include compliance against the brief.
 */
export function assessInstructionCompliance(
  text: string,
  instructions: string,
  requiredItems: string[] = [],
): InstructionComplianceResult {
  const items = requiredItems.map((i) => i.trim()).filter(Boolean);
  const requirementChecks = items.map((item) => checkRequiredItem(text, item));
  const requirementsMetCount = requirementChecks.filter((c) => c.met).length;
  const requirementsTotal = requirementChecks.length;

  const instructionCoverage =
    instructions.trim().length > 20
      ? tokenCoverage(instructions.slice(0, 4000), text)
      : requirementsTotal > 0
        ? requirementsMetCount / requirementsTotal
        : 0.5;

  const notes: string[] = [];
  for (const check of requirementChecks) {
    if (!check.met) notes.push(`Must include not met: ${check.item}`);
  }
  if (instructions.trim().length > 20 && instructionCoverage < 0.25) {
    notes.push(
      "Submission shows little evidence of following the lecturer instructions",
    );
  } else if (instructions.trim().length > 20 && instructionCoverage >= 0.45) {
    notes.push("Submission touches key ideas from the lecturer instructions");
  }
  if (requirementsTotal > 0 && requirementsMetCount === 0) {
    notes.push("None of the must-include checklist items appear to be met");
  }

  return {
    requirementChecks,
    requirementsMetCount,
    requirementsTotal,
    instructionCoverage: Math.round(instructionCoverage * 100) / 100,
    notes: notes.slice(0, 10),
  };
}

/**
 * Infer a coarse discipline label from topic/instructions (local heuristic).
 */
export function inferDisciplineHint(text: string): string {
  const t = text.toLowerCase();
  if (
    /\b(use of english|academic writing|grammar|paragraph|referenc|english language)\b/.test(
      t,
    )
  ) {
    return "Use of English / Academic Writing";
  }
  if (/\b(machine learning|neural|deep learning|ai model|algorithm)\b/.test(t)) {
    return "Machine Learning / Computing";
  }
  if (/\b(finance|banking|investment|accounting|econom)\b/.test(t)) {
    return "Finance / Economics";
  }
  if (/\b(photosynthesis|biology|chloroplast|medical|healthcare|nursing)\b/.test(t)) {
    return "Science / Health";
  }
  if (/\b(law|legal|statute|contract|litigation)\b/.test(t)) {
    return "Law";
  }
  if (/\b(engineer|mechanical|civil|electrical)\b/.test(t)) {
    return "Engineering";
  }
  if (/\b(blockchain|cryptocurrency|tokenomics)\b/.test(t)) {
    return "FinTech / Cryptocurrency";
  }
  const words = significantTokens(text).slice(0, 4);
  return words.length > 0
    ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : "Unspecified discipline";
}

/**
 * Build semantic alignment scores from local topic + instruction signals.
 */
export function buildLocalAlignmentScores(
  topicAlignment: TopicAlignmentResult,
  instructionCompliance: InstructionComplianceResult,
): SemanticAlignmentScores {
  const topic = topicAlignment.score;
  const coveragePct = clamp(instructionCompliance.instructionCoverage * 100);
  const reqRatio =
    instructionCompliance.requirementsTotal > 0
      ? (instructionCompliance.requirementsMetCount /
          instructionCompliance.requirementsTotal) *
        100
      : coveragePct;
  const overall = clamp(topic * 0.55 + coveragePct * 0.25 + reqRatio * 0.2);
  return {
    assignmentIntentMatch: clamp(topic * 0.7 + coveragePct * 0.3),
    learningOutcomeMatch: clamp(reqRatio * 0.6 + topic * 0.4),
    knowledgeDomainMatch: clamp(topic),
    conceptMatch: clamp(topic * 0.5 + reqRatio * 0.5),
    semanticSimilarity: clamp(topic * 0.6 + coveragePct * 0.4),
    overallTopicAlignment: overall,
  };
}

/**
 * Stage 5 — classify match + decide hard stop (deterministic fallback).
 */
export function classifyAssignmentMatch(opts: {
  topicAlignment: TopicAlignmentResult;
  instructionCompliance: InstructionComplianceResult;
  brief: AssignmentBriefContext;
  submissionText: string;
  alignment?: SemanticAlignmentScores;
}): AssignmentGateResult {
  const alignment =
    opts.alignment ||
    buildLocalAlignmentScores(opts.topicAlignment, opts.instructionCompliance);
  const expectedDiscipline = inferDisciplineHint(
    `${opts.brief.topic} ${opts.brief.title} ${opts.brief.instructions.slice(0, 800)}`,
  );
  const detectedDiscipline = inferDisciplineHint(opts.submissionText.slice(0, 4000));

  const { overallTopicAlignment, knowledgeDomainMatch, learningOutcomeMatch } =
    alignment;
  const topic = opts.topicAlignment.score;
  const coverage = opts.instructionCompliance.instructionCoverage;
  const reqRatio =
    opts.instructionCompliance.requirementsTotal > 0
      ? opts.instructionCompliance.requirementsMetCount /
        opts.instructionCompliance.requirementsTotal
      : coverage;

  let classification: AssignmentMatchClassification;
  if (
    topic < 40 ||
    knowledgeDomainMatch < 40 ||
    overallTopicAlignment < 40 ||
    (coverage < 0.2 && topic < 50)
  ) {
    classification = "OUT_OF_SCOPE";
  } else if (topic < 55 || (coverage < 0.35 && reqRatio < 0.4)) {
    classification = "WEAK_MATCH";
  } else if (
    reqRatio < 0.85 ||
    opts.instructionCompliance.requirementsMetCount <
      opts.instructionCompliance.requirementsTotal ||
    topic < 70
  ) {
    classification = "PARTIAL_MATCH";
  } else {
    classification = "FULL_MATCH";
  }

  const shouldStopMarking =
    classification === "OUT_OF_SCOPE" ||
    classification === "WEAK_MATCH" ||
    overallTopicAlignment < 40 ||
    knowledgeDomainMatch < 40 ||
    learningOutcomeMatch < 40;

  const confidence: AssignmentGateResult["confidence"] =
    topic < 25 || topic >= 80 ? "High" : topic < 45 || topic < 65 ? "Medium" : "Medium";

  const reason = shouldStopMarking
    ? `Assignment Status: ${classification}. Expected discipline: ${expectedDiscipline}. Detected discipline: ${detectedDiscipline}. Topic alignment ${overallTopicAlignment}/100; knowledge domain ${knowledgeDomainMatch}/100; learning outcomes ${learningOutcomeMatch}/100. The submission cannot be graded fairly because it does not adequately attempt the assigned task.`
    : `Assignment Status: ${classification}. Submission is within the expected body of knowledge for “${opts.brief.topic.slice(0, 120)}”. Alignment scores support proceeding to rubric marking.`;

  return {
    classification,
    shouldStopMarking,
    alignment,
    expectedDiscipline,
    detectedDiscipline,
    reason,
    confidence,
  };
}

/**
 * Lecturer-facing remarks when marking is hard-stopped (Stage 6) — ~200 words.
 */
export function buildOutOfScopeRemarks(opts: {
  brief: AssignmentBriefContext;
  gate: AssignmentGateResult;
  recommendedScore: number;
  maxScore: number;
}): string {
  const topicLabel = opts.brief.topic?.trim() || opts.brief.title || "the assigned topic";
  return fitRemarksToWordCount(
    [
      `Assignment Status: ${opts.gate.classification} (confidence: ${opts.gate.confidence}). This submission cannot be graded fairly against the brief because it does not adequately attempt the assigned task on “${topicLabel}”.`,
      `Expected body of knowledge: ${opts.gate.expectedDiscipline}. Detected: ${opts.gate.detectedDiscipline}. ${opts.gate.reason}`,
      `A recommended mark of ${opts.recommendedScore}/${opts.maxScore} is recorded in the institutional 0–15% band for out-of-scope or weak-match work. Writing quality alone should not raise this mark while the work remains outside the assigned discipline.`,
      `Before confirming this outcome, please give particular attention to whether any portion does address “${topicLabel}”, whether the wrong file was uploaded, and whether policy allows any discretionary credit.`,
      `Where to check in the work: re-read the introduction and conclusion for on-topic framing; skim the body for relevant terminology; confirm the attached brief matches this submission; then review the Assignment Status / gate reason in this report before approving or overriding.`,
    ].join("\n\n"),
    200,
    25,
  );
}

/** Cap mark in the institutional 0–15% band for hard-stopped reviews. */
export function outOfScopeRecommendedScore(maxScore: number): number {
  const max = maxScore > 0 ? maxScore : 100;
  return ceilAiScore(max * 0.15, max);
}

/**
 * Merge local gate with LLM gate — take the stricter stop decision and min alignment.
 */
export function mergeAssignmentGates(
  local: AssignmentGateResult,
  llm: Partial<AssignmentGateResult> & {
    alignment?: Partial<SemanticAlignmentScores>;
  },
): AssignmentGateResult {
  const alignment: SemanticAlignmentScores = {
    assignmentIntentMatch: Math.min(
      local.alignment.assignmentIntentMatch,
      llm.alignment?.assignmentIntentMatch ?? local.alignment.assignmentIntentMatch,
    ),
    learningOutcomeMatch: Math.min(
      local.alignment.learningOutcomeMatch,
      llm.alignment?.learningOutcomeMatch ?? local.alignment.learningOutcomeMatch,
    ),
    knowledgeDomainMatch: Math.min(
      local.alignment.knowledgeDomainMatch,
      llm.alignment?.knowledgeDomainMatch ?? local.alignment.knowledgeDomainMatch,
    ),
    conceptMatch: Math.min(
      local.alignment.conceptMatch,
      llm.alignment?.conceptMatch ?? local.alignment.conceptMatch,
    ),
    semanticSimilarity: Math.min(
      local.alignment.semanticSimilarity,
      llm.alignment?.semanticSimilarity ?? local.alignment.semanticSimilarity,
    ),
    overallTopicAlignment: Math.min(
      local.alignment.overallTopicAlignment,
      llm.alignment?.overallTopicAlignment ?? local.alignment.overallTopicAlignment,
    ),
  };

  const rank: Record<AssignmentMatchClassification, number> = {
    FULL_MATCH: 0,
    PARTIAL_MATCH: 1,
    WEAK_MATCH: 2,
    OUT_OF_SCOPE: 3,
  };
  const llmClass = llm.classification;
  const classification =
    llmClass && rank[llmClass] > rank[local.classification]
      ? llmClass
      : local.classification;

  const shouldStopMarking =
    local.shouldStopMarking ||
    Boolean(llm.shouldStopMarking) ||
    classification === "OUT_OF_SCOPE" ||
    classification === "WEAK_MATCH" ||
    alignment.overallTopicAlignment < 40 ||
    alignment.knowledgeDomainMatch < 40 ||
    alignment.learningOutcomeMatch < 40;

  return {
    classification: shouldStopMarking
      ? classification === "FULL_MATCH" || classification === "PARTIAL_MATCH"
        ? alignment.overallTopicAlignment < 40 ||
          alignment.knowledgeDomainMatch < 40 ||
          alignment.learningOutcomeMatch < 40
          ? "OUT_OF_SCOPE"
          : "WEAK_MATCH"
        : classification
      : classification,
    shouldStopMarking,
    alignment,
    expectedDiscipline:
      llm.expectedDiscipline?.trim() || local.expectedDiscipline,
    detectedDiscipline:
      llm.detectedDiscipline?.trim() || local.detectedDiscipline,
    reason: llm.reason?.trim() || local.reason,
    confidence: llm.confidence || local.confidence,
  };
}

/**
 * Stage 4 — score using brief max marks / rubric, tempered by topic + compliance.
 * Hard-stop classifications force the 0–15% institutional band.
 */
export function scorePipelineAgainstBrief(opts: {
  text: string;
  brief: AssignmentBriefContext;
  topicAlignment: TopicAlignmentResult;
  instructionCompliance: InstructionComplianceResult;
  gate?: AssignmentGateResult;
  baseOverall?: number;
  weaknessSeverity?: number;
  aiGeneratedPercent?: number;
}): BriefGradeResult {
  const base = gradeAgainstBrief({
    text: opts.text,
    maxScore: opts.brief.maxScore,
    requiredItems: opts.brief.requiredItems,
    rubric: opts.brief.rubric,
    wordCountMin: opts.brief.wordCountMin,
    wordCountMax: opts.brief.wordCountMax,
    baseOverall: opts.baseOverall,
    weaknessSeverity: opts.weaknessSeverity,
    aiGeneratedPercent: opts.aiGeneratedPercent,
  });

  const gate =
    opts.gate ||
    classifyAssignmentMatch({
      topicAlignment: opts.topicAlignment,
      instructionCompliance: opts.instructionCompliance,
      brief: opts.brief,
      submissionText: opts.text,
    });

  if (gate.shouldStopMarking) {
    const finalScore = outOfScopeRecommendedScore(base.maxScore);
    const criterionScores = base.criterionScores.map((c) => ({
      ...c,
      score: ceilAiScore((finalScore / base.maxScore) * c.maxMarks, c.maxMarks),
      comment:
        "Marking skipped — submission out of scope / weak match; criterion not fully assessed",
    }));
    return {
      ...base,
      aiSuggestedScore: finalScore,
      overallQuality: clamp((finalScore / base.maxScore) * 100),
      weaknesses: [
        gate.reason,
        ...opts.topicAlignment.notes.slice(0, 2),
        ...opts.instructionCompliance.notes.slice(0, 2),
      ].slice(0, 10),
      criterionScores,
      requirementChecks: opts.instructionCompliance.requirementChecks,
      requirementsMetCount: opts.instructionCompliance.requirementsMetCount,
      requirementsTotal: opts.instructionCompliance.requirementsTotal,
      estimatedGrade: letterFromPercent((finalScore / base.maxScore) * 100),
    };
  }

  let factor = 1;
  if (opts.topicAlignment.score < 55) factor *= 0.78;
  else if (opts.topicAlignment.score >= 75) factor *= 1.02;

  if (opts.instructionCompliance.instructionCoverage < 0.25) factor *= 0.7;
  else if (opts.instructionCompliance.instructionCoverage < 0.4) factor *= 0.85;

  let finalScore =
    Math.round(
      Math.max(0, Math.min(base.maxScore, base.aiSuggestedScore * factor)) * 10,
    ) / 10;

  if (
    opts.instructionCompliance.requirementsTotal > 0 &&
    opts.instructionCompliance.requirementsMetCount === 0
  ) {
    finalScore = Math.min(finalScore, base.maxScore * 0.22);
  }
  if (gate.classification === "PARTIAL_MATCH") {
    finalScore = Math.min(finalScore, base.maxScore * 0.85);
  }

  finalScore = ceilAiScore(finalScore, base.maxScore);

  const overallQuality = clamp((finalScore / base.maxScore) * 100);
  const weaknesses = [
    ...base.weaknesses,
    ...(opts.topicAlignment.score < 55
      ? opts.topicAlignment.notes.slice(0, 2)
      : []),
    ...opts.instructionCompliance.notes
      .filter((n) => !base.weaknesses.includes(n))
      .slice(0, 3),
  ].slice(0, 10);

  const rubricMax = base.criterionScores.reduce((s, c) => s + c.maxMarks, 0);
  const rubricTotal = base.criterionScores.reduce((s, c) => s + c.score, 0);
  let criterionScores = base.criterionScores;
  if (rubricMax > 0 && rubricTotal > 0) {
    const targetTotal = (finalScore / base.maxScore) * rubricMax;
    const scale = targetTotal / rubricTotal;
    criterionScores = base.criterionScores.map((c) => {
      const score = Math.min(c.maxMarks, Math.ceil(c.score * scale));
      const ratio = c.maxMarks > 0 ? score / c.maxMarks : 0;
      return {
        ...c,
        score,
        comment:
          ratio < 0.4
            ? "Does not meet brief expectations for this criterion"
            : ratio < 0.7
              ? "Partially meets the brief"
              : "Mostly meets the brief for this criterion",
      };
    });
  }

  return {
    ...base,
    aiSuggestedScore: finalScore,
    overallQuality,
    weaknesses,
    criterionScores,
    requirementChecks: opts.instructionCompliance.requirementChecks,
    requirementsMetCount: opts.instructionCompliance.requirementsMetCount,
    requirementsTotal: opts.instructionCompliance.requirementsTotal,
    estimatedGrade: letterFromPercent((finalScore / base.maxScore) * 100),
  };
}

/**
 * Fit remarks to ~targetWords (default 200). Prefer whole sentences.
 */
export function fitRemarksToWordCount(
  text: string,
  targetWords = 200,
  tolerance = 25,
): string {
  const cleaned = String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return cleaned;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= targetWords + tolerance) {
    // Soft pad is not needed — short remarks are fine if under budget.
    return cleaned;
  }

  // Keep paragraph breaks while trimming to target + tolerance.
  const paragraphs = cleaned.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  let count = 0;
  const max = targetWords + tolerance;

  for (const para of paragraphs) {
    const pw = para.split(/\s+/).filter(Boolean);
    if (count + pw.length <= max) {
      kept.push(para);
      count += pw.length;
      continue;
    }
    const remaining = max - count;
    if (remaining < 12) break;
    // Take whole sentences until remaining budget is used.
    const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [para];
    const chunk: string[] = [];
    let used = 0;
    for (const s of sentences) {
      const sw = s.trim().split(/\s+/).filter(Boolean);
      if (used + sw.length > remaining) break;
      chunk.push(s.trim());
      used += sw.length;
    }
    if (chunk.length > 0) kept.push(chunk.join(" "));
    break;
  }

  return kept.join("\n\n").trim();
}

/**
 * Build lecturer-facing remarks as continuous academic prose (~200 words).
 */
export function buildRemarksSummary(opts: {
  brief: AssignmentBriefContext;
  normalize: NormalizedSubmission;
  topicAlignment: TopicAlignmentResult;
  instructionCompliance: InstructionComplianceResult;
  scoring: BriefGradeResult;
  strengths: string[];
  gate?: AssignmentGateResult;
}): string {
  const {
    brief,
    normalize,
    topicAlignment,
    instructionCompliance,
    scoring,
    gate,
  } = opts;

  const topicLabel = brief.topic?.trim() || brief.title || "the assigned topic";

  if (normalize.tooShort) {
    return fitRemarksToWordCount(
      [
        `Overall, this submission is too brief to be assessed as a complete response to “${brief.title}” on the topic “${topicLabel}”. At the current length it cannot demonstrate the required coverage, development of ideas, or academic conventions expected for the brief.`,
        `A provisional mark of ${scoring.aiSuggestedScore}/${scoring.maxScore} is recorded. A full rewrite against the lecturer instructions is required before a passing mark can be justified.`,
        `Before confirming this mark, please give particular attention to whether any partial credit is warranted under your module policy, and whether the student submitted an incomplete draft by mistake.`,
        `Where to check in the work: open the editable review copy and confirm overall length; if content exists, skim the introduction and conclusion only. Then decide whether to request a full resubmission before any further marking.`,
      ].join("\n\n"),
    );
  }

  if (gate?.shouldStopMarking) {
    return fitRemarksToWordCount(
      buildOutOfScopeRemarks({
        brief,
        gate,
        recommendedScore: scoring.aiSuggestedScore,
        maxScore: scoring.maxScore,
      }),
    );
  }

  const missing = instructionCompliance.requirementChecks
    .filter((c) => !c.met)
    .map((c) => c.item);
  const weakRubric = scoring.criterionScores.filter(
    (c) => c.maxMarks > 0 && c.score / c.maxMarks < 0.5,
  );
  const partialRubric = scoring.criterionScores.filter(
    (c) =>
      c.maxMarks > 0 &&
      c.score / c.maxMarks >= 0.5 &&
      c.score / c.maxMarks < 0.7,
  );
  const strongRubric = scoring.criterionScores.filter(
    (c) => c.maxMarks > 0 && c.score / c.maxMarks >= 0.7,
  );
  const weakQuality = (scoring.qualityChecks || []).filter((q) => q.score < 45);

  const paragraphs: string[] = [];

  // ~40 words — overall
  if (topicAlignment.score >= 70) {
    paragraphs.push(
      `Overall, this submission addresses “${topicLabel}” and stays largely within the scope of “${brief.title}”. It shows a recognisable attempt to meet the assessment task at the expected level.`,
    );
  } else if (topicAlignment.score >= 55) {
    paragraphs.push(
      `Overall, this submission partially addresses “${topicLabel}” for “${brief.title}”, but focus drifts in places and needs tighter alignment with the lecturer’s intended scope.`,
    );
  } else {
    paragraphs.push(
      `Overall, engagement with “${topicLabel}” is limited. The submission does not yet demonstrate a secure, sustained response to the brief “${brief.title}”.`,
    );
  }

  // ~45 words — compliance + criteria
  const midBits: string[] = [];
  if (instructionCompliance.requirementsTotal > 0) {
    if (missing.length === 0) {
      midBits.push("required must-include elements appear addressed");
    } else {
      midBits.push(
        `required elements incomplete (${missing.slice(0, 2).join("; ")}${missing.length > 2 ? "; …" : ""})`,
      );
    }
  }
  if (
    brief.wordCountMin != null &&
    scoring.wordCount < brief.wordCountMin
  ) {
    midBits.push(
      `word count (${scoring.wordCount}) below minimum ${brief.wordCountMin}`,
    );
  } else if (
    brief.wordCountMin != null &&
    scoring.wordCount >= brief.wordCountMin &&
    (brief.wordCountMax == null ||
      scoring.wordCount <= brief.wordCountMax * 1.25)
  ) {
    midBits.push("length is broadly appropriate");
  }

  const criterionBits: string[] = [];
  for (const c of weakRubric.slice(0, 2)) {
    criterionBits.push(
      `${c.name} needs improvement (${c.score}/${c.maxMarks})`,
    );
  }
  for (const c of partialRubric.slice(0, 1)) {
    if (weakRubric.some((w) => w.name === c.name)) continue;
    criterionBits.push(
      `${c.name} only partially met (${c.score}/${c.maxMarks})`,
    );
  }
  if (criterionBits.length === 0 && strongRubric.length >= 1) {
    criterionBits.push(
      `stronger on ${strongRubric[0].name} (${strongRubric[0].score}/${strongRubric[0].maxMarks})`,
    );
  }
  if (weakQuality.length > 0 && criterionBits.length < 2) {
    criterionBits.push(
      `${weakQuality[0].name.toLowerCase()} (${weakQuality[0].comment})`,
    );
  }

  const midParts = [...midBits, ...criterionBits];
  if (midParts.length > 0) {
    paragraphs.push(
      `On compliance and criteria, ${midParts.join("; ")}. These points currently shape the provisional mark.`,
    );
  }

  // ~30 words — mark
  const priority =
    weakRubric[0]?.name ||
    weakQuality[0]?.name ||
    (missing[0]
      ? "missing required elements"
      : "analysis and academic expression");
  paragraphs.push(
    `A provisional mark of ${scoring.aiSuggestedScore}/${scoring.maxScore} (est. ${scoring.estimatedGrade}) is suggested. Priority for revision: strengthen ${priority} with clearer evidence and development before a higher mark can be justified.`,
  );

  // ~45 words — lecturer checks
  const attentionItems = buildLecturerAttentionItems({
    missing,
    weakRubric,
    weakQuality,
    topicAlignmentScore: topicAlignment.score,
    scoring,
  });
  paragraphs.push(
    `Before confirming this mark, please give particular attention to: ${attentionItems.checks.slice(0, 3).join("; ")}. Automated review is indicative only; your judgement should decide whether the mark stands, is raised, or is reduced.`,
  );

  // ~40 words — where to check
  paragraphs.push(
    `Where to check in the work: ${attentionItems.whereToLook.slice(0, 2).join(" ")} Also use the yellow Weakness and orange Needs-citation highlights in the review copy, plus the rubric and Academic quality checks panels in this report.`,
  );

  return fitRemarksToWordCount(paragraphs.join("\n\n"), 200, 25);
}

/** Map weak signals to lecturer attention items and where to inspect the script. */
function buildLecturerAttentionItems(opts: {
  missing: string[];
  weakRubric: RubricCriterionScore[];
  weakQuality: AcademicQualityCheck[];
  topicAlignmentScore: number;
  scoring: BriefGradeResult;
}): { checks: string[]; whereToLook: string[] } {
  const checks: string[] = [];
  const whereToLook: string[] = [];

  if (opts.topicAlignmentScore < 70) {
    checks.push(
      "whether the central argument stays on the lecturer topic throughout (not only in the opening)",
    );
    whereToLook.push(
      "Read the introduction and the opening of each body paragraph to confirm topic focus and thesis continuity.",
    );
  }

  if (opts.missing.length > 0) {
    checks.push(
      `whether required brief elements are genuinely present (${opts.missing.slice(0, 2).join("; ")}${opts.missing.length > 2 ? "; …" : ""})`,
    );
    whereToLook.push(
      "Scan the full submission against the must-include checklist in this report, especially sections the AI marked as missing.",
    );
  }

  for (const c of opts.weakRubric.slice(0, 2)) {
    const name = c.name.toLowerCase();
    checks.push(`human verification of ${c.name} (${c.score}/${c.maxMarks})`);
    if (/organis|organiz|coherence|structure/.test(name)) {
      whereToLook.push(
        "Check paragraphing and transitions across the middle of the essay (body paragraphs), not only the introduction and conclusion.",
      );
    } else if (/language|grammar|style|accuracy|vocab/.test(name)) {
      whereToLook.push(
        "Sample language accuracy in several body paragraphs (mid-script), where surface polish often drops.",
      );
    } else if (/evidence|example/.test(name)) {
      whereToLook.push(
        "Locate claims in the body that lack concrete examples or evidence, including sentences marked in orange for missing citations.",
      );
    } else if (/referenc|citation|integrity/.test(name)) {
      whereToLook.push(
        "Inspect in-text citations in the body and the reference list / bibliography at the end of the work.",
      );
    } else if (/critical|analysis|thinking|argument|thesis|content/.test(name)) {
      whereToLook.push(
        "Re-read the thesis statement and the analytical claims in the later body paragraphs where depth should appear.",
      );
    } else {
      whereToLook.push(
        `Re-assess “${c.name}” by reading the highlighted Weakness passages in the review copy.`,
      );
    }
  }

  for (const q of opts.weakQuality.slice(0, 2)) {
    if (checks.length >= 4) break;
    const qn = q.name.toLowerCase();
    if (checks.some((c) => c.toLowerCase().includes(qn.slice(0, 12)))) continue;
    checks.push(`${q.name.toLowerCase()} (${q.comment})`);
    if (/originality|integrity|ai/.test(qn)) {
      whereToLook.push(
        "Compare a few mid-essay paragraphs for voice consistency and possible over-generic AI phrasing; treat the AI-generated % as a prompt for review, not proof.",
      );
    }
  }

  if (opts.scoring.aiSuggestedScore >= opts.scoring.maxScore * 0.55) {
    checks.push(
      "whether the provisional mark fairly reflects depth of analysis relative to your cohort and module expectations",
    );
  } else {
    checks.push(
      "whether any credit beyond the provisional band is warranted for effort or partial insight that the pipeline may under-weight",
    );
  }

  if (checks.length === 0) {
    checks.push(
      "overall fairness of the provisional mark against your module standard",
      "academic integrity / authorship confidence for this submission",
    );
  }
  if (whereToLook.length === 0) {
    whereToLook.push(
      "Skim the full script once, then focus on the yellow-highlighted sentences in the editable review copy.",
    );
  }

  const seen = new Set<string>();
  const uniqueWhere = whereToLook.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });

  return {
    checks: checks.slice(0, 4),
    whereToLook: uniqueWhere.slice(0, 4),
  };
}

/** Stage 5 — synthesise supervisor-facing feedback from prior stages. */
export function synthesizeAssignmentFeedback(opts: {
  brief: AssignmentBriefContext;
  normalize: NormalizedSubmission;
  topicAlignment: TopicAlignmentResult;
  instructionCompliance: InstructionComplianceResult;
  scoring: BriefGradeResult;
  gate: AssignmentGateResult;
}): SynthesizedFeedback {
  const {
    brief,
    normalize,
    topicAlignment,
    instructionCompliance,
    scoring,
    gate,
  } = opts;

  if (normalize.tooShort) {
    const strengths: string[] = [];
    const weaknesses = [
      "Submission is far too short for a graded academic essay",
      ...instructionCompliance.notes.slice(0, 4),
    ];
    return {
      executiveSummary:
        "This page has little content to review yet. It does not meet the assignment brief.",
      remarksSummary: buildRemarksSummary({
        brief,
        normalize,
        topicAlignment,
        instructionCompliance,
        scoring,
        strengths,
        gate,
      }),
      strengths,
      weaknesses,
      supervisorRecommendation:
        "Do not approve a passing mark — request a full submission against the brief.",
      estimatedGrade: scoring.estimatedGrade,
    };
  }

  if (gate.shouldStopMarking) {
    const remarksSummary = buildOutOfScopeRemarks({
      brief,
      gate,
      recommendedScore: scoring.aiSuggestedScore,
      maxScore: scoring.maxScore,
    });
    return {
      executiveSummary: `Assignment Status: ${gate.classification}. Marking stopped — submission does not attempt the assigned task (expected: ${gate.expectedDiscipline}; detected: ${gate.detectedDiscipline}). Recommended mark ${scoring.aiSuggestedScore}/${scoring.maxScore}.`,
      remarksSummary,
      strengths: [],
      weaknesses: [
        gate.reason,
        ...topicAlignment.notes.slice(0, 2),
        ...instructionCompliance.notes.slice(0, 3),
      ].slice(0, 8),
      supervisorRecommendation: `Do not award a full mark. Assignment Status ${gate.classification}. Recommended ${scoring.aiSuggestedScore}/${scoring.maxScore}. Approve only if you override institutional out-of-scope policy.`,
      estimatedGrade: scoring.estimatedGrade,
    };
  }

  const strengths: string[] = [];
  if (topicAlignment.score >= 70) {
    strengths.push("Write-up stays aligned with the lecturer topic");
  }
  if (
    instructionCompliance.requirementsTotal > 0 &&
    instructionCompliance.requirementsMetCount ===
      instructionCompliance.requirementsTotal
  ) {
    strengths.push("All must-include checklist items appear addressed");
  } else if (instructionCompliance.requirementsMetCount > 0) {
    strengths.push(
      `Met ${instructionCompliance.requirementsMetCount}/${instructionCompliance.requirementsTotal} must-include items`,
    );
  }
  if (
    brief.wordCountMin != null &&
    normalize.wordCount >= brief.wordCountMin
  ) {
    strengths.push("Meets the brief word-count minimum");
  }

  const executiveSummary = [
    `Graded against the lecturer brief (“${brief.title}”) on topic “${brief.topic}”.`,
    `Assignment Status: ${gate.classification}.`,
    `Topic alignment ${topicAlignment.score}/100.`,
    `Must-include items met: ${instructionCompliance.requirementsMetCount}/${instructionCompliance.requirementsTotal || 0}.`,
    `Word count: ${scoring.wordCount}.`,
    `Suggested mark: ${scoring.aiSuggestedScore}/${scoring.maxScore}.`,
  ].join(" ");

  const supervisorRecommendation = `AI mark ${scoring.aiSuggestedScore}/${scoring.maxScore} (${scoring.estimatedGrade}) after Assignment Intelligence gate (${gate.classification}). Topic alignment ${topicAlignment.score}/100. Approve or override.`;

  const remarksSummary = buildRemarksSummary({
    brief,
    normalize,
    topicAlignment,
    instructionCompliance,
    scoring,
    strengths: strengths.slice(0, 5),
    gate,
  });

  return {
    executiveSummary,
    remarksSummary,
    strengths: strengths.slice(0, 5),
    weaknesses: scoring.weaknesses,
    supervisorRecommendation,
    estimatedGrade: scoring.estimatedGrade,
  };
}

/**
 * Full local agent pipeline for assignment AI review (v2).
 * Stages: normalize → topic alignment → instruction compliance → gate → scoring → feedback.
 */
export function runAssignmentReviewPipeline(opts: {
  htmlOrText: string;
  brief: AssignmentBriefContext;
  baseOverall?: number;
  weaknessSeverity?: number;
}): AssignmentReviewPipelineResult {
  const normalize = normalizeSubmission(opts.htmlOrText);
  const aiContent = estimateAiGeneratedContent(normalize.plainText);
  const topicAlignment = assessTopicAlignment(
    normalize.plainText,
    opts.brief.topic,
  );
  const instructionCompliance = assessInstructionCompliance(
    normalize.plainText,
    opts.brief.instructions,
    opts.brief.requiredItems,
  );
  const gate = classifyAssignmentMatch({
    topicAlignment,
    instructionCompliance,
    brief: opts.brief,
    submissionText: normalize.plainText,
  });
  const scoring = scorePipelineAgainstBrief({
    text: normalize.plainText,
    brief: opts.brief,
    topicAlignment,
    instructionCompliance,
    gate,
    baseOverall: opts.baseOverall,
    weaknessSeverity: opts.weaknessSeverity,
    aiGeneratedPercent: aiContent.percent,
  });
  const feedback = synthesizeAssignmentFeedback({
    brief: opts.brief,
    normalize,
    topicAlignment,
    instructionCompliance,
    scoring,
    gate,
  });

  return {
    stages: {
      normalize,
      topicAlignment,
      instructionCompliance,
      gate,
      scoring,
      feedback,
    },
    aiContent,
    aiSuggestedScore: scoring.aiSuggestedScore,
    maxScore: scoring.maxScore,
    overallQuality: scoring.overallQuality,
    weaknessSeverity: scoring.weaknessSeverity,
    requirementChecks: scoring.requirementChecks,
    criterionScores: scoring.criterionScores,
    qualityChecks: scoring.qualityChecks || [],
    estimatedGrade: feedback.estimatedGrade,
    projectTopic: opts.brief.topic,
    executiveSummary: feedback.executiveSummary,
    remarksSummary: feedback.remarksSummary,
    strengths: feedback.strengths,
    weaknesses: feedback.weaknesses,
    supervisorRecommendation: feedback.supervisorRecommendation,
    topicAlignment,
    gate,
    assignmentStatus: gate.classification,
    markingSkipped: gate.shouldStopMarking,
  };
}
