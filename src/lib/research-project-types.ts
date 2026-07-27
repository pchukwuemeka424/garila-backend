export const RESEARCH_PROJECT_TYPES = [
	"research",
	"thesis",
	"dissertation",
	"masters_project",
	"undergraduate_project",
	"journal_article",
	"report",
	"proposal",
] as const;

export type ResearchProjectType = (typeof RESEARCH_PROJECT_TYPES)[number];

export type ResearchProjectSectionDef = {
	id: string;
	title: string;
};

export type ResearchProjectTypeOption = {
	id: ResearchProjectType;
	label: string;
	description: string;
	sections: ResearchProjectSectionDef[];
};

export const RESEARCH_PROJECT_TYPE_OPTIONS: ResearchProjectTypeOption[] = [
	{
		id: "research",
		label: "Research paper",
		description: "IMRaD-style structure for academic research writing.",
		sections: [
			{ id: "abstract", title: "Abstract" },
			{ id: "keywords", title: "Keywords" },
			{ id: "introduction", title: "Introduction" },
			{ id: "literature_review", title: "Literature Review" },
			{ id: "methodology", title: "Methodology" },
			{ id: "results", title: "Results" },
			{ id: "discussion", title: "Discussion" },
			{ id: "conclusion", title: "Conclusion" },
			{ id: "references", title: "References" },
		],
	},
	{
		id: "thesis",
		label: "Thesis",
		description: "Chapter structure for a master’s thesis.",
		sections: [
			{ id: "title_page", title: "Title Page" },
			{ id: "abstract", title: "Abstract" },
			{ id: "acknowledgments", title: "Acknowledgments" },
			{ id: "table_of_contents", title: "Table of Contents" },
			{ id: "introduction", title: "Introduction" },
			{ id: "literature_review", title: "Literature Review" },
			{ id: "methodology", title: "Methodology" },
			{ id: "findings", title: "Findings / Results" },
			{ id: "discussion", title: "Discussion" },
			{ id: "conclusion", title: "Conclusion" },
			{ id: "recommendations", title: "Recommendations" },
			{ id: "references", title: "References" },
			{ id: "appendices", title: "Appendices" },
		],
	},
	{
		id: "dissertation",
		label: "Dissertation",
		description: "Extended chapter structure for doctoral work.",
		sections: [
			{ id: "title_page", title: "Title Page" },
			{ id: "abstract", title: "Abstract" },
			{ id: "acknowledgments", title: "Acknowledgments" },
			{ id: "dedication", title: "Dedication" },
			{ id: "table_of_contents", title: "Table of Contents" },
			{ id: "list_of_tables", title: "List of Tables" },
			{ id: "list_of_figures", title: "List of Figures" },
			{ id: "introduction", title: "Introduction" },
			{ id: "literature_review", title: "Literature Review" },
			{ id: "theoretical_framework", title: "Theoretical Framework" },
			{ id: "methodology", title: "Methodology" },
			{ id: "results", title: "Results" },
			{ id: "discussion", title: "Discussion" },
			{ id: "conclusion", title: "Conclusion" },
			{ id: "contributions", title: "Contributions" },
			{ id: "references", title: "References" },
			{ id: "appendices", title: "Appendices" },
		],
	},
	{
		id: "masters_project",
		label: "Master’s project",
		description: "Master’s project with front matter and Chapters 1–7.",
		sections: [
			{ id: "title_page", title: "Title Page" },
			{ id: "abstract", title: "Abstract" },
			{ id: "acknowledgments", title: "Acknowledgments" },
			{ id: "table_of_contents", title: "Table of Contents" },
			{ id: "chapter_1", title: "Chapter One: Introduction" },
			{ id: "chapter_2", title: "Chapter Two: Literature Review" },
			{ id: "chapter_3", title: "Chapter Three: Methodology" },
			{ id: "chapter_4", title: "Chapter Four: Design and Implementation" },
			{ id: "chapter_5", title: "Chapter Five: Results and Evaluation" },
			{ id: "chapter_6", title: "Chapter Six: Discussion" },
			{ id: "chapter_7", title: "Chapter Seven: Conclusion and Recommendations" },
			{ id: "references", title: "References" },
			{ id: "appendices", title: "Appendices" },
		],
	},
	{
		id: "undergraduate_project",
		label: "Undergraduate project",
		description: "Undergraduate project with front matter and Chapters 1–7.",
		sections: [
			{ id: "title_page", title: "Title Page" },
			{ id: "declaration", title: "Declaration" },
			{ id: "abstract", title: "Abstract" },
			{ id: "acknowledgments", title: "Acknowledgments" },
			{ id: "table_of_contents", title: "Table of Contents" },
			{ id: "chapter_1", title: "Chapter One: Introduction" },
			{ id: "chapter_2", title: "Chapter Two: Literature Review" },
			{ id: "chapter_3", title: "Chapter Three: System Analysis and Methodology" },
			{ id: "chapter_4", title: "Chapter Four: System Design and Implementation" },
			{ id: "chapter_5", title: "Chapter Five: Testing and Results" },
			{ id: "chapter_6", title: "Chapter Six: Discussion" },
			{ id: "chapter_7", title: "Chapter Seven: Conclusion and Recommendations" },
			{ id: "references", title: "References" },
			{ id: "appendices", title: "Appendices" },
		],
	},
	{
		id: "journal_article",
		label: "Journal article",
		description: "Compact structure for journal submissions.",
		sections: [
			{ id: "title", title: "Title" },
			{ id: "abstract", title: "Abstract" },
			{ id: "keywords", title: "Keywords" },
			{ id: "introduction", title: "Introduction" },
			{ id: "methods", title: "Methods" },
			{ id: "results", title: "Results" },
			{ id: "discussion", title: "Discussion" },
			{ id: "conclusion", title: "Conclusion" },
			{ id: "acknowledgments", title: "Acknowledgments" },
			{ id: "references", title: "References" },
		],
	},
	{
		id: "report",
		label: "Project report",
		description: "Applied report structure for institutional projects.",
		sections: [
			{ id: "executive_summary", title: "Executive Summary" },
			{ id: "introduction", title: "Introduction" },
			{ id: "background", title: "Background" },
			{ id: "objectives", title: "Objectives" },
			{ id: "methods", title: "Methods" },
			{ id: "findings", title: "Findings" },
			{ id: "analysis", title: "Analysis" },
			{ id: "recommendations", title: "Recommendations" },
			{ id: "conclusion", title: "Conclusion" },
			{ id: "references", title: "References" },
			{ id: "appendices", title: "Appendices" },
		],
	},
	{
		id: "proposal",
		label: "Research proposal",
		description: "Planning structure for proposing a new study.",
		sections: [
			{ id: "abstract", title: "Abstract" },
			{ id: "introduction", title: "Introduction" },
			{ id: "problem_statement", title: "Problem Statement" },
			{ id: "objectives", title: "Objectives" },
			{ id: "literature_review", title: "Literature Review" },
			{ id: "methodology", title: "Methodology" },
			{ id: "timeline", title: "Timeline" },
			{ id: "expected_outcomes", title: "Expected Outcomes" },
			{ id: "budget", title: "Budget" },
			{ id: "conclusion", title: "Conclusion" },
			{ id: "references", title: "References" },
		],
	},
];

export function isResearchProjectType(value: string): value is ResearchProjectType {
	return (RESEARCH_PROJECT_TYPES as readonly string[]).includes(value);
}

export function getProjectTypeOption(type: string): ResearchProjectTypeOption {
	return (
		RESEARCH_PROJECT_TYPE_OPTIONS.find((opt) => opt.id === type) ??
		RESEARCH_PROJECT_TYPE_OPTIONS[0]
	);
}

export function getProjectTypeLabel(type: string): string {
	return getProjectTypeOption(type).label;
}

export function buildEmptySections(type: ResearchProjectType = "research") {
	return getProjectTypeOption(type).sections.map((section) => ({
		id: section.id,
		title: section.title,
		content: "",
	}));
}

/**
 * Align stored sections to the selected project type outline.
 * Matching section IDs keep their content; new template sections start empty.
 */
export function mergeSectionsWithTemplate(
	type: ResearchProjectType,
	existing: Array<{ id?: string | null; title?: string | null; content?: string | null }> | null | undefined,
) {
	const byId = new Map(
		(Array.isArray(existing) ? existing : [])
			.filter((section) => section?.id)
			.map((section) => [
				String(section.id),
				{
					id: String(section.id),
					title: String(section.title || section.id),
					content: typeof section.content === "string" ? section.content : "",
				},
			]),
	);

	return getProjectTypeOption(type).sections.map((section) => ({
		id: section.id,
		title: section.title,
		content: byId.get(section.id)?.content ?? "",
	}));
}
