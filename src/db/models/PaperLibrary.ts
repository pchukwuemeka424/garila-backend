import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const paperLibrarySchema = new Schema(
	{
		externalId: { type: String, default: "", trim: true, index: true },
		arxivId: { type: String, default: null, trim: true },
		normalizedTitle: { type: String, required: true, trim: true, index: true },
		title: { type: String, required: true, trim: true },
		abstract: { type: String, default: "", trim: true },
		authors: { type: [String], default: [] },
		publicationDate: { type: String, default: null },
		url: { type: String, default: "", trim: true },
		topics: { type: [String], default: [] },
		queryTags: { type: [String], default: [] },
		source: {
			type: String,
			enum: ["alphaxiv", "arxiv", "alphaxiv-mcp", "tavily", "manual"],
			default: "alphaxiv",
		},
		hitCount: { type: Number, default: 1 },
		lastRetrievedAt: { type: Date, default: Date.now },
	},
	{ timestamps: true },
);

/** Prefer stable arXiv IDs when present; title is a secondary match key. */
paperLibrarySchema.index({ arxivId: 1 }, { unique: true, sparse: true });
paperLibrarySchema.index({ title: "text", abstract: "text", topics: "text", queryTags: "text" });
paperLibrarySchema.index({ lastRetrievedAt: -1 });

export type PaperLibraryDocument = InferSchemaType<typeof paperLibrarySchema> & {
	_id: Types.ObjectId;
};

export const PaperLibraryModel = model("PaperLibrary", paperLibrarySchema);
