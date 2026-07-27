import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const outputArtifactSchema = new Schema(
	{
		path: { type: String, required: true, unique: true, index: true },
		name: { type: String, required: true },
		kind: { type: String, enum: ["file", "directory"], required: true },
		size: { type: Number },
		modified: { type: Date },
		content: { type: String },
	},
	{ timestamps: true },
);

export type OutputArtifactDocument = InferSchemaType<typeof outputArtifactSchema> & { _id: Types.ObjectId };

export const OutputArtifactModel = model("OutputArtifact", outputArtifactSchema);
