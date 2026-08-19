/**
 * Repair text where spaces were lost (common with PDF extraction and
 * HTML tag stripping between adjacent word runs).
 */
export function repairGluedSpaces(input: string): string {
  if (!input) return input;

  let text = input
    .replace(/\u00ad/g, "")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    // Space after punctuation when missing: ",especially" → ", especially"
    .replace(/([,.;:!?])([A-Za-z])/g, "$1 $2")
    // Space around parentheses when glued to words
    .replace(/([A-Za-z0-9])(\()/g, "$1 $2")
    .replace(/(\))([A-Za-z])/g, "$1 $2")
    // camelCase glue: "detectionIn" → "detection In"
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");

  const letters = text.replace(/\s/g, "").length;
  const spaceRatio = countSpaces(text) / Math.max(letters, 1);
  // Only segment broadly when spacing is clearly missing (normal prose is ~0.15–0.20).
  if (spaceRatio < 0.1 && /[a-z]{12,}/i.test(text)) {
    text = segmentGluedEnglish(text);
  } else {
    // Mixed PDF extracts often leave long glued runs inside otherwise-spaced prose.
    text = text.replace(/[A-Za-z]{18,}/g, (run) => {
      if (LEXICON_SET.has(run.toLowerCase())) return run;
      return splitGluedRun(run);
    });
  }

  return text.replace(/[^\S\n]{2,}/g, " ");
}

function countSpaces(text: string) {
  return (text.match(/ /g) || []).length;
}

/**
 * Longest-first academic/English tokens.
 * No 2-letter stubs (on/or/is/in…) — they split real words like
 * "educational" → "educati onal" and "supported" → "supp orted".
 */
const LEXICON = [
  "digitalisation",
  "digitalization",
  "intelligence",
  "artificial",
  "transforming",
  "institutions",
  "especially",
  "operational",
  "conventional",
  "assessment",
  "analytics",
  "financial",
  "detection",
  "inclusion",
  "misconduct",
  "auditing",
  "services",
  "research",
  "according",
  "therefore",
  "however",
  "although",
  "because",
  "between",
  "through",
  "without",
  "within",
  "against",
  "during",
  "before",
  "after",
  "about",
  "become",
  "integral",
  "improved",
  "nigeria",
  "systems",
  "methods",
  "analysis",
  "results",
  "findings",
  "products",
  "increasingly",
  "embedded",
  "consumer",
  "emerging",
  "economies",
  "decision",
  "making",
  "trust",
  "remain",
  "system",
  "method",
  "study",
  "their",
  "there",
  "these",
  "those",
  "which",
  "where",
  "while",
  "when",
  "with",
  "from",
  "that",
  "this",
  "have",
  "been",
  "will",
  "into",
  "than",
  "then",
  "also",
  "such",
  "using",
  "based",
  "rapid",
  "data",
  "risk",
  "fraud",
  "and",
  "the",
  "for",
  "are",
  "was",
  "were",
  "has",
  "had",
  "not",
  "but",
  "can",
  "may",
  "its",
  "how",
];

/** Min contiguous letters before we try to split a run. */
const MIN_GLUED_RUN = 5;

const LEXICON_SET = new Set(LEXICON.map((w) => w.toLowerCase()));

/**
 * Only touch long letter-runs. Once a correct word like "financial" is
 * isolated, later short tokens must not carve it up again.
 */
function segmentGluedEnglish(text: string): string {
  let out = text;
  for (let pass = 0; pass < 6; pass++) {
    const before = out;
    out = out.replace(/[A-Za-z]+/g, (run) => {
      if (run.length < MIN_GLUED_RUN) return run;
      if (LEXICON_SET.has(run.toLowerCase())) return run;
      return splitGluedRun(run);
    });
    if (out === before) break;
  }
  return out;
}

function splitGluedRun(run: string): string {
  let out = run;
  for (const word of LEXICON) {
    if (word.length >= out.length) continue;

    // Word at the start: "integralto" → "integral to".
    // Short words need a long remainder so "and" does not split "another".
    const startRest = word.length <= 3 ? 7 : 2;
    const atStart = new RegExp(
      `^(${escapeRegExp(word)})(?=[A-Za-z]{${startRest},})`,
      "i",
    );
    if (atStart.test(out)) {
      out = out.replace(atStart, "$1 ");
      continue;
    }

    // Word at the end: "AIhas" → "AI has". Reject "Thomas" → "Tom has".
    const atEnd = new RegExp(
      `([A-Za-z]{2,})(${escapeRegExp(word)})$`,
      "i",
    );
    const endMatch = out.match(atEnd);
    if (endMatch) {
      const left = endMatch[1];
      const shortUnsafe =
        word.length <= 3 && left.length < 4 && left !== left.toUpperCase();
      if (!shortUnsafe) {
        out = out.replace(atEnd, "$1 $2");
        continue;
      }
    }

    // Short bridges (3 letters) need solid flanks so "for" does not
    // destroy "transforming" / "information" / "transformational".
    const minFlank = word.length <= 3 ? 6 : 2;
    const inMiddle = new RegExp(
      `([A-Za-z]{${minFlank},})(${escapeRegExp(word)})(?=[A-Za-z]{${minFlank},})`,
      "i",
    );
    out = out.replace(inMiddle, "$1 $2 ");
  }
  return out.replace(/ +/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * When stripping HTML, keep a space if tags sat between two word characters
 * (e.g. <span>AI</span><span>has</span> → "AI has").
 */
export function htmlToPlainText(html: string): string {
  let plain = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(div|li|tr|h[1-6])>/gi, "\n");

  let prev = "";
  while (prev !== plain) {
    prev = plain;
    plain = plain.replace(/(\w)(?:<[^>]+>)+(\w)/g, "$1 $2");
  }

  plain = plain
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();

  return repairGluedSpaces(plain);
}
