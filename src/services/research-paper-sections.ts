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

const SECTION_ALIASES: Record<string, string> = {
	abstract: "Abstract",
	summary: "Abstract",
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
	"literature review": "Literature Review",
	"related work": "Literature Review",
	"prior work": "Literature Review",
	"theoretical background": "Literature Review",
	methodology: "Methodology",
	methods: "Methods",
	method: "Methodology",
	"materials and methods": "Methodology",
	"materials & methods": "Methodology",
	results: "Results / Analysis",
	"results and discussion": "Results / Analysis",
	"results / analysis": "Results / Analysis",
	"results and analysis": "Results / Analysis",
	"empirical results": "Results / Analysis",
	"findings / results": "Findings / Results",
	findings: "Findings",
	discussion: "Discussion",
	"discussion and implications": "Discussion",
	conclusion: "Conclusion",
	conclusions: "Conclusion",
	"conclusion and future work": "Conclusion",
	references: "References",
	bibliography: "References",
	"works cited": "References",
	"critical analysis": "Critical Analysis",
	"critical discussion": "Critical Analysis",
	"analysis and discussion": "Critical Analysis",
	"executive summary": "Executive Summary",
	background: "Background",
	objectives: "Objectives",
	analysis: "Analysis",
	recommendations: "Recommendations",
	"problem statement": "Problem Statement",
	timeline: "Timeline",
	"expected outcomes": "Expected Outcomes",
	budget: "Budget",
	"theoretical framework": "Theoretical Framework",
	contributions: "Contributions",
	appendices: "Appendices",
	acknowledgments: "Acknowledgments",
	acknowledgements: "Acknowledgments",
	"title page": "Title Page",
	declaration: "Declaration",
	dedication: "Dedication",
	"table of contents": "Table of Contents",
	"list of tables": "List of Tables",
	"list of figures": "List of Figures",
	"chapter one: introduction": "Chapter One: Introduction",
	"chapter two: literature review": "Chapter Two: Literature Review",
	"chapter three: system analysis and methodology": "Chapter Three: System Analysis and Methodology",
	"chapter three: methodology": "Chapter Three: Methodology",
	"chapter four: system design and implementation": "Chapter Four: System Design and Implementation",
	"chapter four: design and implementation": "Chapter Four: Design and Implementation",
	"chapter five: testing and results": "Chapter Five: Testing and Results",
	"chapter five: results and evaluation": "Chapter Five: Results and Evaluation",
	"chapter six: discussion": "Chapter Six: Discussion",
	"chapter seven: conclusion and recommendations": "Chapter Seven: Conclusion and Recommendations",
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

/** Collapse consecutive identical IMRaD headings (Methodology + Methods → one Methodology). */
function dedupeConsecutiveSectionHeadings(content: string): string {
	const lines = content.replace(/\r/g, "").split("\n");
	const out: string[] = [];
	let lastCanonical: string | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		const bold = trimmed.match(/^\*\*([^*\n]+)\*\*\s*$/);
		if (bold) {
			const canonical = canonicalizeSectionTitle(bold[1] ?? "");
			if (canonical && (STANDARD_RESEARCH_SECTIONS as readonly string[]).includes(canonical)) {
				if (lastCanonical === canonical) continue;
				lastCanonical = canonical;
				out.push(`**${canonical}**`);
				continue;
			}
			lastCanonical = null;
			out.push(line);
			continue;
		}
		if (trimmed) lastCanonical = null;
		out.push(line);
	}

	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Map alternate section labels to standard IMRaD headings. */
export function standardizeResearchSectionHeadings(content: string): string {
	const canonicalized = content.replace(BOLD_SECTION_LINE, (line, title: string) => {
		const canonical = canonicalizeSectionTitle(title);
		return canonical ? `**${canonical}**` : line;
	});
	return dedupeConsecutiveSectionHeadings(canonicalized);
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
