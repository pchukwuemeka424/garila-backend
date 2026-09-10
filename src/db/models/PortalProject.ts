import { Schema, model, type InferSchemaType, type Types } from "mongoose";

import { ProjectStage, ProjectStatus } from "../../lib/portal-enums.js";

const PROJECT_TYPES = [
	"dissertation",
	"thesis",
	"research",
	"project",
	"capstone",
	"publication",
	"assignment",
] as const;

const pageSchema = new Schema(
	{
		title: { type: String, required: true, trim: true, maxlength: 200 },
		content: { type: String, default: "", maxlength: 500_000 },
		order: { type: Number, default: 0 },
		reviewStatus: {
			type: String,
			enum: ["none", "approved", "needs_revision"],
			default: "none",
		},
		reviewRemark: { type: String, default: "", maxlength: 50_000 },
		reviewAnnotatedHtml: { type: String, default: "", maxlength: 1_500_000 },
		reviewedAt: Date,
		reviewedBy: Schema.Types.ObjectId,
		reviewTrail: {
			type: [
				{
					type: {
						type: String,
						enum: ["submitted", "rewrite_requested", "approved"],
						required: true,
					},
					at: { type: Date, required: true },
					actorId: Schema.Types.ObjectId,
					remark: { type: String, default: "", maxlength: 50_000 },
					contentHtml: { type: String, default: "", maxlength: 500_000 },
					annotatedHtml: { type: String, default: "", maxlength: 1_500_000 },
					versionNumber: { type: Number, min: 1 },
					wordCount: { type: Number, min: 0 },
				},
			],
			default: [],
		},
		aiCorrectionFindings: { type: [Schema.Types.Mixed], default: [] },
		aiCorrectionSummary: { type: String, default: "", maxlength: 8000 },
		aiCorrectionChecks: { type: [Schema.Types.Mixed], default: [] },
		aiReviewedAt: Date,
		aiReviewModel: { type: String, default: "", maxlength: 120 },
	},
	{ _id: true },
);

const schema = new Schema(
	{
		universityId: { type: Schema.Types.ObjectId, required: true, index: true },
		studentId: { type: Schema.Types.ObjectId, required: true, index: true },
		projectType: { type: String, enum: PROJECT_TYPES, required: true },
		title: { type: String, required: true, trim: true, maxlength: 500 },
		studentMatNo: { type: String, trim: true, maxlength: 64, default: "" },
		courseYear: { type: String, trim: true, maxlength: 32, default: "" },
		courseName: { type: String, trim: true, maxlength: 200, default: "" },
		topic: { type: String, trim: true, maxlength: 1000, default: "" },
		abstract: { type: String, maxlength: 10000, default: "" },
		sections: { type: Map, of: String, default: {} },
		pages: { type: [pageSchema], default: [] },
		supervisorId: Schema.Types.ObjectId,
		coSupervisorId: Schema.Types.ObjectId,
		stage: {
			type: String,
			enum: Object.values(ProjectStage),
			default: ProjectStage.Topic,
		},
		status: {
			type: String,
			enum: Object.values(ProjectStatus),
			default: ProjectStatus.Active,
		},
		progressPercent: { type: Number, default: 0, min: 0, max: 100 },
		topicStatus: {
			type: String,
			enum: ["draft", "submitted", "approved"],
			default: "draft",
		},
		assignmentBriefId: Schema.Types.ObjectId,
		score: { type: Number, default: null, min: 0, max: 1000 },
		scoreNote: { type: String, default: "", maxlength: 8_000 },
		scoredAt: Date,
		scoredBy: Schema.Types.ObjectId,
		scoreSource: {
			type: String,
			enum: ["none", "manual", "ai_approved"],
			default: "none",
		},
		aiSuggestedScore: { type: Number, default: null, min: 0, max: 1000 },
		aiGeneratedPercent: { type: Number, default: null, min: 0, max: 100 },
		aiReviewSnapshot: { type: Schema.Types.Mixed, default: null },
		aiReviewedAt: Date,
		criterionScores: {
			type: [
				{
					name: { type: String, required: true, trim: true, maxlength: 200 },
					score: { type: Number, required: true, min: 0, max: 1000 },
					maxMarks: { type: Number, required: true, min: 0, max: 1000 },
				},
			],
			default: [],
		},
		timeline: { milestones: { type: [Schema.Types.Mixed], default: [] } },
		metadata: { type: Schema.Types.Mixed, default: {} },
		deletedAt: Date,
	},
	{ timestamps: true, collection: "portalprojects" },
);

schema.index({ universityId: 1, studentId: 1 });
schema.index({ universityId: 1, supervisorId: 1, status: 1 });
schema.index({ universityId: 1, projectType: 1 });
schema.index({ universityId: 1, assignmentBriefId: 1 });

export type PortalProjectDocument = InferSchemaType<typeof schema> & {
	_id: Types.ObjectId;
};

export const PortalProjectModel = model("PortalProject", schema);
