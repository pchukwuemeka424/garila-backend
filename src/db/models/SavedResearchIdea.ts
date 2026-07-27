import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const savedResearchIdeaSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		ideaId: { type: String, required: true },
		title: { type: String, required: true },
		rationale: { type: String, required: true },
		approach: { type: String, required: true },
		outline: { type: String, required: false },
		researchQuestions: { type: [String], required: false, default: undefined },
		type: {
			type: String,
			enum: ["empirical", "theoretical", "interdisciplinary", "applied"],
			required: true,
		},
		feasibility: {
			type: String,
			enum: ["high", "medium", "exploratory"],
			required: true,
		},
		discipline: { type: String, required: true },
		topic: { type: String, required: true },
		status: {
			type: String,
			enum: ["saved", "in_progress", "completed"],
			default: "saved",
		},
	},
	{ timestamps: true },
);

savedResearchIdeaSchema.index({ userId: 1, ideaId: 1, title: 1 }, { unique: true });

export type SavedResearchIdeaDocument = InferSchemaType<typeof savedResearchIdeaSchema> & {
	_id: Types.ObjectId;
};

export const SavedResearchIdeaModel = model("SavedResearchIdea", savedResearchIdeaSchema);
