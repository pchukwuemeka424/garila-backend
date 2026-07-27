import { Schema, model, type InferSchemaType, type Types } from "mongoose";

/**
 * AI contribution disclosure metadata for a research output.
 * Does not store the research content itself — only verification metadata.
 */
const aiContributionStatementSchema = new Schema(
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
		programme: { type: String, trim: true },
		aiAssisted: { type: Boolean, default: true },
		contributionSummary: { type: String, trim: true, default: "" },
		toolsUsed: { type: [String], default: [] },
		modelNames: { type: [String], default: [] },
		humanEdited: { type: Boolean, default: false },
		disclosureComplete: { type: Boolean, default: false, index: true },
		verified: { type: Boolean, default: false, index: true },
		verifiedAt: { type: Date },
		verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
		verifiedByName: { type: String, trim: true, default: "" },
		verificationNotes: { type: String, trim: true, default: "" },
		generatedAt: { type: Date, default: Date.now },
	},
	{ timestamps: true },
);

aiContributionStatementSchema.index({ verified: 1, disclosureComplete: 1, createdAt: -1 });

export type AiContributionStatementDocument = InferSchemaType<
	typeof aiContributionStatementSchema
> & {
	_id: Types.ObjectId;
};

export const AiContributionStatementModel = model(
	"AiContributionStatement",
	aiContributionStatementSchema,
);
