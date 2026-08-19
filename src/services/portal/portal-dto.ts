export type CreateProjectInput = {
	title: string;
	projectType:
		| "dissertation"
		| "thesis"
		| "research"
		| "project"
		| "capstone"
		| "publication"
		| "assignment";
	supervisorId: string;
	topic?: string;
	abstract?: string;
	studentMatNo?: string;
	courseYear?: string;
	courseName?: string;
	assignmentBriefId?: string;
};

export type SaveSectionsInput = {
	sections: Record<string, string>;
};

export type AddPageInput = {
	title: string;
};

export type UpdatePageInput = {
	title?: string;
	content?: string;
};

export type ImportPagesInput = {
	mode: "append" | "replace";
	sections: Array<{ title: string; content: string }>;
};

export type ReviewPageInput = {
	action: "approve" | "needs_revision";
	remark?: string;
	annotatedHtml?: string;
};

export type ScoreAssignmentInput = {
	score?: number;
	acceptAiScore?: boolean;
	scoreNote?: string;
	criterionScores?: Array<{ name: string; score: number; maxMarks: number }>;
};

export type AddChapterInput = {
	number: number;
	title?: string;
};

export type SaveChapterDraftInput = {
	content: string;
};

export type RubricCriterionInput = {
	name: string;
	maxMarks: number;
};

export type CreateAssignmentBriefInput = {
	title: string;
	instructions?: string;
	requiredItems?: string[];
	wordCountMin?: number | null;
	wordCountMax?: number | null;
	maxScore?: number;
	rubric?: RubricCriterionInput[];
	dueAt?: string | null;
	allowLateSubmission?: boolean;
	courseName?: string;
	courseYear?: string;
	status?: "draft" | "published";
};

export type UpdateAssignmentBriefInput = Partial<CreateAssignmentBriefInput>;
