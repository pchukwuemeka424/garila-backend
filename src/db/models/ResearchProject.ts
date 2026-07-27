import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchProjectSectionSchema = new Schema(
	{
		id: { type: String, required: true, trim: true },
		title: { type: String, required: true, trim: true },
		content: { type: String, default: "", trim: false },
	},
	{ _id: false },
);

const researchProjectSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		title: { type: String, required: true, trim: true, default: "Untitled research" },
		description: { type: String, default: "", trim: true },
		projectType: {
			type: String,
			enum: [
				"research",
				"thesis",
				"dissertation",
				"masters_project",
				"undergraduate_project",
				"journal_article",
				"report",
				"proposal",
			],
			default: "research",
			index: true,
		},
		sections: {
			type: [researchProjectSectionSchema],
			default: [],
		},
		status: {
			type: String,
			enum: ["draft", "in_progress", "completed"],
			default: "in_progress",
		},
		favorite: { type: Boolean, default: false },
		progress: { type: Number, default: 0, min: 0, max: 100 },
		startedAt: { type: Date, default: Date.now },
		/** CanvAtlas notebook snapshot (sections, pages, datasets, drafts, …). */
		notebookData: { type: Schema.Types.Mixed, default: null },
	},
	{ timestamps: true },
);

researchProjectSchema.index({ userId: 1, updatedAt: -1 });

export type ResearchProjectDocument = InferSchemaType<typeof researchProjectSchema> & {
	_id: Types.ObjectId;
};

export const ResearchProjectModel = model("ResearchProject", researchProjectSchema);
