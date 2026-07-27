import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const provenanceEventSchema = new Schema(
	{
		at: { type: Date, required: true },
		action: { type: String, required: true, trim: true },
		agentOrTool: { type: String, trim: true, default: "" },
		model: { type: String, trim: true, default: "" },
		summary: { type: String, trim: true, default: "" },
		humanEdited: { type: Boolean, default: false },
	},
	{ _id: false },
);

/**
 * Provenance history for academic integrity review.
 * Summarises the AI-assisted research process without exposing raw research materials.
 */
const researchProvenanceRecordSchema = new Schema(
	{
		outputRef: { type: String, required: true, trim: true, index: true },
		outputTitle: { type: String, required: true, trim: true },
		outputType: {
			type: String,
			enum: ["paper", "outline", "draft", "idea", "note", "dataset", "other"],
			default: "draft",
			index: true,
		},
		ownerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
		ownerName: { type: String, trim: true, default: "" },
		ownerEmail: { type: String, trim: true, default: "" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		faculty: { type: String, trim: true, index: true },
		department: { type: String, trim: true },
		status: {
			type: String,
			enum: ["available", "under_review", "cleared", "escalated"],
			default: "available",
			index: true,
		},
		privacyRedacted: { type: Boolean, default: true },
		events: { type: [provenanceEventSchema], default: [] },
		reviewNotes: { type: String, trim: true, default: "" },
		reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
		reviewedByName: { type: String, trim: true, default: "" },
		reviewedAt: { type: Date },
		accessGrantedTo: { type: [String], default: [] },
	},
	{ timestamps: true },
);

researchProvenanceRecordSchema.index({ status: 1, createdAt: -1 });

export type ResearchProvenanceRecordDocument = InferSchemaType<
	typeof researchProvenanceRecordSchema
> & {
	_id: Types.ObjectId;
};

export const ResearchProvenanceRecordModel = model(
	"ResearchProvenanceRecord",
	researchProvenanceRecordSchema,
);
