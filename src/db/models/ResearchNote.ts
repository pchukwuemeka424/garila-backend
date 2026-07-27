import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchNoteSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, ref: "ResearchProject", required: true, index: true },
		title: { type: String, required: true, trim: true },
		content: { type: String, default: "", trim: true },
	},
	{ timestamps: true },
);

researchNoteSchema.index({ projectId: 1, updatedAt: -1 });
researchNoteSchema.index({ userId: 1, updatedAt: -1 });

export type ResearchNoteDocument = InferSchemaType<typeof researchNoteSchema> & {
	_id: Types.ObjectId;
};

export const ResearchNoteModel = model("ResearchNote", researchNoteSchema);
