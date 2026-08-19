export type ProjectType =
	| "dissertation"
	| "thesis"
	| "research"
	| "project"
	| "capstone"
	| "publication"
	| "assignment";

export const PROJECT_TYPE_VALUES: ProjectType[] = [
	"dissertation",
	"thesis",
	"research",
	"project",
	"capstone",
	"publication",
	"assignment",
];

export type ProjectSectionDef = {
	key: string;
	label: string;
	placeholder: string;
};

const ASSIGNMENT_SECTION: ProjectSectionDef[] = [
	{
		key: "document",
		label: "Assignment",
		placeholder: "Write your full assignment here, or import a Word/PDF draft…",
	},
];

const DEFAULT_CHAPTERS: ProjectSectionDef[] = [
	{ key: "abstract", label: "Abstract", placeholder: "" },
	{ key: "introduction", label: "Introduction", placeholder: "" },
	{ key: "literature", label: "Literature Review", placeholder: "" },
	{ key: "methodology", label: "Methodology", placeholder: "" },
	{ key: "results", label: "Results", placeholder: "" },
	{ key: "discussion", label: "Discussion & Conclusion", placeholder: "" },
	{ key: "references", label: "References", placeholder: "" },
];

export function isSinglePageProjectType(type?: string | null): boolean {
	return type === "assignment";
}

export function getSectionsForType(type: ProjectType): ProjectSectionDef[] {
	if (type === "assignment") return ASSIGNMENT_SECTION;
	return DEFAULT_CHAPTERS;
}
