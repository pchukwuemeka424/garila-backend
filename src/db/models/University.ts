import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const universitySchema = new Schema(
	{
		catalogueId: { type: String, required: true, unique: true, trim: true, lowercase: true },
		name: { type: String, required: true, trim: true },
		slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
		country: {
			type: String,
			required: true,
			trim: true,
			uppercase: true,
			default: "NG",
			index: true,
		},
		status: { type: String, enum: ["active", "inactive"], default: "inactive", index: true },
		/** Default research-token allowance for students at this university (null = platform default). */
		defaultStudentTokens: { type: Number, min: 0, default: null },
		/** Default research-token allowance for lecturers/researchers (null = platform default). */
		defaultLecturerTokens: { type: Number, min: 0, default: null },
		onboardedAt: { type: Date },
		onboardedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

export type UniversityDocument = InferSchemaType<typeof universitySchema> & { _id: Types.ObjectId };

export const UniversityModel = model("University", universitySchema);
