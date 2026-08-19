import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const governancePolicySchema = new Schema(
	{
		name: { type: String, required: true, trim: true },
		description: { type: String, trim: true, default: "" },
		/** What the rule applies to: feature, data class, or use-case category */
		scope: {
			type: String,
			enum: ["feature", "dataset", "tool", "use_case", "content"],
			required: true,
		},
		/** Target identifier e.g. research-ideas, research-paper-ai, personal-data */
		target: { type: String, required: true, trim: true },
		effect: {
			type: String,
			enum: ["permitted", "restricted", "blocked"],
			required: true,
		},
		/** Empty = all roles */
		roles: {
			type: [{ type: String, enum: ["lecturer", "admin", "viewer", "researcher", "student"] }],
			default: [],
		},
		/** Empty = all faculties */
		faculties: { type: [String], default: [] },
		enabled: { type: Boolean, default: true },
		priority: { type: Number, default: 100, min: 0 },
		createdBy: { type: Schema.Types.ObjectId, ref: "User" },
		updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
	},
	{ timestamps: true },
);

governancePolicySchema.index({ scope: 1, target: 1, enabled: 1 });
governancePolicySchema.index({ priority: 1 });

export type GovernancePolicyDocument = InferSchemaType<typeof governancePolicySchema> & {
	_id: Types.ObjectId;
};

export const GovernancePolicyModel = model("GovernancePolicy", governancePolicySchema);
