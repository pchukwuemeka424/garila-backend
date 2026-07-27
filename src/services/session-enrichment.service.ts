import { Types } from "mongoose";

import { SavedCoursePlanModel } from "../db/models/SavedCoursePlan.js";
import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { UserModel } from "../db/models/User.js";

export type SessionOwnershipFields = {
	lectureTitle: string | null;
	generatedByName: string | null;
	generatedByEmail: string | null;
};

type LectureRow = {
	title: string;
	updatedAt: Date;
};

function normalizeText(value: string): string {
	return value.trim().toLowerCase();
}

function matchLectureTitle(lectures: LectureRow[], topic: string | null | undefined): string | null {
	if (!topic?.trim() || lectures.length === 0) return null;

	const normalizedTopic = normalizeText(topic);

	for (const lecture of lectures) {
		const title = lecture.title.trim();
		if (normalizeText(title) === normalizedTopic) return title;
	}

	for (const lecture of lectures) {
		const title = lecture.title.trim();
		const normalizedTitle = normalizeText(title);
		if (normalizedTopic.includes(normalizedTitle) || normalizedTitle.includes(normalizedTopic)) {
			return title;
		}
	}

	return null;
}

export async function enrichSessionsWithOwnership<
	T extends { id: string; topic: string; userId?: string | null },
>(rows: T[]): Promise<Array<T & SessionOwnershipFields>> {
	if (rows.length === 0) return [];

	const sessionIds = rows.map((row) => new Types.ObjectId(row.id));
	const researches = await SavedResearchModel.find({ sessionId: { $in: sessionIds } })
		.select("sessionId userId title")
		.lean();
	const researchBySession = new Map(researches.map((row) => [row.sessionId!.toString(), row]));

	const userIds = new Set<string>();
	for (const row of rows) {
		if (row.userId) userIds.add(row.userId);
	}
	for (const research of researches) {
		if (research.userId) userIds.add(research.userId.toString());
	}

	const [users, lectures] = await Promise.all([
		userIds.size > 0
			? UserModel.find({ _id: { $in: [...userIds] } })
					.select("name email")
					.lean()
			: Promise.resolve([]),
		userIds.size > 0
			? SavedCoursePlanModel.find({ userId: { $in: [...userIds] } })
					.select("userId title updatedAt")
					.sort({ updatedAt: -1 })
					.lean()
			: Promise.resolve([]),
	]);

	const userMap = new Map(users.map((user) => [user._id.toString(), user]));
	const lecturesByUser = new Map<string, LectureRow[]>();
	for (const lecture of lectures) {
		const userId = lecture.userId?.toString();
		if (!userId) continue;
		const list = lecturesByUser.get(userId) ?? [];
		list.push({ title: lecture.title, updatedAt: lecture.updatedAt });
		lecturesByUser.set(userId, list);
	}

	return rows.map((row) => {
		const research = researchBySession.get(row.id);
		const userId = row.userId ?? research?.userId?.toString() ?? null;
		const user = userId ? userMap.get(userId) : null;
		const userLectures = userId ? (lecturesByUser.get(userId) ?? []) : [];
		const lectureTitle =
			matchLectureTitle(userLectures, row.topic) ?? research?.title?.trim() ?? null;

		return {
			...row,
			lectureTitle,
			generatedByName: user?.name ?? null,
			generatedByEmail: user?.email ?? null,
		};
	});
}
