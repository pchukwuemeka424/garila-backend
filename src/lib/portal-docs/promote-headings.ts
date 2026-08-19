import { matchMainHeading } from "./split-sections.js";

/**
 * Word often marks headings as Normal + Bold instead of Heading 1/2/3.
 * Mammoth then emits <p><strong>…</strong></p>. Promote those (and keep
 * real <h1>–<h3>) so the editor can show heading + bold structure.
 */
export function promoteBoldParagraphsToHeadings(html: string): string {
  if (!html) return html;

  return html.replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (full, _attrs, inner: string) => {
    const plain = stripTags(inner).replace(/\s+/g, " ").trim();
    if (!plain || plain.length > 120) return full;
    if (!isMostlyBold(inner, plain)) return full;
    if (!looksLikeHeading(plain)) return full;

    const level = headingLevelFor(plain);
    // Keep bold mark inside the heading so toolbar/state stay honest
    const body = ensureBoldWrapped(inner.trim(), plain);
    return `<h${level}>${body}</h${level}>`;
  });
}

/**
 * Promote short plain (non-bold) paragraphs that are clearly academic headings.
 * Used for PDF imports where pdf-parse has no bold/style marks.
 */
export function promotePlainParagraphsToHeadings(html: string): string {
  if (!html) return html;

  return html.replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (full, _attrs, inner: string) => {
    const plain = stripTags(inner).replace(/\s+/g, " ").trim();
    if (!plain || plain.length > 120) return full;
    if (/<(?:strong|b|em|i|u|a|img|table|br)[\s>]/i.test(inner)) return full;
    if (!looksLikeHeading(plain)) return full;
    // Stricter than bold path: require main / numbered / chapter-like labels
    if (
      !matchMainHeading(plain) &&
      !/^\d+\.\d+(?:\.\d+)*\b/.test(plain) &&
      !/^(?:chapter|section|part)\b/i.test(plain) &&
      !/^[A-Z0-9][A-Z0-9\s,:;'\"()\-/&]+$/.test(plain)
    ) {
      return full;
    }

    const level = headingLevelFor(plain);
    return `<h${level}><strong>${escapeHtml(plain)}</strong></h${level}>`;
  });
}

export function headingLevelFor(plain: string): 1 | 2 | 3 {
  if (matchMainHeading(plain)) return 1;
  // Numbered subheadings: 1.1, 2.3.1, etc.
  if (/^\d+\.\d+(?:\.\d+)*\b/.test(plain)) {
    const dots = (plain.match(/\./g) || []).length;
    return dots >= 2 ? 3 : 2;
  }
  // Short title-like lines → subheading
  if (plain.length <= 80) return 2;
  return 3;
}

export function looksLikeHeading(plain: string): boolean {
  if (matchMainHeading(plain)) return true;
  if (/^\d+\.\d+(?:\.\d+)*\b/.test(plain)) return true;
  if (/^(?:chapter|section|part)\b/i.test(plain)) return true;
  // Single short line, mostly letters, not a sentence
  if (plain.length > 90) return false;
  if (/[.!?]$/.test(plain)) return false;
  if ((plain.match(/\s+/g) || []).length > 12) return false;
  // Title Case or ALL CAPS academic labels
  if (/^[A-Z0-9][A-Z0-9\s,:;'\"()\-/&]+$/.test(plain) && plain.length <= 80) {
    return true;
  }
  const words = plain.split(/\s+/);
  const capped = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return words.length >= 1 && words.length <= 10 && capped / words.length >= 0.6;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when essentially all visible text sits inside <strong>/<b>. */
function isMostlyBold(inner: string, plain: string): boolean {
  if (!/<(?:strong|b)[\s>]/i.test(inner)) return false;

  // Strip non-bold tags; measure text that remains outside bold wrappers
  let boldText = "";
  const re = /<(?:strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/(?:strong|b)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    boldText += stripTags(m[1]);
  }
  const boldPlain = boldText.replace(/\s+/g, " ").trim();
  if (!boldPlain) return false;
  // At least ~85% of characters bold (allows a trailing colon outside bold)
  return boldPlain.length / Math.max(plain.length, 1) >= 0.85;
}

function ensureBoldWrapped(inner: string, plain: string): string {
  if (/^<(?:strong|b)[\s>]/i.test(inner) && /<\/(?:strong|b)>\s*$/i.test(inner)) {
    return inner;
  }
  if (isMostlyBold(inner, plain)) return inner;
  return `<strong>${inner}</strong>`;
}

function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
