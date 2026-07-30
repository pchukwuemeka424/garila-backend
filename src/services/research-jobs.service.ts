import { Types } from "mongoose";

import { ResearchJobModel } from "../db/models/ResearchJob.js";
import type { AppContext } from "../lib/app-context.js";
import { ChatService } from "./chat.service.js";
import { friendlyLlmError } from "./llm.service.js";

export type ResearchJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ResearchJobDto = {
	id: string;
	userId: string;
	sessionId: string | null;
	topic: string;
	status: ResearchJobStatus;
	progress: number;
	savedResearchId: string | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
};

const ACTIVE_STATUSES: ResearchJobStatus[] = ["queued", "running"];

/** Cap auto-restarts so a crash-causing job cannot restart-loop the server. */
const MAX_JOB_RESTARTS = 2;

/** Rough target length for a full paper stream → maps into mid-range progress. */
const STREAM_TARGET_CHARS = 14_000;

/** In-process runners keyed by job id — used for cancel; not durable across restarts. */
const runners = new Map<string, ChatService>();

function clampProgress(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function toDto(doc: {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	sessionId?: Types.ObjectId | null;
	topic: string;
	status: string;
	progress?: number | null;
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
		progress: clampProgress(doc.progress ?? 0),
		savedResearchId: doc.savedResearchId?.toString() ?? null,
		error: doc.error ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

async function setJobProgress(jobId: string, progress: number, floor = true): Promise<void> {
	const next = clampProgress(progress);
	if (floor) {
		await ResearchJobModel.updateOne(
			{ _id: jobId, progress: { $lt: next } },
			{ $set: { progress: next } },
		);
		return;
	}
	await ResearchJobModel.findByIdAndUpdate(jobId, { progress: next });
}

/**
 * On server startup: requeue interrupted jobs that still have a stored prompt
 * (up to MAX_JOB_RESTARTS). Jobs without a prompt or over the cap are failed.
 */
export async function requeueOrphanedResearchJobs(ctx: AppContext): Promise<{
	requeued: number;
	failed: number;
}> {
	runners.clear();

	const orphans = await ResearchJobModel.find({
		status: { $in: ACTIVE_STATUSES },
	}).lean();

	let requeued = 0;
	let failed = 0;

	for (const job of orphans) {
		const jobId = job._id.toString();
		const prompt = typeof job.prompt === "string" ? job.prompt.trim() : "";
		const restartCount = typeof job.restartCount === "number" ? job.restartCount : 0;

		if (!prompt || restartCount >= MAX_JOB_RESTARTS) {
			await ResearchJobModel.findByIdAndUpdate(jobId, {
				status: "failed",
				error: prompt
					? "Research generation failed after repeated server restarts."
					: "Server restarted while research was generating.",
			});
			failed += 1;
			continue;
		}

		await ResearchJobModel.findByIdAndUpdate(jobId, {
			status: "queued",
			progress: 0,
			error: null,
			restartCount: restartCount + 1,
		});

		requeued += 1;
		void runPaperJob({
			ctx,
			jobId,
			userId: job.userId.toString(),
			topic: job.topic,
			prompt,
		});
	}

	return { requeued, failed };
}

/** @deprecated Prefer requeueOrphanedResearchJobs — kept for callers that only need fail semantics. */
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

function attachJobProgressListener(chat: ChatService, jobId: string): () => void {
	let streamedChars = 0;
	let lastWrittenStreamProgress = 28;
	let lastWriteAt = 0;

	return chat.subscribe((payload) => {
		if (payload.type !== "agent_event") return;
		const event = payload.event as Record<string, unknown> | undefined;
		if (!event || typeof event.type !== "string") return;

		if (event.type === "tool_execution_start" && event.toolName === "alphaxiv_search") {
			void setJobProgress(jobId, 12);
			return;
		}
		if (event.type === "tool_execution_end" && event.toolName === "alphaxiv_search") {
			void setJobProgress(jobId, 22);
			return;
		}
		if (event.type === "agent_start") {
			void setJobProgress(jobId, 28);
			return;
		}
		if (
			event.type === "message_update" &&
			(event.assistantMessageEvent as { type?: string; delta?: string } | undefined)?.type ===
				"text_delta"
		) {
			const delta =
				(event.assistantMessageEvent as { delta?: string } | undefined)?.delta ?? "";
			streamedChars += delta.length;
			const ratio = Math.min(1, streamedChars / STREAM_TARGET_CHARS);
			const streamProgress = clampProgress(28 + ratio * 57); // 28 → 85
			const now = Date.now();
			if (streamProgress >= lastWrittenStreamProgress + 2 || now - lastWriteAt > 2500) {
				lastWrittenStreamProgress = streamProgress;
				lastWriteAt = now;
				void setJobProgress(jobId, Math.min(85, streamProgress));
			}
			return;
		}
		if (event.type === "tool_execution_start" && event.toolName === "citation_fix") {
			void setJobProgress(jobId, 88);
			return;
		}
		if (event.type === "tool_execution_start" && event.toolName === "references_fix") {
			void setJobProgress(jobId, 90);
			return;
		}
		if (event.type === "tool_execution_start" && event.toolName === "grounding_fix") {
			void setJobProgress(jobId, 92);
			return;
		}
		if (
			event.type === "tool_execution_end" &&
			(event.toolName === "citation_fix" ||
				event.toolName === "references_fix" ||
				event.toolName === "grounding_fix")
		) {
			void setJobProgress(jobId, 94);
			return;
		}
		if (event.type === "message_end" || event.type === "agent_end") {
			void setJobProgress(jobId, 97);
		}
	});
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
	const unsubscribe = attachJobProgressListener(chat, input.jobId);

	try {
		await ResearchJobModel.findByIdAndUpdate(input.jobId, {
			status: "running",
			error: null,
			progress: 5,
		});

		await chat.resetSession({
			workflow: "chat-paper",
			topic: input.topic,
			userId: input.userId,
		});
		await setJobProgress(input.jobId, 10);

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
				progress: 100,
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

		const isAbort = error instanceof Error && error.name === "AbortError";
		const safeMessage = isAbort
			? "Research generation was cancelled."
			: friendlyLlmError(error).message;
		await ResearchJobModel.findByIdAndUpdate(input.jobId, {
			status: isAbort ? "cancelled" : "failed",
			error: safeMessage,
		});
	} finally {
		unsubscribe();
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
		prompt,
		restartCount: 0,
		status: "queued",
		progress: 0,
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
