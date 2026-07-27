import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchDatasetSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, ref: "ResearchProject", required: true, index: true },
		title: { type: String, required: true, trim: true },
		description: { type: String, required: true, trim: true },
		discipline: { type: String, default: "", trim: true },
		format: { type: String, default: "other", trim: true },
		year: { type: String, default: "", trim: true },
		license: { type: String, default: "", trim: true },
		accessUrl: { type: String, default: "", trim: true },
		sizeLabel: { type: String, default: "", trim: true },
		tags: { type: [String], default: [] },
		fileName: { type: String, default: "" },
		fileMime: { type: String, default: "" },
		fileData: { type: String, default: "" },
		visibility: { type: String, enum: ["private", "shared"], default: "private" },
	},
	{ timestamps: true },
);

researchDatasetSchema.index({ projectId: 1, updatedAt: -1 });
researchDatasetSchema.index({ userId: 1, updatedAt: -1 });

export type ResearchDatasetDocument = InferSchemaType<typeof researchDatasetSchema> & {
	_id: Types.ObjectId;
};

export const ResearchDatasetModel = model("ResearchDataset", researchDatasetSchema);
