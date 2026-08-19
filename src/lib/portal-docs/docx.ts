/**
 * Extract plain text and heading-aware HTML from a .docx buffer.
 * Tables become <table>; images/graphs (as pictures) are stored via saveImage.
 */
import { randomUUID } from "node:crypto";
import mammoth from "mammoth";
import { normalizeEditorHtml } from "./normalize-editor-html.js";
import { promoteBoldParagraphsToHeadings } from "./promote-headings.js";
import { repairGluedSpaces } from "./repair-text.js";

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "b => strong",
  "i => em",
];

const WEB_IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export type DocxImageSaver = (input: {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  altText?: string;
}) => Promise<{ url: string } | null>;

export type DocxExtractOptions = {
  /** Persist embedded images/graphs and return a durable public URL. */
  saveImage?: DocxImageSaver;
};

export async function extractDocx(
  buffer: Buffer,
  options: DocxExtractOptions = {},
): Promise<{
  text: string;
  html: string;
}> {
  let imageIndex = 0;

  const convertImage = mammoth.images.imgElement(async (element) => {
    const contentType = normalizeContentType(element.contentType);
    const ext = WEB_IMAGE_TYPES[contentType];
    if (!ext) {
      // EMF/WMF/OLE chart binaries are not browser-renderable
      return { src: "" };
    }

    const bytes = Buffer.from(await element.read());
    if (!bytes.length) return { src: "" };

    imageIndex += 1;
    const altText =
      (element as { altText?: string }).altText?.trim() ||
      `Figure ${imageIndex}`;
    const fileName = `import-${imageIndex}${ext}`;

    if (options.saveImage) {
      const saved = await options.saveImage({
        buffer: bytes,
        contentType,
        fileName,
        altText,
      });
      if (saved?.url) {
        return {
          src: saved.url,
        };
      }
    }

    // Fallback for callers without storage (tests / preview)
    return {
      src: `data:${contentType};base64,${bytes.toString("base64")}`,
    };
  });

  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml(
      { buffer },
      {
        styleMap: STYLE_MAP,
        convertImage,
      },
    ),
  ]);

  const text = repairGluedSpaces(
    textResult.value.replace(/\r\n/g, "\n").trim(),
  );
  // Re-inject alt/class on imgs after mammoth (typed converter only allows src)
  const withImageAttrs = annotateImportedImages(
    stripBrokenImages(htmlResult.value.trim()),
  );
  const html = normalizeEditorHtml(
    promoteBoldParagraphsToHeadings(withImageAttrs),
  );

  if (!text && !html) {
    throw new Error("The Word document appears to be empty");
  }
  if (!text && html) {
    // Image/table-only docs: keep a plain-text stub for section detection
    return { text: htmlToRoughText(html), html };
  }

  return { text, html };
}

export function extForImageContentType(contentType: string): string | null {
  return WEB_IMAGE_TYPES[normalizeContentType(contentType)] ?? null;
}

/** Unique storage key helper for imported media. */
export function importedImageKey(
  tenantId: string,
  projectId: string,
  ext: string,
) {
  return `tenants/${tenantId}/projects/${projectId}/${randomUUID()}${ext}`;
}

function normalizeContentType(raw?: string) {
  const type = (raw || "image/png").toLowerCase().split(";")[0].trim();
  if (type === "image/jpg") return "image/jpeg";
  return type;
}

function stripBrokenImages(html: string) {
  return html.replace(/<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/gi, "");
}

function annotateImportedImages(html: string) {
  let n = 0;
  return html.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    n += 1;
    let next = attrs;
    if (!/\balt\s*=/i.test(next)) {
      next += ` alt="Figure ${n}"`;
    }
    if (!/\bclass\s*=/i.test(next)) {
      next += ` class="document-editor-image"`;
    }
    return `<img${next}>`;
  });
}

function htmlToRoughText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|tr|table|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
