import { Types } from "mongoose";

import { ResearchJobModel } from "../db/models/ResearchJob.js";
import type { AppContext } from "../lib/app-context.js";
import { ChatService } from "./chat.service.js";

export type ResearchJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ResearchJobDto = {
	id: string;
	userId: string;
	sessionId: string | null;
	topic: string;
	status: ResearchJobStatus;
	savedResearchId: string | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
};

const ACTIVE_STATUSES: ResearchJobStatus[] = ["queued", "running"];

/** In-process runners keyed by job id — used for cancel; not durable across restarts. */
const runners = new Map<string, ChatService>();

function toDto(doc: {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	sessionId?: Types.ObjectId | null;
	topic: string;
	status: string;
	savedResearchId?: Types.ObjectId | null;
	error?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchJobDto {
	return {
		id: doc._id.toString(),
		userId: doc.userId.toString(),
		sessionId: doc.sessionId?.toString() ?? null,
		topic: doc.topic,
		status: doc.status as ResearchJobStatus,
		savedResearchId: doc.savedResearchId?.toString() ?? null,
		error: doc.error ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function failOrphanedResearchJobs(): Promise<number> {
	const result = await ResearchJobModel.updateMany(
		{ status: { $in: ACTIVE_STATUSES } },
		{
			status: "failed",
			error: "Server restarted while research was generating.",
		},
	);
	runners.clear();
	return result.modifiedCount;
}

export async function getActiveResearchJob(userId: string): Promise<ResearchJobDto | null> {
	const doc = await ResearchJobModel.findOne({
		userId: new Types.ObjectId(userId),
		status: { $in: ACTIVE_STATUSES },
	})
		.sort({ updatedAt: -1 })
		.lean();
	return doc ? toDto(doc) : null;
}

export async function getResearchJobById(
	jobId: string,
	userId: string,
): Promise<ResearchJobDto | null> {
	if (!Types.ObjectId.isValid(jobId)) return null;
	const doc = await ResearchJobModel.findOne({
		_id: jobId,
		userId: new Types.ObjectId(userId),
	}).lean();
	return doc ? toDto(doc) : null;
}

async function runPaperJob(input: {
	ctx: AppContext;
	jobId: string;
	userId: string;
	topic: string;
	prompt: string;
}): Promise<void> {
	const chat = new ChatService(input.ctx);
	runners.set(input.jobId, chat);

	try {
		await ResearchJobModel.findByIdAndUpdate(input.jobId, { status: "running", error: null });

		await chat.resetSession({
			workflow: "chat-paper",
			topic: input.topic,
			userId: input.userId,
		});

		const sessionId = chat.getStatus().sessionId;
		if (sessionId) {
			await ResearchJobModel.findByIdAndUpdate(input.jobId, {
				sessionId: new Types.ObjectId(sessionId),
			});
		}

		await chat.sendMessage(input.prompt, input.userId);

		const current = await ResearchJobModel.findById(input.jobId).lean();
		if (!current || current.status === "cancelled") return;

		const savedResearchId = chat.getLastSavedResearchId();
		if (savedResearchId) {
			await ResearchJobModel.findByIdAndUpdate(input.jobId, {
				status: "completed",
				savedResearchId: new Types.ObjectId(savedResearchId),
				error: null,
			});
			return;
		}

		await ResearchJobModel.findByIdAndUpdate(input.jobId, {
			status: "failed",
			error: "Research finished but the paper was too short to save.",
		});
	} catch (error) {
		const current = await ResearchJobModel.findById(input.jobId).lean();
		if (current?.status === "cancelled") return;

		const message = error instanceof Error ? error.message : String(error);
		const isAbort = error instanceof Error && error.name === "AbortError";
		await ResearchJobModel.findByIdAndUpdate(input.jobId, {
			status: isAbort ? "cancelled" : "failed",
			error: isAbort ? "Research generation was cancelled." : message,
		});
	} finally {
		runners.delete(input.jobId);
	}
}

export async function startResearchPaperJob(input: {
	ctx: AppContext;
	userId: string;
	prompt: string;
	topic?: string;
}): Promise<ResearchJobDto> {
	const prompt = input.prompt.trim();
	if (!prompt) throw new Error("Prompt is required.");

	const active = await getActiveResearchJob(input.userId);
	if (active) {
		throw new Error("A research paper is already generating. Wait for it to finish or cancel it.");
	}

	const topic = (input.topic?.trim() || prompt.slice(0, 200)).trim();
	const created = await ResearchJobModel.create({
		userId: new Types.ObjectId(input.userId),
		topic,
		status: "queued",
	});

	const jobId = created._id.toString();

	// Fire-and-forget — HTTP returns immediately; generation continues after disconnect.
	void runPaperJob({
		ctx: input.ctx,
		jobId,
		userId: input.userId,
		topic,
		prompt,
	});

	return toDto(created);
}

export async function cancelResearchJob(
	jobId: string,
	userId: string,
): Promise<ResearchJobDto | null> {
	if (!Types.ObjectId.isValid(jobId)) return null;

	const doc = await ResearchJobModel.findOne({
		_id: jobId,
		userId: new Types.ObjectId(userId),
	});
	if (!doc) return null;

	if (!ACTIVE_STATUSES.includes(doc.status as ResearchJobStatus)) {
		return toDto(doc);
	}

	const runner = runners.get(jobId);
	if (runner) {
		await runner.abort();
		runners.delete(jobId);
	}

	doc.status = "cancelled";
	doc.error = "Research generation was cancelled.";
	await doc.save();
	return toDto(doc);
}
