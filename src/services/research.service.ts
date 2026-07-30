import { Types } from "mongoose";

import { OutputArtifactModel } from "../db/models/OutputArtifact.js";
import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { listOutputs, readOutputFile, type OutputEntry } from "../server/outputs.js";
import { extractPaperTitle, titleQuality } from "../lib/research-paper-title.js";
import type { TokenUsage } from "../types/token-usage.js";

const MAX_CONTENT_BYTES = 500_000;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".csv", ".log"]);

export type SavedResearchDto = {
	id: string;
	userId: string | null;
	sessionId: string | null;
	workflow: string;
	topic: string;
	title: string;
	content: string;
	aiBaselineContent: string | null;
	humanEdited: boolean;
	sources: {
		documentIds: string[];
		datasetIds: string[];
		noteIds: string[];
		projectIds: string[];
	};
	tokenUsage?: TokenUsage;
	createdAt: string;
	updatedAt: string;
};

function normalizeSources(raw?: {
	documentIds?: string[] | null;
	datasetIds?: string[] | null;
	noteIds?: string[] | null;
	projectIds?: string[] | null;
} | null) {
	return {
		documentIds: Array.isArray(raw?.documentIds) ? raw.documentIds.map(String) : [],
		datasetIds: Array.isArray(raw?.datasetIds) ? raw.datasetIds.map(String) : [],
		noteIds: Array.isArray(raw?.noteIds) ? raw.noteIds.map(String) : [],
		projectIds: Array.isArray(raw?.projectIds) ? raw.projectIds.map(String) : [],
	};
}

function toSavedResearchDto(doc: {
	_id: Types.ObjectId;
	userId?: Types.ObjectId | null;
	sessionId?: Types.ObjectId | null;
	workflow?: string | null;
	topic: string;
	title: string;
	content: string;
	aiBaselineContent?: string | null;
	humanEdited?: boolean | null;
	sources?: {
		documentIds?: string[] | null;
		datasetIds?: string[] | null;
		noteIds?: string[] | null;
		projectIds?: string[] | null;
	} | null;
	tokenUsage?: TokenUsage | null;
	createdAt: Date;
	updatedAt: Date;
}): SavedResearchDto {
	const title = extractPaperTitle(doc.content, doc.topic);
	return {
		id: doc._id.toString(),
		userId: doc.userId?.toString() ?? null,
		sessionId: doc.sessionId?.toString() ?? null,
		workflow: doc.workflow ?? "chat-paper",
		topic: doc.topic,
		title,
		content: doc.content,
		aiBaselineContent: doc.aiBaselineContent ?? null,
		humanEdited: Boolean(doc.humanEdited),
		sources: normalizeSources(doc.sources),
		...(doc.tokenUsage ? { tokenUsage: doc.tokenUsage } : {}),
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function saveResearchPaper(input: {
	userId?: string | null;
	sessionId?: string | null;
	workflow?: string;
	topic: string;
	content: string;
	tokenUsage?: TokenUsage;
	sources?: {
		documentIds?: string[];
		datasetIds?: string[];
		noteIds?: string[];
		projectIds?: string[];
	} | null;
}): Promise<SavedResearchDto> {
	const topic = input.topic.trim();
	const content = input.content.trim();
	if (!topic || !content) {
		throw new Error("Topic and content are required.");
	}

	const title = extractPaperTitle(content, topic);
	const workflow = input.workflow?.trim() || "chat-paper";
	const sources = normalizeSources(input.sources);
	if (!input.userId) {
		throw new Error("Authentication required to save research.");
	}
	const filter: Record<string, unknown> = {
		topic,
		workflow,
		userId: new Types.ObjectId(input.userId),
	};

	const existing = await SavedResearchModel.findOne(filter).sort({ updatedAt: -1 });
	if (existing) {
		existing.content = content;
		existing.title = title;
		// Fresh AI generation — reset baseline for effort scoring.
		existing.aiBaselineContent = content;
		existing.humanEdited = false;
		existing.sources = sources;
		if (input.sessionId) existing.sessionId = new Types.ObjectId(input.sessionId);
		if (input.tokenUsage) existing.tokenUsage = input.tokenUsage;
		await existing.save();
		return toSavedResearchDto(existing);
	}

	const created = await SavedResearchModel.create({
		userId: new Types.ObjectId(input.userId),
		sessionId: input.sessionId ?? undefined,
		workflow,
		topic,
		title,
		content,
		aiBaselineContent: content,
		humanEdited: false,
		sources,
		...(input.tokenUsage ? { tokenUsage: input.tokenUsage } : {}),
	});
	return toSavedResearchDto(created);
}

function dedupeSavedResearch(rows: SavedResearchDto[]): SavedResearchDto[] {
	const byTopic = new Map<string, SavedResearchDto>();

	for (const row of rows) {
		const key = row.topic.trim().toLowerCase();
		if (!key) continue;

		const existing = byTopic.get(key);
		if (!existing) {
			byTopic.set(key, row);
			continue;
		}

		const keepNew =
			titleQuality(row.title) > titleQuality(existing.title) ||
			row.updatedAt > existing.updatedAt;

		byTopic.set(key, keepNew ? row : existing);
	}

	return [...byTopic.values()].sort(
		(a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
	);
}

export async function listSavedResearch(userId?: string | null, limit = 50): Promise<SavedResearchDto[]> {
	if (!userId) return [];

	const rows = await SavedResearchModel.find({ userId: new Types.ObjectId(userId) })
		.sort({ updatedAt: -1 })
		.limit(limit * 2)
		.lean();
	const mapped = rows.map((row) =>
		toSavedResearchDto({
			...row,
			_id: row._id,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}),
	);
	return dedupeSavedResearch(mapped).slice(0, limit);
}

function canAccessSavedResearch(
	doc: { userId?: Types.ObjectId | null },
	userId?: string | null,
): boolean {
	if (!userId) return false;
	const ownerId = doc.userId?.toString() ?? null;
	// Ownerless legacy rows are not shared — only the matching owner may access.
	return Boolean(ownerId && ownerId === userId);
}

export async function getSavedResearchById(
	id: string,
	userId?: string | null,
): Promise<SavedResearchDto | null> {
	if (!Types.ObjectId.isValid(id)) return null;

	const doc = await SavedResearchModel.findById(id);
	if (!doc || !canAccessSavedResearch(doc, userId)) return null;

	return toSavedResearchDto(doc);
}

export async function updateSavedResearchById(
	id: string,
	input: { topic?: string; content?: string },
	userId?: string | null,
): Promise<SavedResearchDto | null> {
	if (!Types.ObjectId.isValid(id)) return null;

	const doc = await SavedResearchModel.findById(id);
	if (!doc || !canAccessSavedResearch(doc, userId)) return null;

	const topic = input.topic?.trim() ?? doc.topic;
	const content = input.content?.trim() ?? doc.content;
	if (!topic || !content) {
		throw new Error("Topic and content are required.");
	}

	const previousContent = doc.content;
	doc.topic = topic;
	doc.content = content;
	doc.title = extractPaperTitle(content, topic);
	// Lock AI baseline once (legacy papers use pre-edit content).
	if (!doc.aiBaselineContent) {
		doc.aiBaselineContent = previousContent || content;
	}
	doc.humanEdited = content.trim() !== String(doc.aiBaselineContent).trim();
	await doc.save();

	return toSavedResearchDto(doc);
}

export async function deleteSavedResearch(id: string, userId?: string | null): Promise<boolean> {
	if (!userId || !Types.ObjectId.isValid(id)) return false;

	const doc = await SavedResearchModel.findById(id);
	if (!doc || !canAccessSavedResearch(doc, userId)) return false;

	const result = await SavedResearchModel.findByIdAndDelete(id);
	return Boolean(result);
}

export async function deleteAllSavedResearch(userId?: string | null): Promise<number> {
	if (!userId) return 0;
	const result = await SavedResearchModel.deleteMany({ userId: new Types.ObjectId(userId) });
	return result.deletedCount;
}

function shouldStoreContent(path: string, size?: number): boolean {
	if (!size || size > MAX_CONTENT_BYTES) return false;
	const lower = path.toLowerCase();
	for (const ext of TEXT_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	return false;
}

async function readArtifactContent(workingDir: string, path: string): Promise<string | undefined> {
	try {
		const { content } = readOutputFile(workingDir, path);
		return content;
	} catch {
		return undefined;
	}
}

export async function syncOutputArtifacts(workingDir: string): Promise<number> {
	const entries = listOutputs(workingDir);
	let synced = 0;

	for (const entry of entries) {
		const modified = entry.modified ? new Date(entry.modified) : new Date();
		let content: string | undefined;

		if (entry.kind === "file" && shouldStoreContent(entry.path, entry.size)) {
			content = await readArtifactContent(workingDir, entry.path);
		}

		await OutputArtifactModel.findOneAndUpdate(
			{ path: entry.path },
			{
				path: entry.path,
				name: entry.name,
				kind: entry.kind,
				size: entry.size,
				modified,
				...(content !== undefined ? { content } : {}),
			},
			{ upsert: true, new: true },
		);
		synced += 1;
	}

	return synced;
}

export async function listOutputArtifacts(): Promise<
	Array<OutputEntry & { id: string; hasContent: boolean }>
> {
	const rows = await OutputArtifactModel.find().sort({ modified: -1 }).limit(200).lean();
	return rows.map((row) => ({
		id: row._id.toString(),
		path: row.path,
		name: row.name,
		kind: row.kind as "file" | "directory",
		size: row.size ?? undefined,
		modified: row.modified?.toISOString() ?? row.updatedAt.toISOString(),
		hasContent: Boolean(row.content),
	}));
}

export async function getOutputArtifactContent(path: string): Promise<string | null> {
	const row = await OutputArtifactModel.findOne({ path }).lean();
	return row?.content ?? null;
}

export async function getOutputArtifactContentOrRead(
	workingDir: string,
	path: string,
): Promise<{ content: string; path: string; source: "database" | "disk" }> {
	const fromDb = await getOutputArtifactContent(path);
	if (fromDb !== null) {
		return { content: fromDb, path, source: "database" };
	}

	const fromDisk = readOutputFile(workingDir, path);
	await OutputArtifactModel.findOneAndUpdate(
		{ path },
		{
			path,
			name: path.split("/").pop() ?? path,
			kind: "file",
			content: fromDisk.content,
			modified: new Date(),
		},
		{ upsert: true },
	);
	return { ...fromDisk, source: "disk" };
}
