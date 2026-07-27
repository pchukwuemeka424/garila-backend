import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchIdeaSchema = new Schema(
	{
		id: { type: String, required: true },
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
	},
	{ _id: false },
);

const researchIdeaSessionSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		discipline: { type: String, required: true },
		topic: { type: String, required: true },
		scope: {
			type: String,
			enum: ["undergraduate", "masters", "doctoral", "faculty"],
			required: true,
		},
		ideas: { type: [researchIdeaSchema], required: true },
	},
	{ timestamps: true },
);

researchIdeaSessionSchema.index({ userId: 1, discipline: 1, topic: 1 }, { unique: true });

export type ResearchIdeaSessionDocument = InferSchemaType<typeof researchIdeaSessionSchema> & {
	_id: Types.ObjectId;
};

export const ResearchIdeaSessionModel = model("ResearchIdeaSession", researchIdeaSessionSchema);
