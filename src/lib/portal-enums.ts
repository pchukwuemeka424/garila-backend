export enum ChapterStatus {
	Draft = "draft",
	Submitted = "submitted",
	UnderReview = "under_review",
	NeedsRevision = "needs_revision",
	Approved = "approved",
	Rejected = "rejected",
	Locked = "locked",
}

export enum ProjectStage {
	Registration = "registration",
	Topic = "topic",
	SupervisionAssignment = "supervision_assignment",
	Proposal = "proposal",
	Chapter1 = "chapter_1",
	Chapter2 = "chapter_2",
	Chapter3 = "chapter_3",
	Chapter4 = "chapter_4",
	Chapter5 = "chapter_5",
	FinalAi = "final_ai",
	Examination = "examination",
	Defense = "defense",
	Corrections = "corrections",
	FinalApproval = "final_approval",
	Archived = "archived",
}

export enum ProjectStatus {
	Active = "active",
	Paused = "paused",
	Completed = "completed",
	Archived = "archived",
}

export enum ContentType {
	Pdf = "pdf",
	Docx = "docx",
	Richtext = "richtext",
}

export enum AiReviewStatus {
	Queued = "queued",
	Processing = "processing",
	Completed = "completed",
	Failed = "failed",
}
