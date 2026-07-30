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
		.trim()
		.toLowerCase();
	if (!key) return null;
	return SECTION_ALIASES[key] ?? null;
}

const BOLD_SECTION_LINE = /^\*\*([^*\n]+)\*\*\s*$/;

/** Map alternate section labels to standard IMRaD headings. */
export function standardizeResearchSectionHeadings(content: string): string {
	return content.replace(BOLD_SECTION_LINE, (line, title: string) => {
		const canonical = canonicalizeSectionTitle(title);
		return canonical ? `**${canonical}**` : line;
	});
}

const HAS_SECTION = (name: string) => new RegExp(`^\\*\\*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*\\*\\s*$`, "im");

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
