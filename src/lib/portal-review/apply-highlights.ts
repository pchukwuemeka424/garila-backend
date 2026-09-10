import { isHeadingOrHeaderLine, isReferenceEntryLine } from "./fact-check-citations.js";

/** Highlight colours used in supervisor review annotations. */
export const REVIEW_HIGHLIGHT_COLORS = {
  strength: "#86efac",
  weakness: "#fde047",
  /** Claims / statements that need an in-text citation. */
  citation: "#fdba74",
  /** Contradictory, inaccurate, or unsubstantiated wrong claim. */
  wrongClaim: "#fca5a5",
} as const;

/** Short warning labels shown on highlighted sentences. */
export const REVIEW_HIGHLIGHT_LABELS = {
  strength: "Strength",
  weakness: "Weakness",
  citation: "Claim needs in-text citation",
  wrongClaim: "Wrong / unverified claim",
} as const;

export type ReviewHighlightKind = keyof typeof REVIEW_HIGHLIGHT_COLORS;

export type ReviewTextHighlights = {
  strengths?: string[];
  weaknesses?: string[];
  /** Passages that assert facts/claims without an in-text citation. */
  citations?: string[];
  wrongClaims?: string[];
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
    .filter((s) => s.length >= 15 && !isHeadingOrHeaderLine(s));
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
      /\b(very|really|thing|stuff|a lot|interesting|good|bad)\b/gi,
    ) || []
  ).length;

  let strengths = 45;
  if (wordCount >= 80) strengths += 10;
  if (wordCount >= 180) strengths += 10;
  if (wordCount >= 350) strengths += 8;
  strengths += Math.min(18, academicHits * 3);
  strengths += Math.min(12, citationHits * 4);
  strengths -= Math.min(14, vagueHits * 2);
  if (avgSentenceLen > 38) strengths -= 6;
  if (avgSentenceLen < 8 && wordCount > 40) strengths -= 8;

  let weaknesses = 20;
  if (wordCount < 60) weaknesses += 25;
  else if (wordCount < 120) weaknesses += 10;
  if (citationHits === 0 && wordCount >= 80) weaknesses += 15;
  weaknesses += Math.min(16, vagueHits * 3);
  if (avgSentenceLen > 40) weaknesses += 8;

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

function splitSentences(plain: string): string[] {
  return plain
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= 20 &&
        !isHeadingOrHeaderLine(s) &&
        !isReferenceEntryLine(s),
    );
}

function hasInTextCitation(sentence: string) {
  return /\((?:[^)]*\d{4}[^)]*)\)|\[\d+\]|\bet al\./i.test(sentence);
}

function sentenceIssueScore(sentence: string): number {
  if (isHeadingOrHeaderLine(sentence) || isReferenceEntryLine(sentence)) {
    return 0;
  }
  let score = 0;
  const lower = sentence.toLowerCase();
  const words = sentence.split(/\s+/).filter(Boolean);

  if (words.length > 45) score += 2;
  if (words.length < 6) score += 2;

  const vague =
    lower.match(
      /\b(very|really|thing|stuff|a lot|nice|maybe|somewhat|etc)\b/g,
    ) || [];
  score += Math.min(6, vague.length * 2);

  if (
    /\b(completely unproven|unsubstantiated|obviously true|without any doubt|everyone knows)\b/i.test(
      sentence,
    )
  ) {
    score += 5;
  }

  if (words.length < 10 && !hasInTextCitation(sentence)) score += 1;

  return score;
}

function sentenceStrengthScore(sentence: string): number {
  if (isHeadingOrHeaderLine(sentence) || isReferenceEntryLine(sentence)) {
    return 0;
  }
  let score = 0;
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length >= 12 && words.length <= 42) score += 3;
  if (hasInTextCitation(sentence)) score += 4;
  if (
    /\b(however|therefore|furthermore|moreover|consequently|in contrast|this suggests|the evidence|analysis|framework|hypothesis|argues that|demonstrates)\b/i.test(
      sentence,
    )
  ) {
    score += 3;
  }
  if (sentenceIssueScore(sentence) >= 4) score -= 5;
  return score;
}

function sentenceWrongClaimScore(sentence: string): number {
  if (isHeadingOrHeaderLine(sentence) || isReferenceEntryLine(sentence)) {
    return 0;
  }
  let score = 0;
  if (
    /\b(always|never|all|none|impossible|completely|without question|everyone knows|proves that|no exception|guarantee[sd]?)\b/i.test(
      sentence,
    )
  ) {
    score += 5;
  }
  if (/\b(100%|fails? less|superior to|the only way)\b/i.test(sentence)) {
    score += 4;
  }
  return score;
}

function takeRanked(
  items: Array<{ sentence: string; index: number; score: number }>,
  used: Set<number>,
  minScore: number,
  limit: number,
): string[] {
  const out: string[] = [];
  const ranked = [...items]
    .filter((r) => !used.has(r.index) && r.score >= minScore)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const item of ranked) {
    if (out.length >= limit) break;
    out.push(item.sentence);
    used.add(item.index);
  }
  return out;
}

/**
 * Produce selective Strength, Weakness, Needs-citation, and Wrong-claim excerpts.
 * Headings, titles, sub-headings, and reference list items are STRICTLY excluded.
 */
export function pickFallbackHighlightQuotes(
  plainText: string,
): ReviewTextHighlights {
  const plain = normalizeWhitespace(plainText);
  if (plain.length < 24) {
    return { strengths: [], weaknesses: [], citations: [], wrongClaims: [] };
  }

  const sentences = splitSentences(plain);
  if (sentences.length === 0) {
    return { strengths: [], weaknesses: [], citations: [], wrongClaims: [] };
  }

  const ranked = sentences.map((sentence, index) => ({
    sentence: sentence.slice(0, 280),
    index,
    issue: sentenceIssueScore(sentence),
    strength: sentenceStrengthScore(sentence),
    wrong: sentenceWrongClaimScore(sentence),
  }));

  const used = new Set<number>();
  const weaknesses = takeRanked(
    ranked.map((r) => ({
      sentence: r.sentence,
      index: r.index,
      score: r.issue,
    })),
    used,
    3,
    4,
  );
  const wrongClaims = takeRanked(
    ranked.map((r) => ({
      sentence: r.sentence,
      index: r.index,
      score: r.wrong,
    })),
    used,
    5,
    3,
  );
  const citations = pickFallbackCitationQuotes(plain, used);
  const strengths = takeRanked(
    ranked.map((r) => ({
      sentence: r.sentence,
      index: r.index,
      score: r.strength,
    })),
    used,
    5,
    3,
  );

  return { strengths, weaknesses, citations, wrongClaims };
}

export function hasReviewHighlightQuotes(
  quotes: ReviewTextHighlights | null | undefined,
): boolean {
  if (!quotes) return false;
  return (
    (quotes.weaknesses?.length || 0) +
      (quotes.citations?.length || 0) +
      (quotes.wrongClaims?.length || 0) +
      (quotes.strengths?.length || 0) >
    0
  );
}

export function quotesFromFactCheckClaims(
  claims:
    | Array<{ sentence?: string; status?: string }>
    | null
    | undefined,
): ReviewTextHighlights {
  const citations: string[] = [];
  const wrongClaims: string[] = [];
  for (const claim of claims || []) {
    const sentence = normalizeWhitespace(String(claim.sentence || "")).slice(
      0,
      280,
    );
    if (
      sentence.length < 8 ||
      isHeadingOrHeaderLine(sentence) ||
      isReferenceEntryLine(sentence)
    ) {
      continue;
    }
    if (claim.status === "needs_citation" && citations.length < 6) {
      citations.push(sentence);
    } else if (
      (claim.status === "wrong_claim" ||
        claim.status === "mismatched_citation") &&
      wrongClaims.length < 4
    ) {
      wrongClaims.push(sentence);
    }
  }
  return { strengths: [], weaknesses: [], citations, wrongClaims };
}

export function pickFallbackCitationQuotes(
  plainText: string,
  alreadyUsed: Set<number> = new Set(),
): string[] {
  const plain = normalizeWhitespace(plainText);
  const sentences = splitSentences(plain);
  if (sentences.length === 0) return [];

  const hasCitation = hasInTextCitation;

  const looksLikeEmpiricalOrTheoreticalClaim = (sentence: string) =>
    /\b(fail|compute|latency|throughput|performance|study|studies|experiment|survey|users?|students?|universit\w+|nigerian|african|platform|empirical|demonstrate|show|indicat\w+|prove|consensus|raft|paxos|partitioning|hashing|byzantine|cap theorem|replication|cost|minutes|hours)\b/i.test(
      sentence,
    ) || /\b\d{2,}\b/.test(sentence);

  const ranked = sentences
    .map((sentence, index) => ({
      sentence: sentence.slice(0, 280),
      index,
      score:
        (!hasCitation(sentence) ? 4 : 0) +
        (looksLikeEmpiricalOrTheoreticalClaim(sentence) ? 5 : 0) +
        (sentence.split(/\s+/).length > 12 ? 2 : 0),
    }))
    .filter(
      (r) =>
        !alreadyUsed.has(r.index) &&
        !hasCitation(r.sentence) &&
        !isHeadingOrHeaderLine(r.sentence) &&
        !isReferenceEntryLine(r.sentence) &&
        r.score >= 6,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const citations: string[] = [];
  for (const item of ranked) {
    if (citations.length >= 4) break;
    citations.push(item.sentence);
    alreadyUsed.add(item.index);
  }
  return citations;
}

export function mergeHighlightQuotes(
  primary: ReviewTextHighlights | null | undefined,
  secondary: ReviewTextHighlights,
): ReviewTextHighlights {
  const uniq = (items: string[]) => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (isHeadingOrHeaderLine(item) || isReferenceEntryLine(item)) continue;
      const key = normalizeWhitespace(item).toLowerCase().slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  return {
    strengths: uniq([
      ...(primary?.strengths || []),
      ...(secondary.strengths || []),
    ]).slice(0, 4),
    weaknesses: uniq([
      ...(primary?.weaknesses || []),
      ...(secondary.weaknesses || []),
    ]).slice(0, 4),
    citations: uniq([
      ...(primary?.citations || []),
      ...(secondary.citations || []),
    ]).slice(0, 6),
    wrongClaims: uniq([
      ...(primary?.wrongClaims || []),
      ...(secondary.wrongClaims || []),
    ]).slice(0, 4),
  };
}
