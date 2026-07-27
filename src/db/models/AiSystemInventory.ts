import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const aiSystemInventorySchema = new Schema(
	{
		name: { type: String, required: true, trim: true },
		vendor: { type: String, trim: true, default: "" },
		purpose: { type: String, trim: true, default: "" },
		category: {
			type: String,
			enum: ["llm", "embedding", "search", "vision", "speech", "analytics", "other"],
			default: "llm",
			index: true,
		},
		deployment: {
			type: String,
			enum: ["internal", "vendor_saas", "open_source", "hybrid"],
			default: "vendor_saas",
		},
		riskTier: {
			type: String,
			enum: ["minimal", "limited", "high", "unacceptable"],
			default: "limited",
			index: true,
		},
		status: {
			type: String,
			enum: ["proposed", "approved", "active", "restricted", "retired"],
			default: "proposed",
			index: true,
		},
		dataClasses: { type: [String], default: [] },
		facultiesAllowed: { type: [String], default: [] },
		rolesAllowed: { type: [String], default: [] },
		ownerName: { type: String, trim: true, default: "" },
		dpiaRequired: { type: Boolean, default: false },
		dpiaStatus: {
			type: String,
			enum: ["not_required", "pending", "in_progress", "complete", "overdue"],
			default: "not_required",
			index: true,
		},
		dpiaNotes: { type: String, trim: true, default: "" },
		lastReviewedAt: { type: Date },
		nextReviewAt: { type: Date },
		approvalRequestId: { type: String, trim: true },
		notes: { type: String, trim: true, default: "" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

aiSystemInventorySchema.index({ name: 1, vendor: 1 });

export type AiSystemInventoryDocument = InferSchemaType<typeof aiSystemInventorySchema> & {
	_id: Types.ObjectId;
};

export const AiSystemInventoryModel = model("AiSystemInventory", aiSystemInventorySchema);
