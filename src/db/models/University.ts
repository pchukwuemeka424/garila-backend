import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const universitySchema = new Schema(
	{
		catalogueId: { type: String, required: true, unique: true, trim: true, lowercase: true },
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
		status: { type: String, enum: ["active", "inactive"], default: "inactive", index: true },
		onboardedAt: { type: Date },
		onboardedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

export type UniversityDocument = InferSchemaType<typeof universitySchema> & { _id: Types.ObjectId };

export const UniversityModel = model("University", universitySchema);
