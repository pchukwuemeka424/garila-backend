import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const retentionPolicySchema = new Schema(
	{
		name: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		dataCategory: {
			type: String,
			enum: [
				"audit_logs",
				"ai_conversations",
				"research_documents",
				"uploaded_files",
				"incidents",
				"governance_reports",
				"contribution_statements",
				"governance_alerts",
				"reports",
				"research_metadata",
				"research_content",
				"user_accounts",
				"token_usage",
				"sessions",
				"other",
			],
			required: true,
			index: true,
		},
		retainDays: { type: Number, required: true, min: 1 },
		archiveDays: { type: Number, min: 0, default: 0 },
		actionOnExpiry: {
			type: String,
			enum: ["archive", "anonymise", "delete", "legal_hold"],
			default: "archive",
		},
		legalHold: { type: Boolean, default: false },
		enabled: { type: Boolean, default: true, index: true },
		regulatoryBasis: { type: String, trim: true, default: "" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

retentionPolicySchema.index({ dataCategory: 1, enabled: 1 });
retentionPolicySchema.index({ universityId: 1, enabled: 1 });

export type RetentionPolicyDocument = InferSchemaType<typeof retentionPolicySchema> & {
	_id: Types.ObjectId;
};

export const RetentionPolicyModel = model("RetentionPolicy", retentionPolicySchema);

const deletionRequestSchema = new Schema(
	{
		subjectName: { type: String, required: true, trim: true },
		subjectEmail: { type: String, required: true, trim: true, lowercase: true },
		subjectUserId: { type: Schema.Types.ObjectId, ref: "User" },
		requestType: {
			type: String,
			enum: ["erase", "export", "restrict", "rectify"],
			default: "erase",
			index: true,
		},
		status: {
			type: String,
			enum: ["received", "under_review", "approved", "completed", "rejected", "on_hold"],
			default: "received",
			index: true,
		},
		scope: { type: String, trim: true, default: "" },
		notes: { type: String, trim: true, default: "" },
		legalHold: { type: Boolean, default: false },
		dueAt: { type: Date },
		completedAt: { type: Date },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

deletionRequestSchema.index({ status: 1, createdAt: -1 });
deletionRequestSchema.index({ universityId: 1, status: 1, createdAt: -1 });

export type DeletionRequestDocument = InferSchemaType<typeof deletionRequestSchema> & {
	_id: Types.ObjectId;
};

export const DeletionRequestModel = model("DeletionRequest", deletionRequestSchema);
