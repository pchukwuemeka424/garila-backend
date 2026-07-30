/** Canonical IMRaD-style section headings for generated research papers. */
export const STANDARD_RESEARCH_SECTIONS = [
	"Abstract",
	"Keywords",
	"Study area",
	"Introduction",
	"Literature Review",
	"Methodology",
	"Results / Analysis",
	"Discussion",
	"Conclusion",
	"References",
] as const;

const SECTION_ALIASES: Record<string, (typeof STANDARD_RESEARCH_SECTIONS)[number]> = {
	abstract: "Abstract",
	summary: "Abstract",
	"executive summary": "Abstract",
	keywords: "Keywords",
	keyword: "Keywords",
	"key words": "Keywords",
	"study area": "Study area",
	"study areas": "Study area",
	discipline: "Study area",
	field: "Study area",
	introduction: "Introduction",
	intro: "Introduction",
	"1 introduction": "Introduction",
	"1. introduction": "Introduction",
	background: "Introduction",
	"literature review": "Literature Review",
	"related work": "Literature Review",
	"prior work": "Literature Review",
	"theoretical background": "Literature Review",
	methodology: "Methodology",
	methods: "Methodology",
	method: "Methodology",
	"research design": "Methodology",
	"materials and methods": "Methodology",
	results: "Results / Analysis",
	analysis: "Results / Analysis",
	findings: "Results / Analysis",
	"results and discussion": "Results / Analysis",
	"results / analysis": "Results / Analysis",
	"results and analysis": "Results / Analysis",
	"empirical results": "Results / Analysis",
	discussion: "Discussion",
	"discussion and implications": "Discussion",
	conclusion: "Conclusion",
	conclusions: "Conclusion",
	"conclusion and future work": "Conclusion",
	references: "References",
	bibliography: "References",
	"works cited": "References",
};

export function canonicalizeSectionTitle(raw: string): string | null {
	const key = raw
		.replace(/^\d+\.?\s*/, "")
		.replace(/\*\*/g, "")
		.replace(/:+\s*$/g, "")
		.trim()
		.toLowerCase();
	if (!key) return null;
	return SECTION_ALIASES[key] ?? null;
}

const BOLD_SECTION_LINE = /^\*\*([^*\n]+)\*\*[^\S\n]*$/gm;
const BOLD_INLINE_META =
	/^\*\*(Keywords|Keyword|Key words|Study area|Study areas|Discipline|Field)\s*:?\s*\*\*\s*(.+)$/i;
const BOLD_INLINE_META_ALT =
	/^\*\*(Keywords|Keyword|Key words|Study area|Study areas|Discipline|Field)\*\*\s*:?\s*(.+)$/i;
const PLAIN_INLINE_META =
	/^(Keywords|Keyword|Key words|Study area|Study areas|Discipline|Field)\s*:\s*(.+)$/i;

/** Major IMRaD titles that may appear without bold after editor round-trips. */
const PLAIN_SECTION_TITLE =
	/^(Abstract|Summary|Executive summary|Keywords|Keyword|Key words|Study area|Study areas|Discipline|Field|Introduction|Literature Review|Related Work|Methodology|Methods|Results\s*\/\s*Analysis|Results and Analysis|Results|Discussion|Conclusion|Conclusions|References|Bibliography)\s*:?\s*$/i;

const PLAIN_SECTION_WITH_BODY =
	/^(Abstract|Summary|Executive summary|Introduction|Literature Review|Related Work|Methodology|Methods|Results\s*\/\s*Analysis|Results and Analysis|Discussion|Conclusion|Conclusions|References)\s*:\s+(.+)$/i;

/** `**Abstract:** body…` or `**Introduction** body…` — heading stuck to content. */
const BOLD_SECTION_WITH_BODY =
	/^\*\*([^*\n]+?)\*\*\s*:?\s+(.+)$/;

/** Journal-style keyword separators (middot), matching Springer-style papers. */
export function formatKeywordTerms(raw: string): string {
	return raw
		.replace(/\*+/g, "")
		.replace(/\s*[;|,]\s*/g, " · ")
		.replace(/\s+·\s+/g, " · ")
		.replace(/\s{2,}/g, " ")
		.replace(/^(?:Keywords|Keyword|Key words)\s*:?\s*/i, "")
		.trim();
}

/**
 * Split mixed front-matter lines such as:
 *   Keywords: a; b Study area: Physics
 *   **Keywords:** a; b **Study area:** Physics
 *   **Abstract:** paragraph on the same line
 * into separate bold headings + content lines.
 */
export function normalizeResearchFrontMatter(content: string): string {
	const lines = content.replace(/\r/g, "").split("\n");
	const out: string[] = [];

	const pushMeta = (label: string, value: string) => {
		const canonical = canonicalizeSectionTitle(label) ?? label;
		const cleaned = value.replace(/\*+/g, "").trim();
		if (!cleaned) {
			out.push(`**${canonical}**`);
			return;
		}
		if (canonical === "Keywords") {
			out.push(`**Keywords**`);
			out.push(formatKeywordTerms(cleaned));
			return;
		}
		out.push(`**${canonical}**`);
		out.push(cleaned);
	};

	const stripMetaPrefix = (raw: string, kind: "keywords" | "study") => {
		let t = raw.replace(/\*+/g, " ").replace(/\s+/g, " ").trim();
		if (kind === "keywords") {
			t = t.replace(/^(?:Keywords?|Key words)\s*:?\s*/i, "");
		} else {
			t = t.replace(/^(?:Study\s+area|Discipline|Field)\s*:?\s*/i, "");
		}
		return t.trim();
	};

	const splitMixedMeta = (text: string): boolean => {
		const plain = text.replace(/\*+/g, " ").replace(/\s+/g, " ").trim();
		const studyIdx = plain.search(/\bStudy\s+area\s*:/i);
		const discIdx = plain.search(/\b(?:Discipline|Field)\s*:/i);
		const kwIdx = plain.search(/\bKeywords?\s*:/i);
		const keyWordsIdx = plain.search(/\bKey\s+words\s*:/i);
		const kStart = kwIdx >= 0 ? kwIdx : keyWordsIdx;
		const studyStart = studyIdx >= 0 ? studyIdx : discIdx;

		if (kStart < 0 && studyStart < 0) return false;

		const before = (kStart >= 0 ? plain.slice(0, kStart) : plain.slice(0, studyStart)).trim();
		if (before) {
			const beforeSection = before.match(/^(Abstract|Summary|Executive summary)\s*:?\s*(.*)$/i);
			if (beforeSection) {
				pushMeta("Abstract", beforeSection[2] ?? "");
				out.push("");
			} else if (!/^(title|paper title)$/i.test(before)) {
				// Preserve orphan text before Keywords (often abstract body after a prior heading).
				out.push(before);
				out.push("");
			}
		}

		if (kStart >= 0 && studyStart > kStart) {
			pushMeta("Keywords", stripMetaPrefix(plain.slice(kStart, studyStart), "keywords"));
			out.push("");
			pushMeta("Study area", stripMetaPrefix(plain.slice(studyStart), "study"));
			return true;
		}

		if (kStart >= 0) {
			pushMeta("Keywords", stripMetaPrefix(plain.slice(kStart), "keywords"));
			return true;
		}

		pushMeta("Study area", stripMetaPrefix(plain.slice(studyStart), "study"));
		return true;
	};

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		const trimmed = line.trim();
		if (!trimmed) {
			out.push("");
			continue;
		}

		const boldOnly = trimmed.match(/^\*\*([^*\n]+?)\*\*\s*:?\s*$/);
		if (boldOnly) {
			const canonical = canonicalizeSectionTitle(boldOnly[1] ?? "");
			out.push(canonical ? `**${canonical}**` : trimmed);
			continue;
		}

		const boldInline = trimmed.match(BOLD_INLINE_META) ?? trimmed.match(BOLD_INLINE_META_ALT);
		if (boldInline) {
			const rest = boldInline[2] ?? "";
			if (/\bStudy\s+area\s*:/i.test(rest) || /\b(?:Discipline|Field)\s*:/i.test(rest)) {
				splitMixedMeta(`${boldInline[1]}: ${rest}`);
			} else {
				pushMeta(boldInline[1] ?? "", rest);
			}
			continue;
		}

		const boldWithBody = trimmed.match(BOLD_SECTION_WITH_BODY);
		if (boldWithBody) {
			const title = boldWithBody[1] ?? "";
			const rest = (boldWithBody[2] ?? "").trim();
			const canonical = canonicalizeSectionTitle(title);
			const plainRest = rest.replace(/\*+/g, " ");
			if (
				canonical === "Keywords" ||
				canonical === "Study area" ||
				/\bKeywords?\s*:/i.test(plainRest) ||
				/\bStudy\s+area\s*:/i.test(plainRest)
			) {
				if (canonical && canonical !== "Keywords" && canonical !== "Study area") {
					out.push(`**${canonical}**`);
					if (
						!/^\s*(?:Keywords?|Key words|Study\s+area)\s*:/i.test(plainRest) &&
						!splitMixedMeta(rest)
					) {
						out.push(rest.replace(/\*+/g, "").trim());
					} else {
						splitMixedMeta(
							/^\s*(?:Keywords?|Key words|Study\s+area)\s*:/i.test(plainRest)
								? rest
								: `${canonical}: ${rest}`,
						);
					}
				} else if (!splitMixedMeta(trimmed) && !splitMixedMeta(`${title}: ${rest}`)) {
					pushMeta(title, rest);
				}
				continue;
			}
			if (canonical) {
				out.push(`**${canonical}**`);
				out.push(rest.replace(/\*+/g, "").trim());
				continue;
			}
		}

		if (
			PLAIN_INLINE_META.test(trimmed) ||
			/\bKeywords?\s*:/i.test(trimmed.replace(/\*/g, "")) ||
			/\bStudy\s+area\s*:/i.test(trimmed.replace(/\*/g, ""))
		) {
			if (splitMixedMeta(trimmed)) continue;
		}

		// Plain "Abstract" / "Abstract:" (editor round-trip often drops **bold**).
		const plainAlone = trimmed.match(PLAIN_SECTION_TITLE);
		if (plainAlone) {
			const canonical = canonicalizeSectionTitle(plainAlone[1] ?? "");
			if (canonical) {
				out.push(`**${canonical}**`);
				continue;
			}
		}

		// Plain "Abstract: body…" on one line.
		const plainWithBody = trimmed.match(PLAIN_SECTION_WITH_BODY);
		if (plainWithBody) {
			const canonical = canonicalizeSectionTitle(plainWithBody[1] ?? "");
			if (canonical) {
				out.push(`**${canonical}**`);
				out.push((plainWithBody[2] ?? "").replace(/\*+/g, "").trim());
				continue;
			}
		}

		out.push(line);
	}

	return out
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const BOLD_SECTION_OR_COLON = /^\*\*([^*\n]+?)\*\*[^\S\n]*:?[^\S\n]*$/gm;

/**
 * Ensure blank lines around section / subsection headings so markdown/HTML parsers
 * do not merge `**Abstract**` / `**Themes**` / `## Abstract` with neighboring body text.
 */
export function ensureResearchSectionSpacing(content: string): string {
	const lines = content.replace(/\r/g, "").split("\n");
	const out: string[] = [];

	const isHeadingLine = (trimmed: string): string | null => {
		const bold = trimmed.match(/^\*\*([^*\n]+?)\*\*[^\S\n]*:?[^\S\n]*$/);
		const hash = trimmed.match(/^#{1,6}\s+(.+?)\s*$/);
		const plain = !bold && !hash ? trimmed.match(PLAIN_SECTION_TITLE) : null;
		const rawTitle = (bold?.[1] ?? hash?.[1] ?? plain?.[1] ?? "").replace(/:+\s*$/, "").trim();
		if (!rawTitle || rawTitle.length > 80) return null;

		const hashPrefix = hash?.[0]?.match(/^#{1,6}/)?.[0];
		const canonical = canonicalizeSectionTitle(rawTitle);
		if (canonical && (STANDARD_RESEARCH_SECTIONS as readonly string[]).includes(canonical)) {
			if (bold || plain) return `**${canonical}**`;
			return `${hashPrefix} ${canonical}`;
		}
		if (/^references$/i.test(rawTitle)) {
			if (bold || plain) return "**References**";
			return `${hashPrefix} References`;
		}

		// Bold-only / hash subsection titles (Themes, Framework, Gap, Limitations, …).
		if (bold) return `**${rawTitle}**`;
		if (hashPrefix) return `${hashPrefix} ${rawTitle}`;
		return null;
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const trimmed = line.trim();
		const headingLine = isHeadingLine(trimmed);

		if (headingLine) {
			if (out.length > 0 && out[out.length - 1]!.trim() !== "") {
				out.push("");
			}
			out.push(headingLine);
			const next = lines[i + 1];
			if (next !== undefined && next.trim() !== "") {
				out.push("");
			}
			continue;
		}

		out.push(line);
	}

	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Map alternate section labels to standard IMRaD headings. */
export function standardizeResearchSectionHeadings(content: string): string {
	const withFrontMatter = normalizeResearchFrontMatter(content);
	const canonicalized = withFrontMatter.replace(BOLD_SECTION_OR_COLON, (line, title: string) => {
		const canonical = canonicalizeSectionTitle(title);
		return canonical ? `**${canonical}**` : line;
	});
	return ensureResearchSectionSpacing(canonicalized);
}

const HAS_SECTION = (name: string) =>
	new RegExp(`^\\*\\*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*\\s*$`, "im");

export function paperHasSection(content: string, section: string): boolean {
	return HAS_SECTION(section).test(content);
}

/** Strip arXiv metadata without collapsing paragraph breaks between sections. */
export function stripArxivMetaPreserveLayout(text: string): string {
	return text
		.split("\n")
		.map((line) =>
			line
				.replace(/\barXiv preprint\b[^.\n]*\.?/gi, "")
				.replace(/\barXiv e-?print\b[^.\n]*\.?/gi, "")
				.replace(/\barXiv:\s*[\d.]+[a-z]?\b/gi, "")
				.replace(/\(\s*arXiv:[^)]+\)/gi, "")
				.replace(/,\s*arXiv:[^.\n]*/gi, "")
				.replace(/\bAvailable at arXiv\b[^.\n]*\.?/gi, "")
				.replace(/\bRetrieved from arXiv\b[^.\n]*\.?/gi, "")
				.replace(/\bfrom arXiv\b[^.\n]*\.?/gi, "")
				.replace(/(?<!\]\()https?:\/\/(?:www\.)?arxiv\.org\/[^\s)\],]+/gi, "")
				.replace(/\s*,\s*(?=\.)/g, "")
				.replace(/[ \t]{2,}/g, " ")
				.replace(/\.\s*\./g, ".")
				.replace(/\s+\./g, ".")
				.trim(),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Use markdown headings in the UI so Abstract, Introduction, etc. are easy to spot. */
export function promoteBoldSectionsForDisplay(content: string): string {
	const normalized = standardizeResearchSectionHeadings(content);
	const promoted = normalized.replace(BOLD_SECTION_LINE, (line, title: string) => {
		const canonical = canonicalizeSectionTitle(title);
		if (canonical && (STANDARD_RESEARCH_SECTIONS as readonly string[]).includes(canonical)) {
			// ## so edit (h2) and preview share the same section-heading style.
			return `## ${canonical}`;
		}
		const trimmed = title.trim();
		if (/^references$/i.test(trimmed)) return "## References";
		return line;
	});
	return ensureResearchSectionSpacing(promoted);
}
