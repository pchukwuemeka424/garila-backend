import { htmlToPlainText, repairGluedSpaces } from "./repair-text.js";
import { normalizeEditorHtml } from "./normalize-editor-html.js";

export type DocumentSection = {
  title: string;
  content: string;
};

/**
 * Top-level academic headings only (create a page).
 * Subheadings like 1.1 Background, Statement of the Problem, etc. stay inside the parent page.
 */
const MAIN_HEADING_DEFS: { pattern: RegExp; title?: string }[] = [
  { pattern: /^abstract\b/i, title: "Abstract" },
  { pattern: /^key\s*words?\b/i, title: "Keywords" },
  { pattern: /^dedication\b/i, title: "Dedication" },
  { pattern: /^acknowledg(?:e)?ments?\b/i, title: "Acknowledgements" },
  { pattern: /^table of contents\b/i, title: "Table of Contents" },
  { pattern: /^list of (?:tables|figures|abbreviations|plates)\b/i, title: "List of Tables/Figures" },
  // Prefer the document's own chapter heading text (no forced "Chapter One")
  { pattern: /^chapter\s+(?:one|1|[ivxlcdm]+|\d+)\b/i },
  { pattern: /^chapter\b/i },
  { pattern: /^introduction\b/i, title: "Introduction" },
  { pattern: /^literature review\b/i, title: "Literature Review" },
  { pattern: /^(?:research\s+)?methodology\b/i, title: "Methodology" },
  { pattern: /^materials and methods\b/i, title: "Materials and Methods" },
  { pattern: /^results(?:\s+and\s+discussion)?\b/i, title: "Results" },
  { pattern: /^findings(?:\s+and\s+discussion)?\b/i, title: "Findings" },
  { pattern: /^discussion\b/i, title: "Discussion" },
  {
    pattern: /^conclusions?(?:\s+and\s+recommendations?)?\b/i,
    title: "Conclusion",
  },
  { pattern: /^recommendations?\b/i, title: "Recommendations" },
  { pattern: /^references\b/i, title: "References" },
  { pattern: /^bibliography\b/i, title: "Bibliography" },
  { pattern: /^works cited\b/i, title: "Works Cited" },
  { pattern: /^appendix(?:es|ices)?(?:\s+[a-z0-9]+)?\b/i, title: "Appendix" },
];

/** Patterns that look like subheadings — never start a new page. */
const SUBHEADING_RE =
  /^(?:\d+\.\d+(?:\.\d+)*|[a-z]\.\d+|\([a-z0-9]+\)|[ivxlcdm]+\.|\d+\.\s+[a-z])/i;

function isBodyStartTitle(title: string) {
  return (
    /^(?:abstract|keywords?|introduction)\b/i.test(title) ||
    /^chapter\s+(?:one|1)\b/i.test(title)
  );
}

function normalizeHeadingLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/^[\s•\-–—*]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns the document's heading text when it matches a main academic heading.
 * Chapter lines keep the student's wording (e.g. "CHAPTER ONE: INTRODUCTION").
 */
export function matchMainHeading(rawLine: string): string | null {
  const line = normalizeHeadingLine(rawLine);
  if (!line || line.length > 100) return null;
  if (SUBHEADING_RE.test(line)) return null;

  const withoutNumberPrefix = line.replace(/^\d+\.\s+/, "");

  for (const def of MAIN_HEADING_DEFS) {
    if (def.pattern.test(line) || def.pattern.test(withoutNumberPrefix)) {
      // Always prefer the document's own wording for chapter / freeform headings
      if (!def.title || /^chapter\b/i.test(line) || /^chapter\b/i.test(withoutNumberPrefix)) {
        return line.slice(0, 200);
      }
      return def.title;
    }
  }
  return null;
}

/**
 * Split by HTML <h1>/<h2> that match MAIN academic headings.
 * Subheadings (h2/h3 that are not main) stay inside the parent page content
 * so bold/heading formatting is preserved in the editor.
 */
export function splitByHtmlHeadings(html: string): DocumentSection[] {
  if (!/<h[12][\s>]/i.test(html)) return [];

  const parts = html.split(/(?=<h[12][\s>])/i).filter((p) => p.trim());
  const starts: { title: string; htmlChunk: string }[] = [];
  let preamble = "";

  for (const part of parts) {
    const titleMatch = part.match(/<h([12])[^>]*>([\s\S]*?)<\/h\1>/i);
    if (!titleMatch) {
      preamble += part;
      continue;
    }
    const rawTitle = stripTags(titleMatch[2]).replace(/\s+/g, " ").trim();
    const title = matchMainHeading(rawTitle);
    if (!title) {
      // Subheading block — fold into previous section or preamble
      if (starts.length > 0) {
        starts[starts.length - 1].htmlChunk += part;
      } else {
        preamble += part;
      }
      continue;
    }
    const level = titleMatch[1];
    const contentHtml = part.replace(
      new RegExp(`<h${level}[^>]*>[\\s\\S]*?<\\/h${level}>`, "i"),
      "",
    );
    starts.push({
      title,
      htmlChunk: starts.length === 0 ? preamble + contentHtml : contentHtml,
    });
    preamble = "";
  }

  return dedupeSectionsByTitle(
    starts.map((s) => ({
      title: s.title.slice(0, 200),
      content: htmlBodyToEditorContent(s.htmlChunk),
    })),
  );
}

function htmlBodyToEditorContent(htmlBody: string): string {
  const trimmed = htmlBody.trim();
  if (!trimmed) return "";
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return normalizeEditorHtml(trimmed).slice(0, 500_000);
  }
  return htmlToPlainText(trimmed)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 500_000);
}

/**
 * Replace plain-text section bodies with HTML slices from the original
 * document so headings (<h2>/<h3>) and bold (<strong>) survive import.
 */
export function hydrateSectionsWithHtml(
  sections: DocumentSection[],
  html: string,
): DocumentSection[] {
  if (!sections.length || !html || !/<[a-z][\s\S]*>/i.test(html)) {
    return sections;
  }

  const markers = findTitleMarkers(html, sections.map((s) => s.title));
  if (markers.length === 0) {
    // Still normalize any section that already has HTML
    return sections.map((s) => ({
      ...s,
      content: /<[a-z][\s\S]*>/i.test(s.content)
        ? normalizeEditorHtml(s.content).slice(0, 500_000)
        : s.content,
    }));
  }

  return sections.map((section, index) => {
    const marker = markers.find((m) => m.sectionIndex === index);
    if (!marker) return section;

    const next = markers.find((m) => m.sectionIndex > index);
    const from = marker.contentStart;
    const to = next ? next.markerStart : html.length;
    const slice = html.slice(from, to).trim();
    if (!slice || slice.length < 20) return section;

    return {
      ...section,
      content: htmlBodyToEditorContent(slice),
    };
  });
}

function findTitleMarkers(
  html: string,
  titles: string[],
): { sectionIndex: number; markerStart: number; contentStart: number }[] {
  const markers: {
    sectionIndex: number;
    markerStart: number;
    contentStart: number;
  }[] = [];
  let searchFrom = 0;

  titles.forEach((title, sectionIndex) => {
    const needle = normalizeHeadingLine(title).toLowerCase();
    if (!needle) return;

    const found = locateTitleInHtml(html, needle, searchFrom);
    if (!found) return;

    markers.push({
      sectionIndex,
      markerStart: found.markerStart,
      contentStart: found.contentStart,
    });
    searchFrom = found.contentStart;
  });

  return markers;
}

function locateTitleInHtml(
  html: string,
  needle: string,
  searchFrom: number,
): { markerStart: number; contentStart: number } | null {
  const window = html.slice(searchFrom);
  // Prefer explicit heading tags, then bold paragraphs, then any text node
  const patterns = [
    /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi,
    /<p[^>]*>\s*<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>\s*<\/p>/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(window)) !== null) {
      const inner = match[2] ?? match[1];
      const text = stripTags(inner).replace(/\s+/g, " ").trim().toLowerCase();
      if (!text) continue;
      if (text === needle || text.startsWith(needle) || needle.startsWith(text)) {
        const markerStart = searchFrom + match.index;
        return {
          markerStart,
          contentStart: markerStart + match[0].length,
        };
      }
    }
  }

  // Fallback: plain title text occurrence
  const plainIdx = window.toLowerCase().indexOf(needle);
  if (plainIdx >= 0) {
    const markerStart = searchFrom + plainIdx;
    // Skip to end of containing tag if possible
    const after = html.indexOf(">", markerStart + needle.length);
    return {
      markerStart,
      contentStart: after >= 0 ? after + 1 : markerStart + needle.length,
    };
  }

  return null;
}

/**
 * Split plain text on main heading lines only (Abstract, Keywords, Introduction…).
 * Starts from Abstract / Keywords / Introduction when present (skips title-page junk).
 */
export function splitByHeadingLines(text: string): DocumentSection[] {
  const lines = text.split("\n");
  const starts: { index: number; title: string }[] = [];

  let inToc = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = normalizeHeadingLine(lines[i]);
    // Table of contents lists every heading — skip until real body resumes
    if (/^table of contents\b/i.test(raw) || /^contents\b/i.test(raw)) {
      inToc = true;
      continue;
    }
    if (inToc) {
      // Leave TOC when we hit a real body start with following prose,
      // or a second Abstract/Introduction after the TOC block.
      const title = matchMainHeading(raw);
      if (
        title &&
        isBodyStartTitle(title) &&
        hasProseAfter(lines, i)
      ) {
        inToc = false;
      } else {
        continue;
      }
    }

    const title = matchMainHeading(lines[i]);
    if (!title) continue;

    // Avoid duplicate consecutive same heading
    const prev = starts[starts.length - 1];
    if (prev && prev.title.toLowerCase() === title.toLowerCase()) continue;

    starts.push({ index: i, title });
  }

  if (starts.length === 0) return [];

  // Capture starting from Abstract / Keywords / Introduction / first chapter
  let from = 0;
  const startAt = starts.findIndex((s) => isBodyStartTitle(s.title));
  if (startAt > 0) from = startAt;
  if (startAt < 0) {
    const firstChapter = starts.findIndex((s) => /^chapter\b/i.test(s.title));
    if (firstChapter > 0) from = firstChapter;
  }

  const used = starts.slice(from);
  const sections: DocumentSection[] = [];

  for (let i = 0; i < used.length; i++) {
    const start = used[i];
    const end = used[i + 1]?.index ?? lines.length;
    const body = lines
      .slice(start.index + 1, end)
      .join("\n")
      .trim();
    sections.push({
      title: start.title.slice(0, 200),
      content: repairGluedSpaces(body).slice(0, 500_000),
    });
  }

  return dedupeSectionsByTitle(sections);
}

/** True when the heading is followed by non-heading prose (not a TOC stub). */
function hasProseAfter(lines: string[], headingIndex: number) {
  for (let j = headingIndex + 1; j < Math.min(lines.length, headingIndex + 8); j++) {
    const line = normalizeHeadingLine(lines[j]);
    if (!line) continue;
    if (matchMainHeading(line)) return false;
    if (line.length > 40) return true;
  }
  return false;
}

/** Last-resort: chunk long text into numbered parts. */
export function splitIntoChunks(
  text: string,
  maxChars = 8_000,
): DocumentSection[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) {
    return [{ title: "Document", content: cleaned.slice(0, 500_000) }];
  }

  const paragraphs = cleaned.split(/\n\s*\n/);
  const sections: DocumentSection[] = [];
  let buffer = "";
  let part = 1;

  const flush = () => {
    if (!buffer.trim()) return;
    sections.push({
      title: `Part ${part}`,
      content: buffer.trim().slice(0, 500_000),
    });
    part += 1;
    buffer = "";
  };

  for (const para of paragraphs) {
    if ((buffer + "\n\n" + para).length > maxChars && buffer) flush();
    buffer = buffer ? `${buffer}\n\n${para}` : para;
  }
  flush();
  return sections;
}

function stripTags(html: string) {
  return htmlToPlainText(html);
}

/**
 * Collapse duplicate titles (common when TOC + body both match).
 * Keeps the occurrence with the most content, ordered by that body's position.
 */
export function dedupeSectionsByTitle(
  sections: DocumentSection[],
): DocumentSection[] {
  if (sections.length <= 1) return sections;

  const best = new Map<
    string,
    { section: DocumentSection; index: number }
  >();

  sections.forEach((section, index) => {
    const key = normalizeHeadingLine(section.title).toLowerCase();
    if (!key) return;
    const prev = best.get(key);
    const len = section.content.trim().length;
    if (!prev || len > prev.section.content.trim().length) {
      best.set(key, { section, index });
    }
  });

  return [...best.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ section }) => section);
}

/**
 * Drop empty/near-empty pages left over from table-of-contents lines.
 * Keeps at least one section when everything is thin.
 */
export function dropEmptyTocStubs(
  sections: DocumentSection[],
  minChars = 40,
): DocumentSection[] {
  const kept = sections.filter((s) => s.content.trim().length >= minChars);
  return kept.length > 0 ? kept : sections;
}

/**
 * Prefer HTML with real headings (preserves bold/h2/h3), then plain heading
 * lines hydrated from HTML, then chunking.
 * Never splits on subheadings (1.1, Background of the Study, etc.).
 * Dedupes titles so TOC + body do not create two "Findings" pages.
 */
export function splitDocumentLocally(
  text: string,
  html: string,
): DocumentSection[] {
  const finalize = (sections: DocumentSection[]) =>
    dropEmptyTocStubs(
      dedupeSectionsByTitle(hydrateSectionsWithHtml(sections, html)),
    );

  const fromHtml = splitByHtmlHeadings(html);
  if (fromHtml.length >= 2) return finalize(fromHtml);

  const fromLines = splitByHeadingLines(text);
  if (fromLines.length >= 2) return finalize(fromLines);

  if (fromHtml.length === 1) return finalize(fromHtml);
  if (fromLines.length === 1) return finalize(fromLines);

  return finalize(splitIntoChunks(text));
}

/**
 * Keep the full document on one page (used for assignment imports).
 * Prefers normalized HTML so headings/bold survive; falls back to plain text.
 * PDF imports already emit <h1>–<h3>; DOCX has bold promotion upstream.
 */
export function asSingleDocumentPage(
  text: string,
  html: string,
  title = "Assignment",
): DocumentSection[] {
  const fromHtml =
    html && /<[a-z][\s\S]*>/i.test(html)
      ? normalizeEditorHtml(html).slice(0, 500_000).trim()
      : "";
  const content =
    fromHtml ||
    repairGluedSpaces(String(text || "").trim()).slice(0, 500_000);
  if (!content) return [];
  return [{ title: title.slice(0, 200) || "Assignment", content }];
}
