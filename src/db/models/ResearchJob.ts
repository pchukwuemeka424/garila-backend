import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchJobSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		sessionId: { type: Schema.Types.ObjectId, ref: "Session", index: true },
		topic: { type: String, required: true },
		status: {
			type: String,
			enum: ["queued", "running", "completed", "failed", "cancelled"],
			default: "queued",
			index: true,
		},
		savedResearchId: { type: Schema.Types.ObjectId, ref: "SavedResearch" },
		figureDocumentIds: { type: [String], default: [] },
		/** Canonical dataset tables + research-chart fences to inject after save. */
		visualizationMarkdown: { type: String, default: "" },
		sources: {
			documentIds: { type: [String], default: [] },
			datasetIds: { type: [String], default: [] },
			questionnaireIds: { type: [String], default: [] },
			noteIds: { type: [String], default: [] },
			projectIds: { type: [String], default: [] },
		},
		error: { type: String },
		progress: { type: Number, default: 0, min: 0, max: 100 },
		/** Live partial paper text while the model streams. */
		draftContent: { type: String, default: "" },
		notifiedAt: { type: Date },
	},
	{ timestamps: true },
);

researchJobSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export type ResearchJobDocument = InferSchemaType<typeof researchJobSchema> & {
	_id: Types.ObjectId;
};

export const ResearchJobModel = model("ResearchJob", researchJobSchema);
