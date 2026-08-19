import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const governanceReportSchema = new Schema(
	{
		title: { type: String, required: true, trim: true },
		audience: {
			type: String,
			enum: ["management", "senate", "both", "external_auditors"],
			required: true,
			index: true,
		},
		periodStart: { type: Date, required: true },
		periodEnd: { type: Date, required: true },
		status: {
			type: String,
			enum: ["draft", "final", "archived"],
			default: "draft",
		},
		summary: { type: String, trim: true, default: "" },
		sections: {
			type: [
				{
					heading: { type: String, required: true },
					body: { type: String, required: true },
					metrics: { type: Schema.Types.Mixed },
				},
			],
			default: [],
		},
		metrics: { type: Schema.Types.Mixed },
		universityId: { type: Schema.Types.ObjectId, ref: "University", index: true },
		generatedBy: { type: Schema.Types.ObjectId, ref: "User" },
		generatedByName: { type: String, trim: true },
	},
	{ timestamps: true },
);

governanceReportSchema.index({ audience: 1, createdAt: -1 });
governanceReportSchema.index({ universityId: 1, createdAt: -1 });

export type GovernanceReportDocument = InferSchemaType<typeof governanceReportSchema> & {
	_id: Types.ObjectId;
};

export const GovernanceReportModel = model("GovernanceReport", governanceReportSchema);
