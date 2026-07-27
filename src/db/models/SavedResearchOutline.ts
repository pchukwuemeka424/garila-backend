import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const savedResearchOutlineSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
		ideaId: { type: String, required: true },
		ideaTitle: { type: String, required: true },
		discipline: { type: String, required: true },
		topic: { type: String, required: true },
		scope: {
			type: String,
			enum: ["undergraduate", "masters", "doctoral", "faculty"],
			required: true,
		},
		outline: { type: String, required: true },
	},
	{ timestamps: true },
);

savedResearchOutlineSchema.index(
	{ userId: 1, ideaId: 1, ideaTitle: 1, discipline: 1, topic: 1, scope: 1 },
	{ unique: true },
);

export type SavedResearchOutlineDocument = InferSchemaType<typeof savedResearchOutlineSchema> & {
	_id: Types.ObjectId;
};

export const SavedResearchOutlineModel = model("SavedResearchOutline", savedResearchOutlineSchema);
