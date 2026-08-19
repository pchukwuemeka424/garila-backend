/**
 * Extract plain text from a PDF buffer and build editor HTML with
 * heading tags (Abstract, Introduction, 1.1 …) for TipTap.
 * Import the lib entry directly to avoid pdf-parse's debug side-effect.
 */
import { PDFParse } from "pdf-parse";

import {
  headingLevelFor,
  looksLikeHeading,
} from "./promote-headings.js";
import { repairGluedSpaces } from "./repair-text.js";
import { matchMainHeading } from "./split-sections.js";

/** Main academic labels that often glue onto the following sentence in PDFs. */
const PEELABLE_MAIN_HEADING =
  "(?:abstract|key\\s*words?|dedication|acknowledg(?:e)?ments?|table of contents|list of (?:tables|figures|abbreviations|plates)|introduction|literature review|(?:research\\s+)?methodology|materials and methods|results(?:\\s+and\\s+discussion)?|findings(?:\\s+and\\s+discussion)?|discussion|conclusions?(?:\\s+and\\s+recommendations?)?|recommendations?|references|bibliography|works cited|appendix(?:es|ices)?(?:\\s+[a-z0-9]+)?)";

export async function extractPdf(buffer: Buffer): Promise<{
  text: string;
  html: string;
}> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let extracted = "";
  try {
    extracted = (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
  const text = repairGluedSpaces(
    String(extracted || "")
      .replace(/\r\n/g, "\n")
      .trim(),
  );

  if (!text) {
    throw new Error(
      "Could not extract text from this PDF. It may be scanned/image-only.",
    );
  }

  const html = pdfTextToEditorHtml(text);

  return { text, html };
}

/**
 * Turn PDF plain text into a single HTML document with <h1>–<h3> where
 * headings can be detected. Does not split into multiple pages.
 */
export function pdfTextToEditorHtml(text: string): string {
  const source = repairGluedSpaces(
    String(text || "")
      .replace(/\r\n/g, "\n")
      .trim(),
  );
  if (!source) return "";

  const normalized = peelInlineMainHeadings(source);
  const lines = normalized.split("\n");
  const out: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const body = para.join(" ").replace(/\s+/g, " ").trim();
    para = [];
    if (!body) return;
    out.push(`<p style="text-align: justify">${escapeHtml(body)}</p>`);
  };

  for (const raw of lines) {
    const line = raw.replace(/[^\S\n]+/g, " ").trim();
    if (!line) {
      flushPara();
      continue;
    }

    const heading = classifyPdfHeadingLine(line);
    if (heading) {
      flushPara();
      out.push(
        `<h${heading.level}><strong>${escapeHtml(heading.text)}</strong></h${heading.level}>`,
      );
      continue;
    }

    para.push(line);
  }
  flushPara();

  return out.join("\n");
}

/**
 * Insert newlines so main headings that were glued to adjacent prose
 * become their own lines (e.g. "…Science Introduction Artificial…" or
 * "Abstract Artificial intelligence…").
 */
function peelInlineMainHeadings(text: string): string {
  const token = PEELABLE_MAIN_HEADING;
  let result = text;

  // Mid-line: previous char + spaces + heading + body starting with a capital/digit
  const mid = new RegExp(
    `([^\\n])([ \\t]+)(${token})(?=\\s*[:.\\-–—]?\\s+[A-Z0-9])`,
    "gi",
  );
  result = result.replace(mid, "$1\n$3");

  return result
    .split("\n")
    .map((line) => peelLeadingMainHeading(line))
    .join("\n");
}

function peelLeadingMainHeading(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return line;

  const re = new RegExp(
    `^(${PEELABLE_MAIN_HEADING})\\b(?:\\s*[:.\\-–—]?\\s+)([A-Z0-9][\\s\\S]+)$`,
    "i",
  );
  const m = trimmed.match(re);
  if (!m) return line;

  const rest = m[2].trim();
  // Require real prose after the label (avoid "Abstract Overview")
  if (rest.length < 12 && (rest.match(/\s+/g) || []).length < 2) return line;

  const label = matchMainHeading(m[1]) || m[1].replace(/\s+/g, " ").trim();
  return `${label}\n${rest}`;
}

function classifyPdfHeadingLine(
  line: string,
): { level: 1 | 2 | 3; text: string } | null {
  const plain = line.replace(/\s+/g, " ").trim();
  if (!plain || plain.length > 120) return null;

  const main = matchMainHeading(plain);
  if (main) {
    // Accept when the line is essentially just that heading (or a chapter line)
    if (/^chapter\b/i.test(plain)) {
      if (!looksLikeHeading(plain) && plain.length > 100) return null;
      return { level: 1, text: plain };
    }
    const stripped = plain.replace(/[:.\-–—]+$/g, "").trim();
    const onlyHeading = new RegExp(
      `^${escapeRegExp(main)}(?:\\s*[:.\\-–—]*)?$`,
      "i",
    );
    const keywordLoose = /^key\s*words?\b/i.test(plain) && stripped.length <= 24;
    if (onlyHeading.test(stripped) || keywordLoose) {
      return { level: 1, text: main };
    }
    // Extra body still on the line — not a pure heading
    return null;
  }

  if (!looksLikeHeading(plain)) return null;

  // Numbered / ALL CAPS academic labels
  if (/^\d+\.\d+(?:\.\d+)*\b/.test(plain)) {
    return { level: headingLevelFor(plain), text: plain };
  }
  if (/^[A-Z0-9][A-Z0-9\s,:;'\"()\-/&]+$/.test(plain)) {
    return { level: headingLevelFor(plain), text: plain };
  }
  if (/^(?:chapter|section|part)\b/i.test(plain)) {
    return { level: headingLevelFor(plain), text: plain };
  }

  // Title-case lines need enough words so short keyword stubs stay paragraphs
  const words = plain.split(/\s+/);
  if (words.length >= 4 && words.length <= 12) {
    return { level: headingLevelFor(plain), text: plain };
  }
  return null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
