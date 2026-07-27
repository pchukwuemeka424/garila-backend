import { Types } from "mongoose";

import { SavedResearchOutlineModel } from "../db/models/SavedResearchOutline.js";

export type SavedResearchOutlineDto = {
	id: string;
	userId: string;
	ideaId: string;
	ideaTitle: string;
	discipline: string;
	topic: string;
	scope: "undergraduate" | "masters" | "doctoral" | "faculty";
	outline: string;
	createdAt: string;
	updatedAt: string;
};

function toDto(doc: {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	ideaId: string;
	ideaTitle: string;
	discipline: string;
	topic: string;
	scope: string;
	outline: string;
	createdAt: Date;
	updatedAt: Date;
}): SavedResearchOutlineDto {
	return {
		id: doc._id.toString(),
		userId: doc.userId.toString(),
		ideaId: doc.ideaId,
		ideaTitle: doc.ideaTitle,
		discipline: doc.discipline,
		topic: doc.topic,
		scope: doc.scope as SavedResearchOutlineDto["scope"],
		outline: doc.outline,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function listSavedResearchOutlines(userId: string, limit = 50): Promise<SavedResearchOutlineDto[]> {
	const rows = await SavedResearchOutlineModel.find({ userId: new Types.ObjectId(userId) })
		.sort({ updatedAt: -1 })
		.limit(limit)
		.lean();

	return rows.map((row) =>
		toDto({
			...row,
			_id: row._id,
			userId: row.userId as Types.ObjectId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}),
	);
}

export async function saveResearchOutlineRecord(
	userId: string,
	input: {
		ideaId: string;
		ideaTitle: string;
		discipline: string;
		topic: string;
		scope: "undergraduate" | "masters" | "doctoral" | "faculty";
		outline: string;
	},
): Promise<SavedResearchOutlineDto> {
	const filter = {
		userId: new Types.ObjectId(userId),
		ideaId: input.ideaId.trim(),
		ideaTitle: input.ideaTitle.trim(),
		discipline: input.discipline.trim(),
		topic: input.topic.trim(),
		scope: input.scope,
	};

	const existing = await SavedResearchOutlineModel.findOne(filter);
	if (existing) {
		existing.outline = input.outline.trim();
		await existing.save();
		return toDto(existing);
	}

	const created = await SavedResearchOutlineModel.create({
		userId: new Types.ObjectId(userId),
		ideaId: input.ideaId.trim(),
		ideaTitle: input.ideaTitle.trim(),
		discipline: input.discipline.trim(),
		topic: input.topic.trim(),
		scope: input.scope,
		outline: input.outline.trim(),
	});
	return toDto(created);
}

export async function deleteSavedResearchOutline(id: string, userId: string): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;

	const result = await SavedResearchOutlineModel.findOneAndDelete({
		_id: new Types.ObjectId(id),
		userId: new Types.ObjectId(userId),
	});
	return Boolean(result);
}
