import { Types } from "mongoose";

import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { UserModel } from "../db/models/User.js";

export type SessionOwnershipFields = {
	lectureTitle: string | null;
	generatedByName: string | null;
	generatedByEmail: string | null;
};

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

	const users =
		userIds.size > 0
			? await UserModel.find({ _id: { $in: [...userIds] } })
					.select("name email")
					.lean()
			: [];

	const userMap = new Map(users.map((user) => [user._id.toString(), user]));

	return rows.map((row) => {
		const research = researchBySession.get(row.id);
		const userId = row.userId ?? research?.userId?.toString() ?? null;
		const user = userId ? userMap.get(userId) : null;

		return {
			...row,
			lectureTitle: research?.title?.trim() ?? null,
			generatedByName: user?.name ?? null,
			generatedByEmail: user?.email ?? null,
		};
	});
}
