import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const governanceRiskSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		category: {
			type: String,
			enum: [
				"data_protection",
				"academic_integrity",
				"model_safety",
				"access_control",
				"third_party",
				"operational",
				"legal",
				"reputational",
			],
			required: true,
			index: true,
		},
		status: {
			type: String,
			enum: ["open", "mitigating", "accepted", "closed"],
			default: "open",
			index: true,
		},
		likelihood: { type: Number, min: 1, max: 5, required: true },
		impact: { type: Number, min: 1, max: 5, required: true },
		inherentScore: { type: Number, min: 1, max: 25, required: true },
		residualLikelihood: { type: Number, min: 1, max: 5 },
		residualImpact: { type: Number, min: 1, max: 5 },
		residualScore: { type: Number, min: 1, max: 25 },
		faculty: { type: String, trim: true, index: true },
		department: { type: String, trim: true },
		ownerName: { type: String, trim: true, default: "" },
		controls: { type: String, trim: true, default: "" },
		treatmentPlan: { type: String, trim: true, default: "" },
		linkedSystemId: { type: String, trim: true },
		reviewDueAt: { type: Date },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

governanceRiskSchema.index({ inherentScore: -1, status: 1 });
governanceRiskSchema.index({ residualScore: -1 });

export type GovernanceRiskDocument = InferSchemaType<typeof governanceRiskSchema> & {
	_id: Types.ObjectId;
};

export const GovernanceRiskModel = model("GovernanceRisk", governanceRiskSchema);
