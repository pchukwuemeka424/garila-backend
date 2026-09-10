import { Schema, model, type InferSchemaType, type Types } from "mongoose";

import { DEFAULT_UNIVERSITY_FEATURES } from "../../lib/university-features.js";

const universityFeaturesSchema = new Schema(
	{
		researchAssistant: { type: Boolean, default: true },
		researchNotebook: { type: Boolean, default: true },
		studentAssessment: { type: Boolean, default: true },
		supervisionAssistant: { type: Boolean, default: true },
		advancedResearch: { type: Boolean, default: true },
	},
	{ _id: false },
);

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
		/** Product modules enabled for this tenant (missing keys default on). */
		features: {
			type: universityFeaturesSchema,
			default: () => ({ ...DEFAULT_UNIVERSITY_FEATURES }),
		},
		onboardedAt: { type: Date },
		onboardedBy: { type: Schema.Types.ObjectId, ref: "User" },
	},
	{ timestamps: true },
);

export type UniversityDocument = InferSchemaType<typeof universitySchema> & { _id: Types.ObjectId };

export const UniversityModel = model("University", universitySchema);
