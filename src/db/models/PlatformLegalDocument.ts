import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const LEGAL_DOCUMENT_IDS = ["terms", "privacy", "aup", "meta"] as const;
export type PlatformLegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];
export type PublicLegalDocumentId = Exclude<PlatformLegalDocumentId, "meta">;

const legalSectionSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		paragraphs: { type: [String], default: [] },
	},
	{ _id: false },
);

const platformLegalDocumentSchema = new Schema(
	{
		/** Document slug: terms | privacy | aup | meta (singleton policy version). */
		id: {
			type: String,
			required: true,
			unique: true,
			enum: LEGAL_DOCUMENT_IDS,
			trim: true,
		},
		title: { type: String, trim: true, default: "" },
		intro: { type: String, trim: true, default: "" },
		sections: { type: [legalSectionSchema], default: [] },
		updatedLabel: { type: String, trim: true, default: "" },
		/** Per-document revision counter (informational). */
		version: { type: String, trim: true, default: "1" },
		/** Shared account policy version — only meaningful on id:"meta". */
		accountPolicyVersion: { type: String, trim: true, default: "1" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

export type PlatformLegalDocumentDocument = InferSchemaType<typeof platformLegalDocumentSchema> & {
	_id: Types.ObjectId;
};

export const PlatformLegalDocumentModel = model(
	"PlatformLegalDocument",
	platformLegalDocumentSchema,
);
