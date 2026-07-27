import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const sessionSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
		workflow: { type: String },
		topic: { type: String },
		systemPrompt: { type: String },
		model: { type: String, required: true },
		state: {
			type: String,
			enum: ["idle", "starting", "running", "error"],
			default: "idle",
		},
		error: { type: String },
	},
	{ timestamps: true },
);

export type SessionDocument = InferSchemaType<typeof sessionSchema> & { _id: Types.ObjectId };

export const SessionModel = model("Session", sessionSchema);
