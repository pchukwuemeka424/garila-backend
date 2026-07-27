import { Types } from "mongoose";

import { SavedCoursePlanModel } from "../db/models/SavedCoursePlan.js";
import { UserModel } from "../db/models/User.js";
import type { SavedCoursePlanDto } from "./lesson-planner-save.service.js";

export type AdminLectureRecord = SavedCoursePlanDto & {
	ownerName: string | null;
	ownerEmail: string | null;
	slideCount: number;
};

export type LectureAdminStats = {
	total: number;
	withPresentation: number;
	withoutPresentation: number;
};

export async function listAllLectures(limit = 200): Promise<AdminLectureRecord[]> {
	const rows = await SavedCoursePlanModel.find().sort({ updatedAt: -1 }).limit(limit).lean();
	const userIds = [
		...new Set(rows.map((row) => row.userId?.toString()).filter((id): id is string => Boolean(id))),
	];

	const users = await UserModel.find({ _id: { $in: userIds } })
		.select("name email")
		.lean();
	const userMap = new Map(users.map((user) => [user._id.toString(), user]));

	return rows.map((row) => {
		const owner = row.userId ? userMap.get(row.userId.toString()) : null;
		return {
			id: row._id.toString(),
			userId: row.userId?.toString() ?? null,
			title: row.title,
			department: row.department,
			level: row.level,
			outline: row.outline,
			presentation: row.presentation ?? null,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
			ownerName: owner?.name ?? null,
			ownerEmail: owner?.email ?? null,
			slideCount: row.presentation?.slides?.length ?? 0,
		};
	});
}

export async function adminDeleteLecture(id: string): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;
	const result = await SavedCoursePlanModel.findByIdAndDelete(id);
	return Boolean(result);
}

export async function getLectureAdminStats(): Promise<LectureAdminStats> {
	const [total, withPresentation] = await Promise.all([
		SavedCoursePlanModel.countDocuments(),
		SavedCoursePlanModel.countDocuments({ "presentation.slides.0": { $exists: true } }),
	]);
	return {
		total,
		withPresentation,
		withoutPresentation: total - withPresentation,
	};
}
