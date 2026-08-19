import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const rubricCriterionSchema = new Schema(
	{
		name: { type: String, required: true, trim: true, maxlength: 200 },
		maxMarks: { type: Number, required: true, min: 0, max: 1000 },
	},
	{ _id: false },
);

const schema = new Schema(
	{
		universityId: { type: Schema.Types.ObjectId, required: true, index: true },
		lecturerId: { type: Schema.Types.ObjectId, required: true, index: true },
		title: { type: String, required: true, trim: true, maxlength: 300 },
		instructions: { type: String, default: "", maxlength: 50_000 },
		requiredItems: {
			type: [{ type: String, trim: true, maxlength: 300 }],
			default: [],
		},
		wordCountMin: { type: Number, default: null, min: 0, max: 200_000 },
		wordCountMax: { type: Number, default: null, min: 0, max: 200_000 },
		maxScore: { type: Number, default: 100, min: 1, max: 1000 },
		rubric: { type: [rubricCriterionSchema], default: [] },
		dueAt: { type: Date, default: null },
		allowLateSubmission: { type: Boolean, default: true },
		courseName: { type: String, trim: true, maxlength: 200, default: "" },
		courseYear: { type: String, trim: true, maxlength: 32, default: "" },
		status: {
			type: String,
			enum: ["draft", "published"],
			default: "draft",
		},
		deletedAt: Date,
	},
	{ timestamps: true, collection: "assignmentbriefs" },
);

schema.index({ universityId: 1, lecturerId: 1, status: 1 });
schema.index({ universityId: 1, status: 1, updatedAt: -1 });

export type AssignmentBriefDocument = InferSchemaType<typeof schema> & {
	_id: Types.ObjectId;
};

export const AssignmentBriefModel = model("AssignmentBrief", schema);
