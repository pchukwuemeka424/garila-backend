import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const researchJobSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		sessionId: { type: Schema.Types.ObjectId, ref: "Session", index: true },
		topic: { type: String, required: true },
		/** Full generation prompt — required to auto-requeue after server restart. */
		prompt: { type: String },
		/** How many times this job was auto-restarted after a server crash/deploy. */
		restartCount: { type: Number, default: 0, min: 0 },
		status: {
			type: String,
			enum: ["queued", "running", "completed", "failed", "cancelled"],
			default: "queued",
			index: true,
		},
		/** 0–100 generation progress for UI polling. */
		progress: { type: Number, default: 0, min: 0, max: 100 },
		savedResearchId: { type: Schema.Types.ObjectId, ref: "SavedResearch" },
		error: { type: String },
		notifiedAt: { type: Date },
	},
	{ timestamps: true },
);

researchJobSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export type ResearchJobDocument = InferSchemaType<typeof researchJobSchema> & {
	_id: Types.ObjectId;
};

export const ResearchJobModel = model("ResearchJob", researchJobSchema);
