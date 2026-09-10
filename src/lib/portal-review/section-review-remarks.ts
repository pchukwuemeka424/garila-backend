/**
 * Split a submission into sections and explain Strength / Weakness /
 * Needs citation / Wrong claim / Missing for each one.
 */

import {
  isHeadingOrHeaderLine,
  isReferenceEntryLine,
  type FactCheckAuditReport,
} from "./fact-check-citations.js";
import type { ReviewTextHighlights } from "./apply-highlights.js";

export type DocumentSection = {
  title: string;
  text: string;
};

export type SectionReviewNote = {
  title: string;
  strength: string;
  weakness: string;
  needsCitation: string;
  wrongClaim: string;
  missing: string;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function htmlOrTextToLines(htmlOrText: string): string[] {
  return String(htmlOrText || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<(h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .filter(Boolean);
}

function looksLikeHeading(line: string): boolean {
  if (isReferenceEntryLine(line)) return false;
  if (/^(references|bibliography|works cited)$/i.test(line)) return true;
  return isHeadingOrHeaderLine(line) && line.split(/\s+/).length <= 10;
}

export function splitDocumentSections(htmlOrText: string): DocumentSection[] {
  const lines = htmlOrTextToLines(htmlOrText);
  if (lines.length === 0) return [];

  const grouped: DocumentSection[] = [];
  let current: DocumentSection | null = null;

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      if (current && current.text.trim()) grouped.push(current);
      current = { title: line.replace(/[:.]+$/, ""), text: "" };
      continue;
    }
    if (!current) {
      current = { title: "Opening", text: "" };
    }
    current.text += (current.text ? " " : "") + line;
  }
  if (current && (current.text.trim() || grouped.length === 0)) {
    grouped.push(current);
  }

  const withBody = grouped.filter((s) => s.text.trim().length >= 20);
  if (withBody.length >= 2) return withBody;

  const plain = normalizeWhitespace(lines.join(" "));
  if (plain.length < 40) {
    return [{ title: "Submission", text: plain }];
  }

  const words = plain.split(" ").filter(Boolean);
  const third = Math.max(40, Math.floor(words.length / 3));
  return [
    { title: "Opening / introduction", text: words.slice(0, third).join(" ") },
    {
      title: "Main body",
      text: words.slice(third, Math.max(third * 2, words.length - third)).join(" "),
    },
    {
      title: "Closing / conclusion",
      text: words.slice(Math.max(third * 2, words.length - third)).join(" "),
    },
  ].filter((s) => s.text.trim().length >= 20);
}

function quoteInSection(sectionText: string, quote: string): boolean {
  const hay = sectionText.toLowerCase();
  const needle = normalizeWhitespace(quote).toLowerCase().slice(0, 80);
  return needle.length >= 12 && hay.includes(needle);
}

function explainQuotes(
  quotes: string[],
  empty: string,
  lead: string,
): string {
  const unique = quotes
    .map((q) => normalizeWhitespace(q))
    .filter(Boolean)
    .slice(0, 2);
  if (unique.length === 0) return empty;
  const excerpts = unique.map((q) => `“${q.slice(0, 160)}${q.length > 160 ? "…" : ""}”`);
  return `${lead} ${excerpts.join(" ")}`;
}

function claimExplanation(
  claims: FactCheckAuditReport["claims"] | undefined,
  sectionText: string,
  status: string[],
): string | null {
  const hits = (claims || []).filter(
    (c) =>
      status.includes(c.status) &&
      quoteInSection(sectionText, c.sentence) &&
      c.explanation,
  );
  if (hits.length === 0) return null;
  return hits[0]!.explanation;
}

export function buildSectionReviewNotes(opts: {
  htmlOrText: string;
  quotes: ReviewTextHighlights;
  factCheck?: FactCheckAuditReport | null;
  missingRequirements?: string[];
  strengths?: string[];
  weaknesses?: string[];
}): SectionReviewNote[] {
  const sections = splitDocumentSections(opts.htmlOrText);
  const quotes = opts.quotes || {};
  const missing = (opts.missingRequirements || []).filter(Boolean);
  const notes: SectionReviewNote[] = [];

  for (const section of sections) {
    const strengthQuotes = (quotes.strengths || []).filter((q) =>
      quoteInSection(section.text, q),
    );
    const weaknessQuotes = (quotes.weaknesses || []).filter((q) =>
      quoteInSection(section.text, q),
    );
    const citationQuotes = (quotes.citations || []).filter((q) =>
      quoteInSection(section.text, q),
    );
    const wrongQuotes = (quotes.wrongClaims || []).filter((q) =>
      quoteInSection(section.text, q),
    );

    const wordCount = section.text.split(/\s+/).filter(Boolean).length;
    const isRefs = /referenc|bibliograph|works cited/i.test(section.title);
    const isOpen = /open|intro/i.test(section.title);
    const isClose = /clos|conclu/i.test(section.title);

    let missingNote = "No required element is clearly missing from this section.";
    if (isRefs) {
      const unlinked = opts.factCheck?.unlinkedReferencesCount || 0;
      missingNote =
        unlinked > 0
          ? `${unlinked} reference(s) appear in the list but are not cited in the body.`
          : wordCount < 12
            ? "A complete reference list is missing or too thin for the claims made in the body."
            : "Reference list is present; check that every in-text citation has a matching entry.";
    } else if (wordCount < 40) {
      missingNote = `This section is under-developed (${wordCount} words) and needs more explanation, evidence, and structure.`;
    } else if (isOpen && missing.length > 0) {
      missingNote = `Check whether the opening sets up: ${missing.slice(0, 2).join("; ")}.`;
    } else if (isClose && missing.length > 0) {
      missingNote =
        "The closing does not clearly resolve the brief; required elements still appear incomplete.";
    } else if (citationQuotes.length > 0 || wrongQuotes.length > 0) {
      missingNote =
        "Evidence and sourcing in this section are incomplete — add citations and correct overstated claims.";
    }

    if (isRefs) {
      notes.push({
        title: section.title,
        strength:
          wordCount >= 20
            ? "A reference list is present and can support the body if citations are aligned."
            : "No clear bibliographic strength — the list is too thin or incomplete.",
        weakness:
          wordCount < 20
            ? "The reference list is too brief to support the claims made in the body."
            : "Check formatting, years, and that every body citation has a matching entry.",
        needsCitation:
          "Reference entries are not body claims. Confirm each in-text citation has a matching list entry.",
        wrongClaim:
          "No body-text claims belong in the reference list. Flag wrong claims in the essay body instead.",
        missing: missingNote,
      });
      continue;
    }

    const citationExtra = claimExplanation(
      opts.factCheck?.claims,
      section.text,
      ["needs_citation"],
    );
    const wrongExtra = claimExplanation(opts.factCheck?.claims, section.text, [
      "wrong_claim",
      "mismatched_citation",
    ]);

    notes.push({
      title: section.title,
      strength: explainQuotes(
        strengthQuotes,
        wordCount >= 80 && strengthQuotes.length === 0
          ? "No standout academic passage was marked as a strength in this section."
          : "No clear strength was identified here — develop a more precise, evidence-based point.",
        "Strong academic passage:",
      ),
      weakness: explainQuotes(
        weaknessQuotes,
        wordCount < 40
          ? "The section is too brief to demonstrate analysis, structure, or coverage of the brief."
          : "No specific wording was flagged as a weakness; still check depth of argument and clarity.",
        "Weak or under-developed wording:",
      ),
      needsCitation: explainQuotes(
        citationQuotes,
        citationExtra ||
          "No unmarked factual claim needing an in-text citation was found in this section.",
        "Needs an in-text citation:",
      ),
      wrongClaim: explainQuotes(
        wrongQuotes,
        wrongExtra || "No wrong or mismatched claim was flagged in this section.",
        "Wrong or unverified claim:",
      ),
      missing: missingNote,
    });
  }

  if (missing.length > 0) {
    notes.push({
      title: "Missing from the submission",
      strength: "Not applicable — these items were not found in the work.",
      weakness: `The brief still requires: ${missing.join("; ")}.`,
      needsCitation:
        "Where these missing items are added, support them with in-text citations and matching references.",
      wrongClaim:
        "Do not invent sources or findings to cover the missing items; leave a gap rather than an unsupported claim.",
      missing: `Must-include items still outstanding: ${missing.join("; ")}.`,
    });
  }

  return notes;
}

export function formatSectionReviewRemarks(
  notes: SectionReviewNote[],
  overall?: string,
): string {
  const blocks: string[] = [];
  if (overall?.trim()) blocks.push(overall.trim());
  if (notes.length === 0) return blocks.join("\n\n");

  blocks.push("Section-by-section review");
  for (const note of notes) {
    blocks.push(
      [
        note.title,
        `Strength: ${note.strength}`,
        `Weakness: ${note.weakness}`,
        `Needs citation: ${note.needsCitation}`,
        `Wrong claim: ${note.wrongClaim}`,
        `Missing: ${note.missing}`,
      ].join("\n\n"),
    );
  }
  return blocks.join("\n\n").trim();
}

export function formatCompactAnnotationSummary(opts: {
  notes: SectionReviewNote[];
  quotes: ReviewTextHighlights;
  missingRequirements?: string[];
}): string {
  const n = opts.notes.filter(
    (s) => !/missing from the submission/i.test(s.title),
  );
  const lines = [
    `Strength: ${n.filter((s) => !/^no /i.test(s.strength)).length || 0} section(s) with a marked strength.`,
    `Weakness: ${opts.quotes.weaknesses?.length || 0} passage(s) need development.`,
    `Needs citation: ${opts.quotes.citations?.length || 0} claim(s) unmarked.`,
    `Wrong claim: ${opts.quotes.wrongClaims?.length || 0} flagged.`,
  ];
  const missing = (opts.missingRequirements || []).filter(Boolean);
  if (missing.length > 0) {
    lines.push(`Missing: ${missing.slice(0, 3).join("; ")}.`);
  }
  return lines.join(" ");
}
