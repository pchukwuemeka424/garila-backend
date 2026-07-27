import { MessageModel } from "../db/models/Message.js";
import { SessionModel } from "../db/models/Session.js";
import { enrichSessionsWithOwnership } from "./session-enrichment.service.js";

export type AdminSessionRecord = {
	id: string;
	topic: string;
	workflow: string | null;
	model: string;
	state: string;
	messageCount: number;
	lectureTitle: string | null;
	generatedByName: string | null;
	generatedByEmail: string | null;
	createdAt: string;
	updatedAt: string;
};

async function messageCountMap(sessionIds: Array<{ toString(): string }>) {
	if (sessionIds.length === 0) return new Map<string, number>();

	const messageCounts = await MessageModel.aggregate<{ _id: (typeof sessionIds)[number]; count: number }>([
		{ $match: { sessionId: { $in: sessionIds }, role: { $in: ["user", "assistant"] } } },
		{ $group: { _id: "$sessionId", count: { $sum: 1 } } },
	]);

	return new Map(messageCounts.map((row) => [row._id.toString(), row.count]));
}

function toAdminSessionRecord(
	session: {
		_id: { toString(): string };
		userId?: { toString(): string } | null;
		topic?: string | null;
		workflow?: string | null;
		model: string;
		state: string;
		createdAt: Date;
		updatedAt: Date;
	},
	countMap: Map<string, number>,
): Omit<AdminSessionRecord, "lectureTitle" | "generatedByName" | "generatedByEmail"> & {
	userId: string | null;
} {
	const id = session._id.toString();
	return {
		id,
		userId: session.userId?.toString() ?? null,
		topic: session.topic?.trim() || session.workflow?.trim() || "General research",
		workflow: session.workflow ?? null,
		model: session.model,
		state: session.state,
		messageCount: countMap.get(id) ?? 0,
		createdAt: session.createdAt.toISOString(),
		updatedAt: session.updatedAt.toISOString(),
	};
}

async function enrichOne(
	session: Omit<AdminSessionRecord, "lectureTitle" | "generatedByName" | "generatedByEmail"> & {
		userId: string | null;
	},
): Promise<AdminSessionRecord> {
	const [enriched] = await enrichSessionsWithOwnership([session]);
	return enriched!;
}

export async function getAdminSession(id: string): Promise<AdminSessionRecord | null> {
	const session = await SessionModel.findById(id)
		.select("userId topic workflow model state createdAt updatedAt")
		.lean();
	if (!session) return null;

	const countMap = await messageCountMap([session._id]);
	return enrichOne(toAdminSessionRecord(session, countMap));
}

export async function deleteAdminSession(id: string): Promise<boolean> {
	const session = await SessionModel.findByIdAndDelete(id);
	if (!session) return false;
	await MessageModel.deleteMany({ sessionId: session._id });
	return true;
}

export async function stopAdminSession(id: string): Promise<AdminSessionRecord | null> {
	const session = await SessionModel.findByIdAndUpdate(
		id,
		{ state: "idle", error: undefined },
		{ new: true },
	)
		.select("userId topic workflow model state createdAt updatedAt")
		.lean();
	if (!session) return null;

	const countMap = await messageCountMap([session._id]);
	return enrichOne(toAdminSessionRecord(session, countMap));
}
