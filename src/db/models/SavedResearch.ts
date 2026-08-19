import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const tokenUsageSchema = new Schema(
	{
		promptTokens: { type: Number, required: true },
		completionTokens: { type: Number, required: true },
		totalTokens: { type: Number, required: true },
	},
	{ _id: false },
);

const savedResearchSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
		sessionId: { type: Schema.Types.ObjectId, ref: "Session", index: true },
		workflow: { type: String, default: "chat-paper" },
		topic: { type: String, required: true },
		title: { type: String, required: true },
		content: { type: String, required: true },
		/** Content as last written by AI — used to score user edit effort. */
		aiBaselineContent: { type: String, default: null },
		humanEdited: { type: Boolean, default: false },
		/** Sources selected when the paper was generated (for effort / attribution). */
		sources: {
			documentIds: { type: [String], default: [] },
			datasetIds: { type: [String], default: [] },
			questionnaireIds: { type: [String], default: [] },
			noteIds: { type: [String], default: [] },
			projectIds: { type: [String], default: [] },
		},
		tokenUsage: { type: tokenUsageSchema },
	},
	{ timestamps: true },
);

savedResearchSchema.index({ userId: 1, topic: 1, title: 1 });

export type SavedResearchDocument = InferSchemaType<typeof savedResearchSchema> & { _id: Types.ObjectId };

export const SavedResearchModel = model("SavedResearch", savedResearchSchema);
