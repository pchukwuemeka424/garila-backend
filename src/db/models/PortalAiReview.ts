import { Schema, model, type InferSchemaType, type Types } from "mongoose";

import { AiReviewStatus } from "../../lib/portal-enums.js";

const reportSchema = new Schema(
	{
		executiveSummary: String,
		strengths: [String],
		weaknesses: [String],
		grammar: Schema.Types.Mixed,
		academicWriting: Schema.Types.Mixed,
		criticalThinkingScore: Number,
		citations: {
			apa7: Schema.Types.Mixed,
			harvard: Schema.Types.Mixed,
			ieee: Schema.Types.Mixed,
		},
		researchGap: Schema.Types.Mixed,
		methodology: Schema.Types.Mixed,
		literatureReview: Schema.Types.Mixed,
		alignment: {
			topic: Number,
			researchQuestions: Number,
			objectives: Number,
			hypothesis: Number,
		},
		consistency: Schema.Types.Mixed,
		completeness: Schema.Types.Mixed,
		missingSections: [String],
		readabilityScore: Number,
		similarityScore: Number,
		writingSuggestions: [String],
		supervisorRecommendation: String,
		estimatedGrade: String,
		risks: [String],
	},
	{ _id: false },
);

const schema = new Schema(
	{
		universityId: { type: Schema.Types.ObjectId, required: true },
		projectId: { type: Schema.Types.ObjectId, required: true },
		chapterId: { type: Schema.Types.ObjectId, required: true },
		versionId: { type: Schema.Types.ObjectId, required: true },
		status: {
			type: String,
			enum: Object.values(AiReviewStatus),
			default: AiReviewStatus.Queued,
		},
		report: reportSchema,
		model: { type: String, required: true },
		tokensUsed: Number,
		completedAt: Date,
		error: String,
	},
	{ timestamps: true, collection: "aireviews" },
);

schema.index({ universityId: 1, versionId: 1 }, { unique: true });
schema.index({ universityId: 1, status: 1, createdAt: -1 });

export type PortalAiReviewDocument = InferSchemaType<typeof schema> & {
	_id: Types.ObjectId;
};

export const PortalAiReviewModel = model("PortalAiReview", schema);
