import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const approvalRequestSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		kind: {
			type: String,
			enum: ["tool", "dataset", "use_case", "model", "integration"],
			required: true,
			index: true,
		},
		status: {
			type: String,
			enum: ["pending", "under_review", "approved", "rejected", "withdrawn"],
			default: "pending",
			index: true,
		},
		requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		requesterName: { type: String, trim: true },
		requesterEmail: { type: String, trim: true },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		faculty: { type: String, trim: true, index: true },
		department: { type: String, trim: true },
		justification: { type: String, trim: true, default: "" },
		riskNotes: { type: String, trim: true, default: "" },
		reviewerId: { type: Schema.Types.ObjectId, ref: "User" },
		reviewerName: { type: String, trim: true },
		reviewNotes: { type: String, trim: true, default: "" },
		decidedAt: { type: Date },
		metadata: { type: Schema.Types.Mixed },
	},
	{ timestamps: true },
);

approvalRequestSchema.index({ status: 1, createdAt: -1 });
approvalRequestSchema.index({ kind: 1, status: 1 });

export type ApprovalRequestDocument = InferSchemaType<typeof approvalRequestSchema> & {
	_id: Types.ObjectId;
};

export const ApprovalRequestModel = model("ApprovalRequest", approvalRequestSchema);
