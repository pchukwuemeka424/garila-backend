import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const complianceControlSchema = new Schema(
	{
		code: { type: String, required: true, trim: true },
		title: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		framework: {
			type: String,
			enum: ["nigeria_ai_act", "eu_ai_act", "ndpr", "institutional", "iso_42001", "unesco"],
			required: true,
			index: true,
		},
		domain: {
			type: String,
			enum: [
				"transparency",
				"human_oversight",
				"data_governance",
				"accuracy_robustness",
				"privacy",
				"accountability",
				"fairness",
				"security",
			],
			required: true,
			index: true,
		},
		status: {
			type: String,
			enum: ["not_started", "in_progress", "compliant", "gap", "not_applicable"],
			default: "not_started",
			index: true,
		},
		evidence: { type: String, trim: true, default: "" },
		ownerName: { type: String, trim: true, default: "" },
		priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
		lastAssessedAt: { type: Date },
		nextReviewAt: { type: Date },
		notes: { type: String, trim: true, default: "" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

complianceControlSchema.index({ universityId: 1, framework: 1, code: 1 }, { unique: true });

export type ComplianceControlDocument = InferSchemaType<typeof complianceControlSchema> & {
	_id: Types.ObjectId;
};

export const ComplianceControlModel = model("ComplianceControl", complianceControlSchema);
