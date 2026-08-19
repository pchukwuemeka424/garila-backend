import { extractDocx, type DocxExtractOptions } from "./docx.js";
import { extractPdf } from "./pdf.js";
import { ValidationError } from "../portal-errors.js";

export type SupportedUploadKind = "docx" | "pdf";

export function detectUploadKind(
  fileName: string,
  mimeType?: string,
): SupportedUploadKind {
  const name = fileName.toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
    return "docx";
  }
  if (name.endsWith(".pdf") || mime === "application/pdf") {
    return "pdf";
  }

  throw new ValidationError(
    "Only .docx Word documents and PDF files are supported",
  );
}

export async function extractUploadedDocument(
  kind: SupportedUploadKind,
  buffer: Buffer,
  options: DocxExtractOptions = {},
): Promise<{ text: string; html: string }> {
  if (kind === "docx") return extractDocx(buffer, options);
  return extractPdf(buffer);
}
