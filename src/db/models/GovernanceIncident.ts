import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const governanceIncidentSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		kind: {
			type: String,
			enum: [
				"policy_breach",
				"sensitive_data",
				"unauthorized_use",
				"model_failure",
				"third_party",
				"academic_misconduct",
				"other",
			],
			required: true,
			index: true,
		},
		severity: {
			type: String,
			enum: ["low", "medium", "high", "critical"],
			default: "medium",
			index: true,
		},
		status: {
			type: String,
			enum: [
				"new",
				"assigned",
				"under_investigation",
				"waiting_for_response",
				"resolved",
				"closed",
				// Legacy values kept for backward compatibility
				"open",
				"investigating",
				"contained",
			],
			default: "new",
			index: true,
		},
		faculty: { type: String, trim: true, index: true },
		department: { type: String, trim: true },
		reportedByName: { type: String, trim: true, default: "" },
		reportedByEmail: { type: String, trim: true, default: "" },
		userInvolvedName: { type: String, trim: true, default: "" },
		assigneeName: { type: String, trim: true, default: "" },
		impactSummary: { type: String, trim: true, default: "" },
		evidence: { type: [String], default: [] },
		containmentActions: { type: String, trim: true, default: "" },
		rootCause: { type: String, trim: true, default: "" },
		lessonsLearned: { type: String, trim: true, default: "" },
		linkedAuditId: { type: String, trim: true },
		linkedSystemId: { type: String, trim: true },
		timeline: {
			type: [
				{
					at: { type: Date, default: Date.now },
					actorName: { type: String, trim: true, default: "" },
					action: { type: String, trim: true, default: "" },
					note: { type: String, trim: true, default: "" },
				},
			],
			default: [],
		},
		detectedAt: { type: Date, default: Date.now },
		resolvedAt: { type: Date },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
	},
	{ timestamps: true },
);

governanceIncidentSchema.index({ status: 1, severity: 1, createdAt: -1 });

export type GovernanceIncidentDocument = InferSchemaType<typeof governanceIncidentSchema> & {
	_id: Types.ObjectId;
};

export const GovernanceIncidentModel = model("GovernanceIncident", governanceIncidentSchema);
