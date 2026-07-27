import { Types } from "mongoose";

import { SavedCoursePlanModel } from "../db/models/SavedCoursePlan.js";

export type StoredPresentationSlide = {
	title: string;
	explanation: string;
	bullets: string[];
	imageUrl?: string | null;
};

export type StoredPresentation = {
	title: string;
	slides: StoredPresentationSlide[];
};

export type SavedCoursePlanDto = {
	id: string;
	userId: string | null;
	title: string;
	department: string;
	level: string;
	outline: string;
	presentation: StoredPresentation | null;
	createdAt: string;
	updatedAt: string;
};

function normalizePresentation(value: unknown): StoredPresentation | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const title = typeof record.title === "string" ? record.title.trim() : "";
	const slidesRaw = record.slides;
	if (!title || !Array.isArray(slidesRaw) || slidesRaw.length === 0) return null;

	const slides: StoredPresentationSlide[] = [];
	for (const item of slidesRaw) {
		if (!item || typeof item !== "object") continue;
		const slide = item as Record<string, unknown>;
		const slideTitle = typeof slide.title === "string" ? slide.title.trim() : "";
		const explanation =
			typeof slide.explanation === "string"
				? slide.explanation.trim()
				: typeof slide.content === "string"
					? slide.content.trim()
					: "";
		const bullets = Array.isArray(slide.bullets)
			? slide.bullets.map((entry) => String(entry).trim()).filter(Boolean)
			: [];
		const imageUrl =
			typeof slide.imageUrl === "string" && slide.imageUrl.trim() ? slide.imageUrl.trim() : null;
		if (!slideTitle || !explanation) continue;
		slides.push({ title: slideTitle, explanation, bullets, ...(imageUrl ? { imageUrl } : {}) });
	}

	if (!slides.length) return null;
	return { title, slides };
}

function toDto(doc: {
	_id: Types.ObjectId;
	userId?: Types.ObjectId | null;
	title: string;
	department: string;
	level: string;
	outline: string;
	presentation?: StoredPresentation | null;
	createdAt: Date;
	updatedAt: Date;
}): SavedCoursePlanDto {
	return {
		id: doc._id.toString(),
		userId: doc.userId?.toString() ?? null,
		title: doc.title,
		department: doc.department,
		level: doc.level,
		outline: doc.outline,
		presentation: doc.presentation ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function saveCoursePlan(input: {
	userId?: string | null;
	id?: string | null;
	title: string;
	department: string;
	level: string;
	outline: string;
	presentation?: unknown | null;
}): Promise<SavedCoursePlanDto> {
	const title = input.title.trim();
	const department = input.department.trim();
	const level = input.level.trim();
	const outline = input.outline.trim();
	if (!title || !department || !level || !outline) {
		throw new Error("Title, department, level, and outline are required.");
	}

	const presentation = normalizePresentation(input.presentation);

	if (input.id && Types.ObjectId.isValid(input.id)) {
		const existing = await SavedCoursePlanModel.findById(input.id);
		if (existing) {
			const ownerId = existing.userId?.toString() ?? null;
			if (input.userId && ownerId && ownerId !== input.userId) {
				throw new Error("You do not have permission to update this course plan.");
			}
			if (!input.userId && ownerId) {
				throw new Error("Sign in to update saved course plans.");
			}

			existing.title = title;
			existing.department = department;
			existing.level = level;
			existing.outline = outline;
			if (presentation) existing.set("presentation", presentation);
			await existing.save();
			return toDto(existing);
		}
	}

	const filter: Record<string, unknown> = { title, department, level };
	if (input.userId) filter.userId = new Types.ObjectId(input.userId);

	const match = await SavedCoursePlanModel.findOne(filter).sort({ updatedAt: -1 });
	if (match) {
		match.outline = outline;
		if (presentation) match.set("presentation", presentation);
		await match.save();
		return toDto(match);
	}

	const created = await SavedCoursePlanModel.create({
		userId: input.userId ? new Types.ObjectId(input.userId) : undefined,
		title,
		department,
		level,
		outline,
		...(presentation ? { presentation } : {}),
	});
	return toDto(created);
}

export async function listSavedCoursePlans(userId?: string | null, limit = 30): Promise<SavedCoursePlanDto[]> {
	const query: Record<string, unknown> = userId
		? { userId: new Types.ObjectId(userId) }
		: { $or: [{ userId: { $exists: false } }, { userId: null }] };

	const rows = await SavedCoursePlanModel.find(query).sort({ updatedAt: -1 }).limit(limit).lean();
	return rows.map((row) =>
		toDto({
			...row,
			_id: row._id,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}),
	);
}

export async function getSavedCoursePlan(
	id: string,
	userId?: string | null,
): Promise<SavedCoursePlanDto | null> {
	if (!Types.ObjectId.isValid(id)) return null;

	const doc = await SavedCoursePlanModel.findById(id).lean();
	if (!doc) return null;

	const ownerId = doc.userId?.toString() ?? null;
	if (userId) {
		if (ownerId && ownerId !== userId) return null;
	} else if (ownerId) {
		return null;
	}

	return toDto({
		...doc,
		_id: doc._id,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
	});
}

export async function deleteSavedCoursePlan(id: string, userId?: string | null): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;

	const doc = await SavedCoursePlanModel.findById(id);
	if (!doc) return false;

	const ownerId = doc.userId?.toString() ?? null;
	if (userId) {
		if (ownerId && ownerId !== userId) return false;
	} else if (ownerId) {
		return false;
	}

	const result = await SavedCoursePlanModel.findByIdAndDelete(id);
	return Boolean(result);
}
