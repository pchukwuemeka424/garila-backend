import type { ChatMessage, IAIProvider } from "../portal-ai/provider.js";
import {
  dedupeSectionsByTitle,
  dropEmptyTocStubs,
  hydrateSectionsWithHtml,
  matchMainHeading,
  splitDocumentLocally,
  type DocumentSection,
} from "./split-sections.js";
import { repairGluedSpaces } from "./repair-text.js";
import { normalizeEditorHtml } from "./normalize-editor-html.js";

const SYSTEM_PROMPT = `You are a research writing assistant for a university thesis platform.
Split the student's document into ordered writing PAGES using MAIN HEADINGS only.

Return ONLY valid JSON:
{"sections":[{"title":"Abstract","content":"..."},{"title":"Keywords","content":"..."},{"title":"Introduction","content":"..."}]}

MAIN headings that may start a new page (use only these kinds):
- Abstract
- Keywords
- Dedication / Acknowledgements
- Table of Contents / List of Tables / List of Figures
- Introduction
- Chapter headings as written in the document (keep the student's exact title wording)
- Literature Review, Methodology, Results, Discussion, Conclusion
- References / Bibliography
- Appendix

CRITICAL RULES:
1. Start capturing FROM Abstract (or Keywords / Introduction / first chapter heading if Abstract is missing). Skip title page / cover content before that.
2. Do NOT create pages for subheadings (examples to keep INSIDE the parent page): 1.1 Background, 1.2 Statement of the Problem, Objectives, Research Questions, Theoretical Framework, Conceptual Framework, Sampling Technique, Data Analysis, etc.
3. Subheading text must remain inside the parent main-section content.
4. Preserve the student's wording for every page title; do not rewrite titles to "Chapter One", "Chapter Two", etc.
5. Keep document order.
6. Each title max 200 characters.
7. Do not invent content.
8. content may be plain text; formatting is restored from the original document separately.`;

/**
 * Ask the AI to split a document into main-heading pages.
 * Falls back to local heuristic splitting on failure.
 * Filters out any accidental subheading pages from AI output.
 */
export async function analyseDocumentIntoSections(
  provider: IAIProvider,
  text: string,
  html: string,
): Promise<{ sections: DocumentSection[]; method: "ai" | "heuristic" }> {
  const local = splitDocumentLocally(text, html);

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    return { sections: local, method: "heuristic" };
  }

  try {
    const excerpt = text.slice(0, 90_000);
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Split this document into MAIN-heading pages only (not subheadings). Start from Abstract if present.\n\n---\n${excerpt}\n---`,
      },
    ];

    const raw = await provider.complete(messages, { json: true });
    const parsed = JSON.parse(extractJson(raw)) as {
      sections?: Array<{ title?: string; content?: string }>;
    };

    const sections = (parsed.sections || [])
      .map((s) => {
        const rawTitle = String(s.title || "").trim();
        const title = matchMainHeading(rawTitle) || rawTitle;
        const rawContent = String(s.content || "").trim();
        // Keep HTML if returned; plain text is replaced from Word HTML below.
        const content = /<[a-z][\s\S]*>/i.test(rawContent)
          ? normalizeEditorHtml(rawContent).slice(0, 500_000)
          : normalizeEditorHtml(repairGluedSpaces(rawContent)).slice(0, 500_000);
        return {
          title: title.slice(0, 200),
          content,
        };
      })
      .filter((s) => s.title && s.content)
      .filter((s) => {
        const main = matchMainHeading(s.title);
        if (main) return true;
        return /^(chapter|abstract|keywords|introduction|literature|methodology|results|findings|discussion|conclusion|references|appendix)/i.test(
          s.title,
        );
      });

    if (sections.length >= 1) {
      return {
        sections: dropEmptyTocStubs(
          dedupeSectionsByTitle(
            hydrateSectionsWithHtml(dropPreAbstractNoise(sections), html),
          ),
        ),
        method: "ai",
      };
    }
  } catch (error) {
    console.warn("AI document split failed; using heuristic", error);
  }

  return {
    sections: dropEmptyTocStubs(dedupeSectionsByTitle(local)),
    method: "heuristic",
  };
}

function dropPreAbstractNoise(sections: DocumentSection[]): DocumentSection[] {
  const idx = sections.findIndex((s) =>
    /^(abstract|keywords|introduction|chapter\s+(?:one|1)\b)/i.test(s.title),
  );
  if (idx > 0) return sections.slice(idx);
  return sections;
}

function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
