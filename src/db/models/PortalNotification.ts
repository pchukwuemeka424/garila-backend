import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const schema = new Schema(
	{
		universityId: { type: Schema.Types.ObjectId, required: true, index: true },
		userId: { type: Schema.Types.ObjectId, required: true, index: true },
		type: { type: String, required: true },
		title: { type: String, required: true, maxlength: 200 },
		body: { type: String, required: true, maxlength: 2000 },
		data: { type: Schema.Types.Mixed, default: {} },
		channels: { type: [String], default: ["in_app"] },
		readAt: Date,
	},
	{ timestamps: true, collection: "portalnotifications" },
);

schema.index({ universityId: 1, userId: 1, readAt: 1, createdAt: -1 });

export type PortalNotificationDocument = InferSchemaType<typeof schema> & {
	_id: Types.ObjectId;
};

export const PortalNotificationModel = model("PortalNotification", schema);
