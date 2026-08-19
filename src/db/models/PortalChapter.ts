import { Schema, model, type InferSchemaType, type Types } from "mongoose";

import { ChapterStatus } from "../../lib/portal-enums.js";

const schema = new Schema(
	{
		universityId: { type: Schema.Types.ObjectId, required: true, index: true },
		projectId: { type: Schema.Types.ObjectId, required: true, index: true },
		number: { type: Number, required: true, min: 1, max: 20 },
		title: { type: String, required: true, trim: true },
		content: { type: String, default: "" },
		status: {
			type: String,
			enum: Object.values(ChapterStatus),
			default: ChapterStatus.Draft,
		},
		locked: { type: Boolean, default: false },
		currentVersionId: Schema.Types.ObjectId,
		unlockedAt: { type: Date, default: Date.now },
		approvedAt: Date,
		rejectionReason: String,
		reviewDraftRemark: { type: String, default: "", maxlength: 5000 },
		reviewAnnotatedHtml: { type: String, default: "" },
		aiReviewerReport: { type: Schema.Types.Mixed },
		aiReviewerAt: Date,
		deletedAt: Date,
	},
	{ timestamps: true, collection: "portalchapters" },
);

schema.index({ universityId: 1, projectId: 1, number: 1 }, { unique: true });

export type PortalChapterDocument = InferSchemaType<typeof schema> & {
	_id: Types.ObjectId;
};

export const PortalChapterModel = model("PortalChapter", schema);
