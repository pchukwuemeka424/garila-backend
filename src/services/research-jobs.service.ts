import { Types } from "mongoose";

import { ResearchJobModel } from "../db/models/ResearchJob.js";
import type { AppContext } from "../lib/app-context.js";
import { ChatService } from "./chat.service.js";
import { attachSavedResearchSources, injectSavedFiguresIntoSavedPaper } from "./research.service.js";
import { buildResearchSourceContext } from "./research-source-context.service.js";

export type ResearchJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ResearchJobDto = {
	id: string;
	userId: string;
	sessionId: string | null;
	topic: string;
	status: ResearchJobStatus;
	/** 0–100 generation progress. */
	progress: number;
	/** Live partial paper text while streaming (may be empty during prepare). */
	draftContent: string;
	savedResearchId: string | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
};

const ACTIVE_STATUSES: ResearchJobStatus[] = ["queued", "running"];

/** In-process runners keyed by job id — used for cancel; not durable across restarts. */
const runners = new Map<string, ChatService>();

function clampProgress(n: number): number {
	return Math.max(0, Math.min(100, Math.round(n)));
}

function toDto(doc: {
	_id: Types.ObjectId;
	userId: Types.ObjectId;
	sessionId?: Types.ObjectId | null;
	topic: string;
	status: string;
	progress?: number | null;
	draftContent?: string | null;
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
		draftContent: typeof doc.draftContent === "string" ? doc.draftContent : "",
		savedResearchId: doc.savedResearchId?.toString() ?? null,
		error: doc.error ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

async function setJobProgress(jobId: string, progress: number): Promise<void> {
	await ResearchJobModel.findByIdAndUpdate(jobId, {
		progress: clampProgress(progress),
	});
}

async function setJobDraft(jobId: string, draftContent: string, progress?: number): Promise<void> {
	const update: { draftContent: string; progress?: number } = {
		draftContent: draftContent.slice(0, 500_000),
	};
	if (typeof progress === "number") update.progress = clampProgress(progress);
	await ResearchJobModel.findByIdAndUpdate(jobId, update);
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

function promptHasNotebookLibrary(prompt: string): boolean {
	return /Selected research library|RESEARCH NOTEBOOK LIBRARY|NOTEBOOK PAGE:/i.test(prompt);
}

/** Rebuild notebook folder text when the client prompt omitted it but sources were selected. */
async function ensureNotebookContextInPrompt(
	prompt: string,
	userId: string,
	sources?: {
		documentIds?: string[];
		datasetIds?: string[];
		questionnaireIds?: string[];
		noteIds?: string[];
		projectIds?: string[];
	} | null,
): Promise<string> {
	const hasProjects = Boolean(sources?.projectIds?.length);
	const hasOther =
		Boolean(sources?.documentIds?.length) ||
		Boolean(sources?.datasetIds?.length) ||
		Boolean(sources?.questionnaireIds?.length);
	if ((!hasProjects && !hasOther) || promptHasNotebookLibrary(prompt)) {
		return prompt;
	}
	try {
		const context = (await buildResearchSourceContext(userId, sources ?? undefined)).trim();
		if (!context) return prompt;
		// Keep rebuild append modest — client prompts already carry outline/instructions.
		const clipped = context.length > 28_000 ? `${context.slice(0, 28_000).trimEnd()}\n[Truncated]` : context;
		return [
			prompt.trimEnd(),
			"",
			"NOTEBOOK-FIRST (hard): The user selected a research notebook library and/or uploaded evidence. Use the FULL folder contents below as primary source material for this deliverable.",
			"Align title, methods, findings/results, and contributions with this material. Do not invent a different study.",
			"",
			"**Selected research library**",
			"",
			clipped,
		].join("\n");
	} catch {
		return prompt;
	}
}

async function runPaperJob(input: {
	ctx: AppContext;
	jobId: string;
	userId: string;
	topic: string;
	prompt: string;
	figureDocumentIds: string[];
	visualizationMarkdown?: string;
	sources?: {
		documentIds?: string[];
		datasetIds?: string[];
		questionnaireIds?: string[];
		noteIds?: string[];
		projectIds?: string[];
	} | null;
}): Promise<void> {
	const chat = new ChatService(input.ctx);
	runners.set(input.jobId, chat);

	let progress = 20;
	let lastPersisted = 20;
	let streamTicks = 0;
	let draft = "";
	let lastDraftPersist = 0;
	let draftDirty = false;

	const bump = (next: number) => {
		const clamped = clampProgress(Math.max(progress, next));
		if (clamped <= progress && clamped !== 100) return;
		progress = clamped;
		// Throttle DB writes during fast stream deltas.
		if (clamped - lastPersisted < 2 && clamped < 95 && clamped !== 100) return;
		lastPersisted = clamped;
		void setJobProgress(input.jobId, clamped);
	};

	const flushDraft = (force = false) => {
		if (!draftDirty && !force) return;
		const now = Date.now();
		if (!force && now - lastDraftPersist < 400) return;
		lastDraftPersist = now;
		draftDirty = false;
		void setJobDraft(input.jobId, draft, progress);
	};

	const unsubscribe = chat.subscribe((payload) => {
		if (payload.type !== "agent_event") return;
		const event = payload.event as {
			type?: string;
			toolName?: string;
			assistantMessageEvent?: { type?: string; delta?: string };
			message?: { content?: string };
		} | undefined;
		if (!event?.type) return;

		if (event.type === "tool_execution_start" && event.toolName === "alphaxiv_search") {
			bump(28);
			return;
		}
		if (event.type === "tool_execution_end" && event.toolName === "alphaxiv_search") {
			bump(40);
			return;
		}
		if (event.type === "agent_start") {
			bump(45);
			return;
		}
		if (event.type === "message_update") {
			streamTicks += 1;
			const delta = event.assistantMessageEvent?.delta;
			if (typeof delta === "string" && delta) {
				draft += delta;
				draftDirty = true;
				flushDraft();
			}
			// Climb from ~45 toward 92 as the paper streams.
			bump(Math.min(92, 45 + streamTicks * 0.35));
			return;
		}
		if (event.type === "message_end") {
			const finalText = event.message?.content;
			if (typeof finalText === "string" && finalText.trim()) {
				draft = finalText;
				draftDirty = true;
				flushDraft(true);
			}
			bump(94);
		}
	});

	const creepTimer = setInterval(() => {
		if (progress >= 90) return;
		bump(progress + 1);
	}, 2500);

	const draftFlushTimer = setInterval(() => flushDraft(), 450);

	try {
		await ResearchJobModel.findByIdAndUpdate(input.jobId, {
			status: "running",
			progress: 20,
			draftContent: "",
			error: null,
		});

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

		bump(25);
		const prompt = await ensureNotebookContextInPrompt(
			input.prompt,
			input.userId,
			input.sources,
		);
		await chat.sendMessage(prompt, input.userId);

		const current = await ResearchJobModel.findById(input.jobId).lean();
		if (!current || current.status === "cancelled") return;

		const savedResearchId = chat.getLastSavedResearchId();
		if (savedResearchId) {
			const viz = (input.visualizationMarkdown ?? "").trim();
			if (input.figureDocumentIds.length || viz) {
				try {
					await injectSavedFiguresIntoSavedPaper(
						savedResearchId,
						input.userId,
						input.figureDocumentIds,
						viz,
					);
				} catch {
					/* Paper is still usable without attached notebook visuals. */
				}
			}
			try {
				await attachSavedResearchSources(savedResearchId, input.userId, input.sources);
			} catch {
				/* Paper is still usable without source ids. */
			}
			await ResearchJobModel.findByIdAndUpdate(input.jobId, {
				status: "completed",
				progress: 100,
				savedResearchId: new Types.ObjectId(savedResearchId),
				error: null,
				...(draft.trim() ? { draftContent: draft.slice(0, 500_000) } : {}),
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
		clearInterval(creepTimer);
		clearInterval(draftFlushTimer);
		flushDraft(true);
		unsubscribe();
		runners.delete(input.jobId);
	}
}

export async function startResearchPaperJob(input: {
	ctx: AppContext;
	userId: string;
	prompt: string;
	topic?: string;
	figureDocumentIds?: string[];
	visualizationMarkdown?: string;
	sources?: {
		documentIds?: string[];
		datasetIds?: string[];
		questionnaireIds?: string[];
		noteIds?: string[];
		projectIds?: string[];
	} | null;
}): Promise<ResearchJobDto> {
	const prompt = input.prompt.trim();
	if (!prompt) throw new Error("Prompt is required.");

	const active = await getActiveResearchJob(input.userId);
	if (active) {
		throw new Error("A research paper is already generating. Wait for it to finish or cancel it.");
	}

	const figureDocumentIds = (input.figureDocumentIds ?? [])
		.filter((id, index, all) => Types.ObjectId.isValid(id) && all.indexOf(id) === index)
		.slice(0, 8);
	const visualizationMarkdown = (input.visualizationMarkdown ?? "").trim().slice(0, 40_000);

	const topic = (input.topic?.trim() || prompt.slice(0, 200)).trim();
	const created = await ResearchJobModel.create({
		userId: new Types.ObjectId(input.userId),
		topic,
		status: "queued",
		progress: 20,
		figureDocumentIds,
		...(visualizationMarkdown ? { visualizationMarkdown } : {}),
		...(input.sources ? { sources: input.sources } : {}),
	});

	const jobId = created._id.toString();

	// Fire-and-forget — HTTP returns immediately; generation continues after disconnect.
	void runPaperJob({
		ctx: input.ctx,
		jobId,
		userId: input.userId,
		topic,
		prompt,
		figureDocumentIds,
		visualizationMarkdown,
		sources: input.sources,
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
