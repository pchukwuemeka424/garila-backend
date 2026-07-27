import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const messageSchema = new Schema(
	{
		sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true, index: true },
		role: { type: String, enum: ["user", "assistant", "system"], required: true },
		content: { type: String, required: true },
	},
	{ timestamps: true },
);

export type MessageDocument = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId };

export const MessageModel = model("Message", messageSchema);
