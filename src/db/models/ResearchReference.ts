import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchReferenceSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, ref: "ResearchProject", required: true, index: true },
		title: { type: String, required: true, trim: true },
		citation: { type: String, required: true, trim: true },
		sourceUrl: { type: String, default: "", trim: true },
	},
	{ timestamps: true },
);

researchReferenceSchema.index({ projectId: 1, updatedAt: -1 });
researchReferenceSchema.index({ userId: 1, updatedAt: -1 });

export type ResearchReferenceDocument = InferSchemaType<typeof researchReferenceSchema> & {
	_id: Types.ObjectId;
};

export const ResearchReferenceModel = model("ResearchReference", researchReferenceSchema);
