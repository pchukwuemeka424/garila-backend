import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const questionnaireItemSchema = new Schema(
	{
		id: { type: String, required: true, trim: true },
		prompt: { type: String, required: true, trim: true },
		kind: {
			type: String,
			enum: ["open", "yes_no", "multiple_choice", "likert", "numeric"],
			default: "open",
		},
		options: { type: [String], default: [] },
		scaleMin: { type: Number, default: 1 },
		scaleMax: { type: Number, default: 5 },
		column: { type: String, default: "", trim: true },
	},
	{ _id: false },
);

const researchQuestionnaireSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, ref: "ResearchProject", required: true, index: true },
		title: { type: String, required: true, trim: true },
		description: { type: String, default: "", trim: true },
		population: { type: String, default: "", trim: true },
		sampleSize: { type: Number, default: 0 },
		distributionNote: { type: String, default: "", trim: true },
		items: { type: [questionnaireItemSchema], default: [] },
		responseDatasetId: { type: Schema.Types.ObjectId, ref: "ResearchDataset", default: null },
		instrumentDocumentId: { type: Schema.Types.ObjectId, ref: "ResearchDocument", default: null },
		rowCount: { type: Number, default: 0 },
		importedFileName: { type: String, default: "", trim: true },
		columns: { type: [String], default: [] },
	},
	{ timestamps: true },
);

researchQuestionnaireSchema.index({ projectId: 1, updatedAt: -1 });
researchQuestionnaireSchema.index({ userId: 1, updatedAt: -1 });

export type ResearchQuestionnaireDocument = InferSchemaType<typeof researchQuestionnaireSchema> & {
	_id: Types.ObjectId;
};

export const ResearchQuestionnaireModel = model("ResearchQuestionnaire", researchQuestionnaireSchema);
