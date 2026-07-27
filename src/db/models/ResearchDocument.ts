import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchDocumentSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, ref: "ResearchProject", required: true, index: true },
		title: { type: String, required: true, trim: true },
		fileName: { type: String, required: true, trim: true },
		fileMime: { type: String, default: "application/octet-stream", trim: true },
		fileData: { type: String, default: "" },
		sizeLabel: { type: String, default: "", trim: true },
		kind: {
			type: String,
			enum: ["doc", "pdf", "sheet", "other"],
			default: "other",
		},
	},
	{ timestamps: true },
);

researchDocumentSchema.index({ projectId: 1, updatedAt: -1 });
researchDocumentSchema.index({ userId: 1, updatedAt: -1 });

export type ResearchDocumentRecord = InferSchemaType<typeof researchDocumentSchema> & {
	_id: Types.ObjectId;
};

export const ResearchDocumentModel = model("ResearchDocument", researchDocumentSchema);
