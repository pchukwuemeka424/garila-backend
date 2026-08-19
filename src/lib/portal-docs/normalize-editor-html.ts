import { repairGluedSpaces } from "./repair-text.js";

/**
 * Normalize imported / stored HTML for the document editor:
 * - force justified paragraphs (strip Word/PDF center/left/right)
 * - remove narrow width constraints that make content look “half”
 * - repair glued words in text nodes
 * - collapse hard line-breaks inside paragraphs into spaces
 * - keep tables / images / figures usable in TipTap
 */
export function normalizeEditorHtml(html: string): string {
  const trimmed = String(html || "").trim();
  if (!trimmed) return "";

  let out = trimmed;

  // Drop XML declarations / Word namespaces noise
  out = out.replace(/<\?xml[\s\S]*?\?>/gi, "");

  // Remove alignment attributes that fight justify (not on tables)
  out = out.replace(/\s+align\s*=\s*["'][^"']*["']/gi, "");

  // Strip text-align / narrow widths from inline styles; keep table layout hints
  out = out.replace(/\s*style\s*=\s*(["'])([\s\S]*?)\1/gi, (_m, q, style: string) => {
    let next = String(style)
      .replace(/text-align\s*:\s*[^;]+;?/gi, "")
      .replace(/width\s*:\s*[^;]+;?/gi, "")
      .replace(/max-width\s*:\s*[^;]+;?/gi, "")
      .replace(/min-width\s*:\s*[^;]+;?/gi, "")
      .replace(/margin-left\s*:\s*auto;?/gi, "")
      .replace(/margin-right\s*:\s*auto;?/gi, "")
      .replace(/;\s*;/g, ";")
      .replace(/^\s*;\s*|\s*;\s*$/g, "")
      .trim();
    if (!next) return "";
    return ` style=${q}${next}${q}`;
  });

  // Remove empty style attrs left behind
  out = out.replace(/\s+style=(["'])\s*\1/gi, "");

  // Unwrap common narrow wrappers (not tables)
  out = out.replace(
    /<(div|span|section|article)([^>]*)>/gi,
    (_m, tag: string, attrs: string) => {
      const cleaned = attrs
        .replace(/\s+align\s*=\s*["'][^"']*["']/gi, "")
        .replace(/\s+width\s*=\s*["'][^"']*["']/gi, "");
      return `<${tag}${cleaned}>`;
    },
  );

  // Soft breaks → spaces so lines reflow for justify (not inside <pre>)
  out = out.replace(/<br\s*\/?>/gi, " ");

  // Repair glued text between tags (skip attribute text — only node text)
  out = out.replace(/(^|>)([^<]*)/g, (_m, open: string, text: string) => {
    return open + repairGluedSpaces(decodeBasicEntities(text));
  });

  // Collapse leftover whitespace in text nodes
  out = out.replace(/(^|>)([^<]*)/g, (_m, open: string, text: string) => {
    return open + text.replace(/[^\S\n]{2,}/g, " ");
  });

  // Ensure images have the editor class (TipTap Image + CSS)
  out = out.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    let next = attrs;
    if (!/\bclass\s*=/i.test(next)) {
      next += ` class="document-editor-image"`;
    } else if (!/document-editor-image/i.test(next)) {
      next = next.replace(
        /\bclass\s*=\s*(["'])(.*?)\1/i,
        (_cm, q, cls) => `class=${q}${cls} document-editor-image${q}`,
      );
    }
    return `<img${next}>`;
  });

  // TipTap table schema expects <th> in header rows when possible
  out = promoteHeaderCells(out);

  // Mark tables for CSS
  out = out.replace(/<table\b([^>]*)>/gi, (_m, attrs: string) => {
    let next = attrs;
    if (!/\bclass\s*=/i.test(next)) {
      next += ` class="document-editor-table"`;
    } else if (!/document-editor-table/i.test(next)) {
      next = next.replace(
        /\bclass\s*=\s*(["'])(.*?)\1/i,
        (_cm, q, cls) => `class=${q}${cls} document-editor-table${q}`,
      );
    }
    return `<table${next}>`;
  });

  // Ensure block paragraphs exist for plain-ish runs
  if (!/<[a-z][\s\S]*>/i.test(out)) {
    out = out
      .split(/\n{2,}/)
      .map((block) => `<p style="text-align: justify">${escapeHtml(block.trim())}</p>`)
      .filter((p) => p !== '<p style="text-align: justify"></p>')
      .join("");
  } else {
    // Stamp justify on paragraphs that TipTap will parse
    out = out.replace(/<p(\s[^>]*)?>/gi, (_m, attrs = "") => {
      const cleaned = String(attrs).replace(/\s+style=(["'])([\s\S]*?)\1/i, "");
      return `<p${cleaned} style="text-align: justify">`;
    });
  }

  return out;
}

/** First row of each table: convert <td> → <th> when not already headers. */
function promoteHeaderCells(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    if (/<th\b/i.test(table)) return table;
    let rowIndex = 0;
    return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
      rowIndex += 1;
      if (rowIndex !== 1) return row;
      return row
        .replace(/<td\b/gi, "<th")
        .replace(/<\/td>/gi, "</th>");
    });
  });
}

function decodeBasicEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
