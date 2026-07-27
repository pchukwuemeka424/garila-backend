import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const presentationSlideSchema = new Schema(
	{
		title: { type: String, required: true },
		explanation: { type: String, required: true },
		bullets: { type: [String], default: [] },
		imageUrl: { type: String, default: null },
	},
	{ _id: false },
);

const presentationSchema = new Schema(
	{
		title: { type: String, required: true },
		slides: { type: [presentationSlideSchema], default: [] },
	},
	{ _id: false },
);

const savedCoursePlanSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
		title: { type: String, required: true },
		department: { type: String, required: true },
		level: { type: String, required: true },
		outline: { type: String, required: true },
		presentation: { type: presentationSchema, default: null },
	},
	{ timestamps: true },
);

savedCoursePlanSchema.index({ userId: 1, title: 1, department: 1, level: 1 });

export type SavedCoursePlanDocument = InferSchemaType<typeof savedCoursePlanSchema> & { _id: Types.ObjectId };

export const SavedCoursePlanModel = model("SavedCoursePlan", savedCoursePlanSchema);
