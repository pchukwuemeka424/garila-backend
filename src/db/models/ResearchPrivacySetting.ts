import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchPrivacySettingSchema = new Schema(
	{
		name: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		dataClass: {
			type: String,
			enum: ["public", "internal", "confidential", "restricted", "special_category"],
			required: true,
			index: true,
		},
		scope: {
			type: String,
			enum: ["global", "faculty", "role", "feature"],
			default: "global",
			index: true,
		},
		faculties: { type: [String], default: [] },
		roles: { type: [String], default: [] },
		features: { type: [String], default: [] },
		adminRawAccess: {
			type: String,
			enum: ["never", "policy_authorised", "incident_only", "always"],
			default: "never",
		},
		allowGovernanceMetadata: { type: Boolean, default: true },
		allowProvenanceReview: { type: Boolean, default: true },
		redactPiiInLogs: { type: Boolean, default: true },
		requireExplicitAuthorisation: { type: Boolean, default: true },
		enabled: { type: Boolean, default: true, index: true },
		priority: { type: Number, default: 100 },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

researchPrivacySettingSchema.index({ enabled: 1, priority: 1 });
researchPrivacySettingSchema.index({ universityId: 1, enabled: 1 });

export type ResearchPrivacySettingDocument = InferSchemaType<
	typeof researchPrivacySettingSchema
> & {
	_id: Types.ObjectId;
};

export const ResearchPrivacySettingModel = model(
	"ResearchPrivacySetting",
	researchPrivacySettingSchema,
);
