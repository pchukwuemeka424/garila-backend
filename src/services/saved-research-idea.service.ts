import { Types } from "mongoose";

import { SavedResearchIdeaModel } from "../db/models/SavedResearchIdea.js";

export type SavedResearchIdeaDto = {
	id: string;
	userId: string;
	ideaId: string;
	title: string;
	rationale: string;
	approach: string;
	outline?: string;
	researchQuestions?: string[];
	type: string;
	feasibility: string;
	discipline: string;
	topic: string;
	status: "saved" | "in_progress" | "completed";
	savedAt: string;
	createdAt: string;
	updatedAt: string;
};

function toDto(doc: {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	ideaId: string;
	title: string;
	rationale: string;
	approach: string;
	outline?: string | null;
	researchQuestions?: string[] | null;
	type: string;
	feasibility: string;
	discipline: string;
	topic: string;
	status?: string;
	createdAt: Date;
	updatedAt: Date;
}): SavedResearchIdeaDto {
	return {
		id: doc._id.toString(),
		userId: doc.userId.toString(),
		ideaId: doc.ideaId,
		title: doc.title,
		rationale: doc.rationale,
		approach: doc.approach,
		...(doc.outline?.trim() ? { outline: doc.outline } : {}),
		...(doc.researchQuestions?.length ? { researchQuestions: doc.researchQuestions } : {}),
		type: doc.type,
		feasibility: doc.feasibility,
		discipline: doc.discipline,
		topic: doc.topic,
		status: (doc.status as SavedResearchIdeaDto["status"]) ?? "saved",
		savedAt: doc.createdAt.toISOString(),
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function listSavedResearchIdeas(userId: string, limit = 50): Promise<SavedResearchIdeaDto[]> {
	const rows = await SavedResearchIdeaModel.find({ userId: new Types.ObjectId(userId) })
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

export async function saveResearchIdea(
	userId: string,
	input: {
		ideaId: string;
		title: string;
		rationale: string;
		approach: string;
		type: string;
		feasibility: string;
		discipline: string;
		topic: string;
		status?: "saved" | "in_progress" | "completed";
		outline?: string;
		researchQuestions?: string[];
	},
): Promise<SavedResearchIdeaDto> {
	const filter = {
		userId: new Types.ObjectId(userId),
		ideaId: input.ideaId.trim(),
		title: input.title.trim(),
	};

	const existing = await SavedResearchIdeaModel.findOne(filter);
	if (existing) {
		existing.rationale = input.rationale.trim();
		existing.approach = input.approach.trim();
		existing.type = input.type;
		existing.feasibility = input.feasibility;
		existing.discipline = input.discipline.trim();
		existing.topic = input.topic.trim();
		if (input.outline !== undefined) existing.outline = input.outline.trim();
		if (input.researchQuestions !== undefined) existing.researchQuestions = input.researchQuestions;
		if (input.status) existing.status = input.status;
		await existing.save();
		return toDto(existing);
	}

	const created = await SavedResearchIdeaModel.create({
		userId: new Types.ObjectId(userId),
		ideaId: input.ideaId.trim(),
		title: input.title.trim(),
		rationale: input.rationale.trim(),
		approach: input.approach.trim(),
		type: input.type,
		feasibility: input.feasibility,
		discipline: input.discipline.trim(),
		topic: input.topic.trim(),
		status: input.status ?? "saved",
		...(input.outline?.trim() ? { outline: input.outline.trim() } : {}),
		...(input.researchQuestions?.length ? { researchQuestions: input.researchQuestions } : {}),
	});
	return toDto(created);
}

export async function updateResearchIdeaStatus(
	id: string,
	userId: string,
	status: "saved" | "in_progress" | "completed",
): Promise<SavedResearchIdeaDto | null> {
	if (!Types.ObjectId.isValid(id)) return null;

	const doc = await SavedResearchIdeaModel.findOne({
		_id: new Types.ObjectId(id),
		userId: new Types.ObjectId(userId),
	});
	if (!doc) return null;

	doc.status = status;
	await doc.save();
	return toDto(doc);
}

export async function deleteSavedResearchIdea(id: string, userId: string): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;

	const result = await SavedResearchIdeaModel.findOneAndDelete({
		_id: new Types.ObjectId(id),
		userId: new Types.ObjectId(userId),
	});
	return Boolean(result);
}

export async function deleteAllSavedResearchIdeas(userId: string): Promise<number> {
	const result = await SavedResearchIdeaModel.deleteMany({ userId: new Types.ObjectId(userId) });
	return result.deletedCount;
}
