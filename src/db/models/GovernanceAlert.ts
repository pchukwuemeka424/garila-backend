import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const governanceAlertSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		summary: { type: String, required: true, trim: true },
		kind: {
			type: String,
			enum: [
				"sensitive_data",
				"policy_violation",
				"excessive_token_usage",
				"unusual_login",
				"multiple_failed_logins",
				"suspicious_ai_prompt",
				"restricted_content",
				"excessive_document_generation",
				"abnormal_user_activity",
				"data_retention_warning",
				// legacy
				"policy_breach",
				"high_risk_activity",
				"unusual_usage",
				"privacy",
				"security",
				"other",
			],
			required: true,
			index: true,
		},
		severity: {
			type: String,
			enum: ["low", "medium", "high", "critical"],
			default: "high",
			index: true,
		},
		status: {
			type: String,
			enum: [
				"open",
				"acknowledged",
				"investigating",
				"escalated",
				"resolved",
				"closed",
				"dismissed", // legacy → treat as closed in UI
			],
			default: "open",
			index: true,
		},
		faculty: { type: String, trim: true, index: true },
		department: { type: String, trim: true },
		actorEmail: { type: String, trim: true },
		actorName: { type: String, trim: true },
		actorRole: { type: String, trim: true },
		assigneeName: { type: String, trim: true, default: "" },
		linkedAuditId: { type: String, trim: true, index: true },
		linkedIncidentId: { type: String, trim: true },
		context: { type: Schema.Types.Mixed },
		responseNotes: { type: String, trim: true, default: "" },
		acknowledgedAt: { type: Date },
		acknowledgedBy: { type: Schema.Types.ObjectId, ref: "User" },
		resolvedAt: { type: Date },
		resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
		notificationSent: { type: Boolean, default: false },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
	},
	{ timestamps: true },
);

governanceAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });

export type GovernanceAlertDocument = InferSchemaType<typeof governanceAlertSchema> & {
	_id: Types.ObjectId;
};

export const GovernanceAlertModel = model("GovernanceAlert", governanceAlertSchema);
