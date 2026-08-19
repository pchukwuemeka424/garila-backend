import { Types } from "mongoose";

import { ResearchIdeaSessionModel } from "../db/models/ResearchIdeaSession.js";

export type ResearchIdeaInput = {
	id: string;
	title: string;
	rationale: string;
	approach: string;
	type: string;
	feasibility: string;
	outline?: string;
	researchQuestions?: string[];
};

export type ResearchIdeaSessionDto = {
	id: string;
	userId: string;
	discipline: string;
	topic: string;
	scope: "assignment" | "conference" | "dissertation" | "faculty" | "journal" | "proposal" | "report" | "thesis" | "undergraduate_project";
	ideas: ResearchIdeaInput[];
	createdAt: string;
	updatedAt: string;
};

function normalizeIdeas(
	ideas: Array<{
		id?: string | null;
		title?: string | null;
		rationale?: string | null;
		approach?: string | null;
		type?: string | null;
		feasibility?: string | null;
		outline?: string | null;
		researchQuestions?: string[] | null;
	}>,
): ResearchIdeaInput[] {
	return ideas.map((idea) => ({
		id: idea.id ?? "",
		title: idea.title ?? "",
		rationale: idea.rationale ?? "",
		approach: idea.approach ?? "",
		type: idea.type ?? "",
		feasibility: idea.feasibility ?? "",
		...(idea.outline?.trim() ? { outline: idea.outline } : {}),
		...(idea.researchQuestions?.length ? { researchQuestions: idea.researchQuestions } : {}),
	}));
}

function toDto(doc: {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	discipline: string;
	topic: string;
	scope: string;
	ideas: Array<{
		id?: string | null;
		title?: string | null;
		rationale?: string | null;
		approach?: string | null;
		type?: string | null;
		feasibility?: string | null;
		outline?: string | null;
		researchQuestions?: string[] | null;
	}>;
	createdAt: Date;
	updatedAt: Date;
}): ResearchIdeaSessionDto {
	return {
		id: doc._id.toString(),
		userId: doc.userId.toString(),
		discipline: doc.discipline,
		topic: doc.topic,
		scope: doc.scope as ResearchIdeaSessionDto["scope"],
		ideas: normalizeIdeas(doc.ideas ?? []),
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function listResearchIdeaSessions(userId: string, limit = 20): Promise<ResearchIdeaSessionDto[]> {
	const rows = await ResearchIdeaSessionModel.find({ userId: new Types.ObjectId(userId) })
		.sort({ updatedAt: -1 })
		.limit(limit)
		.lean();

	return rows.map((row) =>
		toDto({
			...row,
			_id: row._id,
			userId: row.userId as Types.ObjectId,
			ideas: row.ideas as ResearchIdeaInput[],
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}),
	);
}

export async function saveResearchIdeaSession(
	userId: string,
	input: {
		discipline: string;
		topic: string;
		scope: "assignment" | "conference" | "dissertation" | "faculty" | "journal" | "proposal" | "report" | "thesis" | "undergraduate_project";
		ideas: ResearchIdeaInput[];
	},
): Promise<ResearchIdeaSessionDto> {
	const filter = {
		userId: new Types.ObjectId(userId),
		discipline: input.discipline.trim(),
		topic: input.topic.trim(),
	};

	const existing = await ResearchIdeaSessionModel.findOne(filter);
	if (existing) {
		existing.scope = input.scope;
		existing.set("ideas", input.ideas);
		await existing.save();
		return toDto(existing);
	}

	const created = await ResearchIdeaSessionModel.create({
		userId: new Types.ObjectId(userId),
		discipline: input.discipline.trim(),
		topic: input.topic.trim(),
		scope: input.scope,
		ideas: input.ideas,
	});
	return toDto(created);
}

export async function deleteResearchIdeaSession(id: string, userId: string): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;

	const result = await ResearchIdeaSessionModel.findOneAndDelete({
		_id: new Types.ObjectId(id),
		userId: new Types.ObjectId(userId),
	});
	return Boolean(result);
}
