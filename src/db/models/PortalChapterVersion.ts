import { Schema, model, type InferSchemaType, type Types } from "mongoose";

import { ContentType } from "../../lib/portal-enums.js";

const schema = new Schema(
	{
		universityId: { type: Schema.Types.ObjectId, required: true },
		chapterId: { type: Schema.Types.ObjectId, required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, required: true },
		versionNumber: { type: Number, required: true, min: 1 },
		contentType: { type: String, enum: Object.values(ContentType), required: true },
		storageKey: String,
		richTextJson: Schema.Types.Mixed,
		submittedBy: { type: Schema.Types.ObjectId, required: true },
		submittedAt: { type: Date, required: true },
		checksum: String,
		wordCount: { type: Number, min: 0 },
		deletedAt: Date,
	},
	{ timestamps: true, collection: "portalchapterversions" },
);

schema.index({ universityId: 1, chapterId: 1, versionNumber: 1 }, { unique: true });

export type PortalChapterVersionDocument = InferSchemaType<typeof schema> & {
	_id: Types.ObjectId;
};

export const PortalChapterVersionModel = model("PortalChapterVersion", schema);
