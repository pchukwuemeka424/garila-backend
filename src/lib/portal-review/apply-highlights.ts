
/** Highlight colours used in supervisor review annotations. */
export const REVIEW_HIGHLIGHT_COLORS = {
  strength: "#86efac",
  weakness: "#fde047",
  /** Claims / statements that need an in-text citation. */
  citation: "#fdba74",
} as const;

/** Short warning labels shown on highlighted sentences. */
export const REVIEW_HIGHLIGHT_LABELS = {
  strength: "Strength",
  weakness: "Weakness",
  citation: "Claim needs in-text citation",
} as const;

export type ReviewHighlightKind = keyof typeof REVIEW_HIGHLIGHT_COLORS;

export type ReviewTextHighlights = {
  strengths?: string[];
  weaknesses?: string[];
  /** Passages that assert facts/claims without an in-text citation. */
  citations?: string[];
};

/** 0–100 scores for each review dimension. */
export type AreaScores = {
  strengths: number;
  weaknesses: number;
  overall: number;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Heuristic 0–100 scores for Strengths / Weaknesses
 * when no LLM scores are available.
 */
export function computeAreaScores(plainText: string): AreaScores {
  const plain = normalizeWhitespace(plainText);
  const words = plain ? plain.split(" ").filter(Boolean) : [];
  const wordCount = words.length;
  const sentences = plain
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const avgSentenceLen =
    sentences.length > 0 ? wordCount / sentences.length : wordCount;

  const citationHits = (
    plain.match(
      /\((?:[A-Z][a-z]+(?:\s+&\s+[A-Z][a-z]+)*,\s*)?\d{4}\)|\[\d+\]|et al\./g,
    ) || []
  ).length;
  const academicHits = (
    plain.match(
      /\b(however|therefore|furthermore|moreover|significant|analysis|methodology|framework|hypothesis|evidence|literature)\b/gi,
    ) || []
  ).length;
  const vagueHits = (
    plain.match(
      /\b(very|really|thing|stuff|a lot|interesting|important|good|bad)\b/gi,
    ) || []
  ).length;

  let strengths = 42;
  if (wordCount >= 80) strengths += 12;
  if (wordCount >= 180) strengths += 10;
  if (wordCount >= 350) strengths += 8;
  strengths += Math.min(18, academicHits * 3);
  strengths += Math.min(12, citationHits * 4);
  strengths -= Math.min(14, vagueHits * 2);
  if (avgSentenceLen > 38) strengths -= 6;
  if (avgSentenceLen < 8 && wordCount > 40) strengths -= 8;

  let weaknesses = 28;
  if (wordCount < 60) weaknesses += 30;
  else if (wordCount < 120) weaknesses += 16;
  if (citationHits === 0 && wordCount >= 80) weaknesses += 18;
  weaknesses += Math.min(16, vagueHits * 3);
  if (avgSentenceLen > 40) weaknesses += 10;
  if (academicHits < 2 && wordCount >= 100) weaknesses += 12;
  if (sentences.length <= 2 && wordCount >= 80) weaknesses += 8;
  weaknesses = Math.max(weaknesses - Math.floor(strengths / 8), 12);

  strengths = clampScore(strengths);
  weaknesses = clampScore(weaknesses);

  const overall = clampScore(
    strengths * 0.65 + (100 - weaknesses) * 0.35,
  );

  return { strengths, weaknesses, overall };
}

export function parseAreaScores(
  value: unknown,
  fallback: AreaScores,
): AreaScores {
  if (!value || typeof value !== "object") return fallback;
  const obj = value as Record<string, unknown>;
  const strengths =
    typeof obj.strengths === "number" ? obj.strengths : fallback.strengths;
  const weaknesses =
    typeof obj.weaknesses === "number" ? obj.weaknesses : fallback.weaknesses;
  const overall =
    typeof obj.overall === "number"
      ? obj.overall
      : clampScore(strengths * 0.65 + (100 - weaknesses) * 0.35);
  return {
    strengths: clampScore(strengths),
    weaknesses: clampScore(weaknesses),
    overall: clampScore(overall),
  };
}

export function stripReviewMarks(html: string) {
  return String(html || "")
    .replace(
      /<span\b[^>]*class="[^"]*review-flag-badge[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
      "",
    )
    .replace(/<\/?mark\b[^>]*>/gi, "");
}

function snapToWord(text: string, index: number, prefer: "start" | "end") {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  if (/\s/.test(text[index] || "")) return index;
  if (prefer === "start") {
    const prev = text.lastIndexOf(" ", index);
    return prev === -1 ? index : prev + 1;
  }
  const next = text.indexOf(" ", index);
  return next === -1 ? text.length : next;
}

function splitSentences(plain: string): string[] {
  return plain
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

/** Score a sentence for weakness signals (higher = more issue-like). */
function sentenceIssueScore(sentence: string): number {
  let score = 0;
  const lower = sentence.toLowerCase();
  const words = sentence.split(/\s+/).filter(Boolean);

  if (words.length > 35) score += 3;
  if (words.length > 50) score += 2;
  if (words.length < 8) score += 2;

  const vague =
    lower.match(
      /\b(very|really|thing|stuff|a lot|interesting|important|good|bad|nice|maybe|somewhat|various|etc)\b/g,
    ) || [];
  score += Math.min(6, vague.length * 2);

  if (
    /\b(however|but|although|despite|nevertheless|unfortunately|limited|lack|unclear|insufficient|weak|missing|fail|cannot|unable)\b/i.test(
      sentence,
    )
  ) {
    score += 4;
  }

  if (
    /\b(should|need to|must|could be|would benefit|recommend|suggest|improve|clarify|expand|strengthen|further research)\b/i.test(
      sentence,
    )
  ) {
    score += 3;
  }

  if (!/\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|et al\./i.test(sentence) && words.length > 18) {
    score += 2;
  }

  if (
    /\b(this study|this paper|we argue|findings (show|indicate|suggest)|results (show|indicate))\b/i.test(
      sentence,
    )
  ) {
    score -= 2;
  }

  return score;
}

/**
 * Produce Weakness and missing-citation excerpts across the document.
 * Strengths are not highlighted.
 */
export function pickFallbackHighlightQuotes(
  plainText: string,
): ReviewTextHighlights {
  const plain = normalizeWhitespace(plainText);
  if (plain.length < 24) {
    return { strengths: [], weaknesses: [], citations: [] };
  }

  const sentences = splitSentences(plain);

  if (sentences.length === 0) {
    const len = plain.length;
    let t1 = snapToWord(plain, Math.floor(len / 2), "end");
    if (t1 < 12) t1 = Math.floor(len / 2);
    return {
      strengths: [],
      weaknesses: [plain.slice(0, t1).trim()].filter((s) => s.length >= 8),
      citations: [],
    };
  }

  const ranked = sentences.map((sentence, index) => ({
    sentence: sentence.slice(0, 280),
    index,
    issue: sentenceIssueScore(sentence),
  }));

  const weaknessCandidates = [...ranked]
    .filter(
      (r) => r.issue >= 3 || r.index >= Math.floor(sentences.length * 0.2),
    )
    .sort((a, b) => b.issue - a.issue || a.index - b.index);

  const weaknesses: string[] = [];
  const used = new Set<number>();
  for (const item of weaknessCandidates) {
    if (weaknesses.length >= 8) break;
    if (used.has(item.index)) continue;
    weaknesses.push(item.sentence);
    used.add(item.index);
  }

  if (weaknesses.length === 0 && sentences.length >= 1) {
    const mid = sentences[Math.floor(sentences.length / 2)];
    if (mid) weaknesses.push(mid.slice(0, 280));
  }

  const citations = pickFallbackCitationQuotes(plain, used);

  return { strengths: [], weaknesses, citations };
}

/**
 * Find claim-like sentences that lack an in-text citation
 * (Author, Year) / [n] / et al.
 */
export function pickFallbackCitationQuotes(
  plainText: string,
  alreadyUsed: Set<number> = new Set(),
): string[] {
  const plain = normalizeWhitespace(plainText);
  const sentences = splitSentences(plain);
  if (sentences.length === 0) return [];

  const hasCitation = (sentence: string) =>
    /\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|\bet al\./i.test(sentence);

  const looksLikeClaim = (sentence: string) =>
    /\b(studies?|research|evidence|findings?|results?|literature|scholars?|authors?|data|statistics?|percent|%|significant|demonstrat\w+|show(?:s|ed|ing)?|indicat\w+|suggest\w+|report\w+|found that|according to|it is (?:known|clear|evident)|has been (?:shown|argued|reported))\b/i.test(
      sentence,
    ) || /\b\d{2,}\b/.test(sentence);

  const ranked = sentences
    .map((sentence, index) => ({
      sentence: sentence.slice(0, 280),
      index,
      score:
        (!hasCitation(sentence) ? 4 : 0) +
        (looksLikeClaim(sentence) ? 5 : 0) +
        (sentence.split(/\s+/).length > 16 ? 1 : 0),
    }))
    .filter((r) => !alreadyUsed.has(r.index) && !hasCitation(r.sentence) && r.score >= 5)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const citations: string[] = [];
  for (const item of ranked) {
    if (citations.length >= 8) break;
    citations.push(item.sentence);
    alreadyUsed.add(item.index);
  }
  return citations;
}

/**
 * Merge quote sets, preferring Weaknesses and Citations coverage.
 * Strength quotes are dropped (not highlighted).
 */
export function mergeHighlightQuotes(
  primary: ReviewTextHighlights | null | undefined,
  secondary: ReviewTextHighlights,
): ReviewTextHighlights {
  const uniq = (items: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = normalizeWhitespace(item).toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  return {
    strengths: [],
    weaknesses: uniq([
      ...(primary?.weaknesses || []),
      ...(secondary.weaknesses || []),
    ]).slice(0, 10),
    citations: uniq([
      ...(primary?.citations || []),
      ...(secondary.citations || []),
    ]).slice(0, 10),
  };
}
