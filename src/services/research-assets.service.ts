import { Types } from "mongoose";

import { ResearchDatasetModel } from "../db/models/ResearchDataset.js";
import { ResearchDocumentModel } from "../db/models/ResearchDocument.js";
import { ResearchNoteModel } from "../db/models/ResearchNote.js";
import { ResearchProjectModel } from "../db/models/ResearchProject.js";
import { ResearchReferenceModel } from "../db/models/ResearchReference.js";
import {
	buildEmptySections,
	isResearchProjectType,
	mergeSectionsWithTemplate,
	type ResearchProjectType,
} from "../lib/research-project-types.js";
import {
	assertObjectUploaded,
	createDirectUploadTarget,
	deleteStoredAttachment,
	formatByteLabel,
	hasStoredAttachment,
	loadAttachmentDataUrl,
	maxDirectUploadBytes,
	storeAttachment,
} from "./attachment-storage.service.js";
import { getPresignedGetUrl, s3Enabled } from "./s3.service.js";
import { isS3Enabled } from "../config/env.js";

export type ResearchDatasetDto = {
	id: string;
	title: string;
	description: string;
	discipline: string;
	format: string;
	year: string;
	license: string;
	accessUrl: string;
	sizeLabel: string;
	tags: string[];
	visibility: "private" | "shared";
	hasFile: boolean;
	fileName: string;
	createdAt: string;
	updatedAt: string;
};

export type AttachmentPayload = {
	name: string;
	mime: string;
	data?: string;
	downloadUrl?: string;
	sizeBytes?: number;
};

function requireUserId(userId?: string | null): string {
	if (!userId) throw new Error("Sign in to manage research assets.");
	return userId;
}

function parseObjectId(id?: string | null): Types.ObjectId | null {
	if (!id || !Types.ObjectId.isValid(id)) return null;
	return new Types.ObjectId(id);
}

function userFilter(userId: string, projectId?: string | null): Record<string, unknown> {
	const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
	const pid = parseObjectId(projectId);
	if (pid) filter.projectId = pid;
	return filter;
}

function toDatasetDto(doc: {
	_id: Types.ObjectId;
	title: string;
	description: string;
	discipline?: string | null;
	format?: string | null;
	year?: string | null;
	license?: string | null;
	accessUrl?: string | null;
	sizeLabel?: string | null;
	tags?: string[] | null;
	visibility?: "private" | "shared" | null;
	fileName?: string | null;
	fileData?: string | null;
	storageKey?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchDatasetDto {
	return {
		id: doc._id.toString(),
		title: doc.title,
		description: doc.description,
		discipline: doc.discipline ?? "",
		format: doc.format ?? "other",
		year: doc.year ?? "",
		license: doc.license ?? "",
		accessUrl: doc.accessUrl ?? "",
		sizeLabel: doc.sizeLabel ?? "",
		tags: doc.tags ?? [],
		visibility: doc.visibility === "shared" ? "shared" : "private",
		hasFile: hasStoredAttachment(doc),
		fileName: doc.fileName ?? "",
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export type ProjectStatus = "draft" | "in_progress" | "completed";

export type ResearchProjectSectionDto = {
	id: string;
	title: string;
	content: string;
};

export type ResearchProjectDto = {
	id: string;
	title: string;
	description: string;
	projectType: ResearchProjectType;
	sections: ResearchProjectSectionDto[];
	status: ProjectStatus;
	favorite: boolean;
	progress: number;
	startedAt: string;
	createdAt: string;
	updatedAt: string;
	counts: {
		documents: number;
		datasets: number;
		notes: number;
		references: number;
	};
};

export type ResearchDocumentDto = {
	id: string;
	title: string;
	fileName: string;
	fileMime: string;
	sizeLabel: string;
	kind: "doc" | "pdf" | "sheet" | "other";
	hasFile: boolean;
	createdAt: string;
	updatedAt: string;
};

export type ResearchNoteDto = {
	id: string;
	title: string;
	content: string;
	createdAt: string;
	updatedAt: string;
};

export type ResearchReferenceDto = {
	id: string;
	title: string;
	citation: string;
	sourceUrl: string;
	createdAt: string;
	updatedAt: string;
};

export type ResearchActivityDto = {
	id: string;
	kind: "dataset" | "document" | "note" | "reference" | "project";
	label: string;
	at: string;
};

function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function inferDocKind(fileName: string, mime: string): "doc" | "pdf" | "sheet" | "other" {
	const lower = `${fileName} ${mime}`.toLowerCase();
	if (lower.includes("pdf")) return "pdf";
	if (lower.includes("sheet") || lower.includes("excel") || /\.(xlsx?|csv|tsv)$/.test(fileName.toLowerCase()))
		return "sheet";
	if (lower.includes("word") || /\.(docx?|rtf|odt)$/.test(fileName.toLowerCase())) return "doc";
	return "other";
}

function toProjectDto(
	doc: {
		_id: Types.ObjectId;
		title: string;
		description?: string | null;
		projectType?: string | null;
		sections?: Array<{ id?: string | null; title?: string | null; content?: string | null }> | null;
		status?: ProjectStatus | null;
		favorite?: boolean | null;
		progress?: number | null;
		startedAt?: Date | null;
		createdAt: Date;
		updatedAt: Date;
	},
	counts: ResearchProjectDto["counts"],
): ResearchProjectDto {
	const status: ProjectStatus =
		doc.status === "draft" || doc.status === "completed" ? doc.status : "in_progress";
	const rawProjectType = doc.projectType ?? "";
	const projectType: ResearchProjectType = isResearchProjectType(rawProjectType)
		? rawProjectType
		: "research";
	const sections: ResearchProjectSectionDto[] = mergeSectionsWithTemplate(projectType, doc.sections);
	return {
		id: doc._id.toString(),
		title: doc.title,
		description: doc.description ?? "",
		projectType,
		sections,
		status,
		favorite: Boolean(doc.favorite),
		progress: Math.max(0, Math.min(100, Math.round(doc.progress ?? 0))),
		startedAt: (doc.startedAt ?? doc.createdAt).toISOString(),
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
		counts,
	};
}

function toDocumentDto(doc: {
	_id: Types.ObjectId;
	title: string;
	fileName: string;
	fileMime?: string | null;
	sizeLabel?: string | null;
	kind?: "doc" | "pdf" | "sheet" | "other" | null;
	fileData?: string | null;
	storageKey?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchDocumentDto {
	return {
		id: doc._id.toString(),
		title: doc.title,
		fileName: doc.fileName,
		fileMime: doc.fileMime ?? "application/octet-stream",
		sizeLabel: doc.sizeLabel ?? "",
		kind: doc.kind ?? "other",
		hasFile: hasStoredAttachment(doc),
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function toNoteDto(doc: {
	_id: Types.ObjectId;
	title: string;
	content?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchNoteDto {
	return {
		id: doc._id.toString(),
		title: doc.title,
		content: doc.content ?? "",
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function toReferenceDto(doc: {
	_id: Types.ObjectId;
	title: string;
	citation: string;
	sourceUrl?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchReferenceDto {
	return {
		id: doc._id.toString(),
		title: doc.title,
		citation: doc.citation,
		sourceUrl: doc.sourceUrl ?? "",
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

async function requireOwnedProject(userId: string, projectId: string) {
	const pid = parseObjectId(projectId);
	if (!pid) throw new Error("Project not found.");
	const doc = await ResearchProjectModel.findOne({
		_id: pid,
		userId: new Types.ObjectId(userId),
	});
	if (!doc) throw new Error("Project not found.");
	return doc;
}

async function countAssets(
	userId: string,
	projectId: string,
): Promise<ResearchProjectDto["counts"]> {
	const filter = {
		userId: new Types.ObjectId(userId),
		projectId: new Types.ObjectId(projectId),
	};
	const [documents, datasets, notes, references] = await Promise.all([
		ResearchDocumentModel.countDocuments(filter),
		ResearchDatasetModel.countDocuments(filter),
		ResearchNoteModel.countDocuments(filter),
		ResearchReferenceModel.countDocuments(filter),
	]);
	return { documents, datasets, notes, references };
}

function computeProgress(
	project: { description?: string | null; status?: string | null },
	counts: ResearchProjectDto["counts"],
): number {
	let score = 0;
	if (project.description?.trim()) score += 20;
	if (counts.documents > 0) score += 25;
	if (counts.datasets > 0) score += 15;
	if (counts.notes > 0) score += 10;
	if (counts.references > 0) score += 10;
	if (project.status === "completed") score = Math.max(score, 100);
	else if (project.status === "in_progress" && score < 25) score = 25;
	return Math.min(100, score);
}

async function touchProject(userId: string, projectId: string): Promise<void> {
	const doc = await requireOwnedProject(userId, projectId);
	const counts = await countAssets(userId, projectId);
	doc.progress = computeProgress(doc, counts);
	await doc.save();
}

async function backfillOrphanAssets(userId: string, projectId: Types.ObjectId): Promise<void> {
	const oid = new Types.ObjectId(userId);
	const orphanFilter = {
		userId: oid,
		$or: [{ projectId: { $exists: false } }, { projectId: null }],
	};
	const update = { $set: { projectId } };
	await Promise.all([
		ResearchDatasetModel.updateMany(orphanFilter, update),
		ResearchDocumentModel.updateMany(orphanFilter, update),
		ResearchNoteModel.updateMany(orphanFilter, update),
		ResearchReferenceModel.updateMany(orphanFilter, update),
	]);
}

async function resolveProjectObjectId(
	userId: string,
	projectId?: string | null,
): Promise<Types.ObjectId> {
	if (projectId?.trim()) {
		const doc = await requireOwnedProject(userId, projectId.trim());
		return doc._id;
	}
	const project = await getOrCreateProject(userId);
	return new Types.ObjectId(project.id);
}

function projectIdString(
	value: Types.ObjectId | string | null | undefined,
): string | null {
	if (!value) return null;
	return typeof value === "string" ? value : value.toString();
}

export async function listProjects(userId?: string | null): Promise<ResearchProjectDto[]> {
	const uid = requireUserId(userId);
	const rows = await ResearchProjectModel.find({ userId: new Types.ObjectId(uid) }).sort({
		updatedAt: -1,
	});
	return Promise.all(
		rows.map(async (doc) => {
			const counts = await countAssets(uid, doc._id.toString());
			return toProjectDto(doc, counts);
		}),
	);
}

export async function createProject(
	userId: string | null | undefined,
	input: { title?: string; description?: string; projectType?: string },
): Promise<ResearchProjectDto> {
	const uid = requireUserId(userId);
	const title = input.title?.trim() ?? "";
	if (!title) throw new Error("Title is required.");
	const rawProjectType = input.projectType ?? "";
	const projectType: ResearchProjectType = isResearchProjectType(rawProjectType)
		? rawProjectType
		: "research";
	const doc = await ResearchProjectModel.create({
		userId: new Types.ObjectId(uid),
		title,
		description: input.description?.trim() ?? "",
		projectType,
		sections: buildEmptySections(projectType),
		status: "in_progress",
		favorite: false,
		progress: 0,
		startedAt: new Date(),
	});
	const counts = await countAssets(uid, doc._id.toString());
	return toProjectDto(doc, counts);
}

export async function getProject(
	userId: string | null | undefined,
	projectId: string,
): Promise<ResearchProjectDto> {
	const uid = requireUserId(userId);
	const doc = await requireOwnedProject(uid, projectId);
	const rawProjectType = doc.projectType ?? "";
	const projectType: ResearchProjectType = isResearchProjectType(rawProjectType)
		? rawProjectType
		: "research";
	if (!doc.projectType || !isResearchProjectType(doc.projectType)) {
		doc.projectType = projectType;
	}
	const merged = mergeSectionsWithTemplate(projectType, doc.sections);
	const existingIds = (Array.isArray(doc.sections) ? doc.sections : [])
		.map((section) => section?.id)
		.filter(Boolean)
		.join("|");
	const mergedIds = merged.map((section) => section.id).join("|");
	if (existingIds !== mergedIds || !Array.isArray(doc.sections) || doc.sections.length === 0) {
		doc.set("sections", merged);
		doc.markModified("sections");
	}
	const counts = await countAssets(uid, doc._id.toString());
	const progress = computeProgress(doc, counts);
	if (doc.progress !== progress) {
		doc.progress = progress;
	}
	if (doc.isModified()) await doc.save();
	return toProjectDto(doc, counts);
}

export async function getOrCreateProject(userId?: string | null): Promise<ResearchProjectDto> {
	const uid = requireUserId(userId);
	const oid = new Types.ObjectId(uid);
	let doc = await ResearchProjectModel.findOne({ userId: oid }).sort({ updatedAt: -1 });
	if (!doc) {
		doc = await ResearchProjectModel.create({
			userId: oid,
			title: "Untitled research",
			description: "",
			projectType: "research",
			sections: buildEmptySections("research"),
			status: "in_progress",
			favorite: false,
			progress: 0,
			startedAt: new Date(),
		});
	}
	await backfillOrphanAssets(uid, doc._id);
	const counts = await countAssets(uid, doc._id.toString());
	const progress = computeProgress(doc, counts);
	if (doc.progress !== progress) {
		doc.progress = progress;
		await doc.save();
	}
	return toProjectDto(doc, counts);
}

export async function updateProject(
	userId: string | null | undefined,
	projectId: string,
	input: {
		title?: string;
		description?: string;
		status?: ProjectStatus;
		favorite?: boolean;
		projectType?: string;
		sections?: Array<{ id: string; title?: string; content?: string }>;
	},
): Promise<ResearchProjectDto> {
	const uid = requireUserId(userId);
	const doc = await requireOwnedProject(uid, projectId);
	if (typeof input.title === "string" && input.title.trim()) doc.title = input.title.trim();
	if (typeof input.description === "string") doc.description = input.description.trim();
	if (input.status === "draft" || input.status === "in_progress" || input.status === "completed") {
		doc.status = input.status;
	}
	if (typeof input.favorite === "boolean") doc.favorite = input.favorite;

	const changingType =
		typeof input.projectType === "string" &&
		isResearchProjectType(input.projectType) &&
		input.projectType !== (doc.projectType ?? "research");

	if (changingType) {
		const nextType = input.projectType as ResearchProjectType;
		doc.projectType = nextType;
		doc.set("sections", mergeSectionsWithTemplate(nextType, doc.sections));
		doc.markModified("sections");
	}

	if (Array.isArray(input.sections)) {
		const byId = new Map(
			(Array.isArray(doc.sections) ? doc.sections : []).map((section) => [section.id, section]),
		);
		for (const patch of input.sections) {
			if (!patch?.id) continue;
			const current = byId.get(patch.id);
			if (!current) continue;
			if (typeof patch.title === "string" && patch.title.trim()) current.title = patch.title.trim();
			if (typeof patch.content === "string") current.content = patch.content;
		}
		doc.markModified("sections");
	} else if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
		const rawType = doc.projectType ?? "";
		const projectType: ResearchProjectType = isResearchProjectType(rawType) ? rawType : "research";
		doc.projectType = projectType;
		doc.set("sections", buildEmptySections(projectType));
	}

	const counts = await countAssets(uid, doc._id.toString());
	doc.progress = computeProgress(doc, counts);
	await doc.save();
	return toProjectDto(doc, counts);
}

export async function deleteProject(
	userId: string | null | undefined,
	projectId: string,
): Promise<boolean> {
	const uid = requireUserId(userId);
	const doc = await requireOwnedProject(uid, projectId);
	const filter = { userId: new Types.ObjectId(uid), projectId: doc._id };
	await Promise.all([
		ResearchDatasetModel.deleteMany(filter),
		ResearchDocumentModel.deleteMany(filter),
		ResearchNoteModel.deleteMany(filter),
		ResearchReferenceModel.deleteMany(filter),
	]);
	const result = await ResearchProjectModel.deleteOne({ _id: doc._id, userId: new Types.ObjectId(uid) });
	return result.deletedCount > 0;
}

const MAX_NOTEBOOK_JSON_CHARS = 4_000_000;

export async function getNotebookData(
	userId: string | null | undefined,
	projectId: string,
): Promise<{ notebookData: unknown | null; updatedAt: string }> {
	const uid = requireUserId(userId);
	const doc = await requireOwnedProject(uid, projectId);
	return {
		notebookData: doc.notebookData ?? null,
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function saveNotebookData(
	userId: string | null | undefined,
	projectId: string,
	notebookData: unknown,
): Promise<{ ok: true; updatedAt: string }> {
	const uid = requireUserId(userId);
	const doc = await requireOwnedProject(uid, projectId);
	const encoded = JSON.stringify(notebookData ?? null);
	if (encoded.length > MAX_NOTEBOOK_JSON_CHARS) {
		throw new Error("Notebook is too large to sync. Remove large datasets or split the project.");
	}
	doc.notebookData = notebookData ?? null;
	doc.markModified("notebookData");
	await doc.save();
	return { ok: true, updatedAt: doc.updatedAt.toISOString() };
}

export async function listDatasets(
	userId?: string | null,
	projectId?: string | null,
	limit = 100,
): Promise<ResearchDatasetDto[]> {
	const uid = requireUserId(userId);
	const rows = await ResearchDatasetModel.find(userFilter(uid, projectId))
		.sort({ updatedAt: -1 })
		.limit(limit);
	return rows.map(toDatasetDto);
}

export async function createDataset(
	userId: string | null | undefined,
	input: {
		projectId?: string;
		title?: string;
		description?: string;
		discipline?: string;
		format?: string;
		year?: string;
		license?: string;
		accessUrl?: string;
		sizeLabel?: string;
		tags?: string[];
		visibility?: "private" | "shared";
		fileName?: string;
		fileMime?: string;
		fileData?: string;
	},
): Promise<ResearchDatasetDto> {
	const uid = requireUserId(userId);
	const title = input.title?.trim() ?? "";
	const accessUrl = input.accessUrl?.trim() ?? "";
	const rawFile = input.fileData?.trim() ?? "";
	const fileName = rawFile ? (input.fileName?.trim() ?? "dataset") : "";
	const description =
		input.description?.trim() ||
		(fileName ? `Uploaded ${fileName}` : accessUrl ? `Dataset linked from ${accessUrl}` : "");
	if (!title) throw new Error("Title is required.");
	if (!rawFile && !accessUrl) throw new Error("Upload a file or provide an access URL.");

	const projectObjectId = await resolveProjectObjectId(uid, input.projectId);
	const datasetId = new Types.ObjectId();
	let storageKey = "";
	let fileData = "";
	let fileMime = "";
	let storedBytes = 0;

	if (rawFile) {
		const stored = await storeAttachment({
			userId: uid,
			kind: "datasets",
			id: datasetId.toString(),
			fileName,
			fileMime: input.fileMime,
			fileData: rawFile,
		});
		storageKey = stored.storageKey;
		fileData = stored.fileData;
		fileMime = stored.mime;
		storedBytes = stored.byteLength;
	}

	const created = await ResearchDatasetModel.create({
		_id: datasetId,
		userId: new Types.ObjectId(uid),
		projectId: projectObjectId,
		title,
		description,
		discipline: input.discipline?.trim() ?? "",
		format: input.format?.trim() || "other",
		year: input.year?.trim() ?? "",
		license: input.license?.trim() ?? "",
		accessUrl,
		sizeLabel: input.sizeLabel?.trim() || (storedBytes ? formatBytes(storedBytes) : ""),
		tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20),
		visibility: input.visibility === "shared" ? "shared" : "private",
		fileName,
		fileMime,
		fileData,
		storageKey,
		fileSizeBytes: storedBytes,
	});
	await touchProject(uid, projectObjectId.toString());
	return toDatasetDto(created);
}

export async function getDataset(
	id: string,
	userId?: string | null,
): Promise<ResearchDatasetDto | null> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return null;
	const doc = await ResearchDatasetModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return null;
	return toDatasetDto(doc);
}

export async function getDatasetFile(
	id: string,
	userId?: string | null,
): Promise<AttachmentPayload | null> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return null;
	const doc = await ResearchDatasetModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc || !hasStoredAttachment(doc)) return null;
	const name = doc.fileName || "dataset";
	const mime = doc.fileMime || "application/octet-stream";
	const sizeBytes = typeof doc.fileSizeBytes === "number" ? doc.fileSizeBytes : 0;

	// Large MinIO objects: return a time-limited download URL instead of base64.
	if (doc.storageKey?.trim() && isS3Enabled()) {
		try {
			const data = await loadAttachmentDataUrl(doc);
			if (data) {
				return { name, mime, data, sizeBytes: sizeBytes || undefined };
			}
		} catch {
			const downloadUrl = await getPresignedGetUrl(doc.storageKey, 3600);
			return { name, mime, downloadUrl, sizeBytes: sizeBytes || undefined };
		}
	}

	const data = await loadAttachmentDataUrl(doc);
	if (!data) return null;
	return { name, mime, data, sizeBytes: sizeBytes || undefined };
}

export async function beginDatasetDirectUpload(
	userId: string | null | undefined,
	input: {
		projectId?: string;
		title?: string;
		description?: string;
		discipline?: string;
		format?: string;
		year?: string;
		license?: string;
		accessUrl?: string;
		sizeLabel?: string;
		tags?: string[];
		visibility?: "private" | "shared";
		fileName?: string;
		fileMime?: string;
		fileSizeBytes?: number;
	},
): Promise<{
	dataset: ResearchDatasetDto;
	uploadUrl: string;
	storageKey: string;
	expiresInSeconds: number;
	maxBytes: number;
}> {
	const uid = requireUserId(userId);
	if (!s3Enabled()) {
		throw new Error("Direct uploads require MinIO/S3 to be configured.");
	}
	const title = input.title?.trim() ?? "";
	const fileName = input.fileName?.trim() || "dataset";
	const fileSizeBytes = Number(input.fileSizeBytes ?? 0);
	if (!title) throw new Error("Title is required.");
	if (!fileName) throw new Error("A file is required.");
	if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 1) {
		throw new Error("fileSizeBytes is required.");
	}

	const projectObjectId = await resolveProjectObjectId(uid, input.projectId);
	const datasetId = new Types.ObjectId();
	const target = await createDirectUploadTarget({
		userId: uid,
		kind: "datasets",
		id: datasetId.toString(),
		fileName,
		fileMime: input.fileMime,
		fileSizeBytes,
	});

	const description =
		input.description?.trim() || `Uploaded ${fileName}`;
	const created = await ResearchDatasetModel.create({
		_id: datasetId,
		userId: new Types.ObjectId(uid),
		projectId: projectObjectId,
		title,
		description,
		discipline: input.discipline?.trim() ?? "",
		format: input.format?.trim() || "other",
		year: input.year?.trim() ?? "",
		license: input.license?.trim() ?? "",
		accessUrl: input.accessUrl?.trim() ?? "",
		sizeLabel: input.sizeLabel?.trim() || formatByteLabel(fileSizeBytes),
		tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20),
		visibility: input.visibility === "shared" ? "shared" : "private",
		fileName,
		fileMime: target.mime,
		fileData: "",
		storageKey: target.storageKey,
		fileSizeBytes,
	});
	await touchProject(uid, projectObjectId.toString());
	return {
		dataset: toDatasetDto(created),
		uploadUrl: target.uploadUrl,
		storageKey: target.storageKey,
		expiresInSeconds: target.expiresInSeconds,
		maxBytes: maxDirectUploadBytes(),
	};
}

export async function completeDatasetDirectUpload(
	id: string,
	userId?: string | null,
): Promise<ResearchDatasetDto> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) throw new Error("Dataset not found.");
	const doc = await ResearchDatasetModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) throw new Error("Dataset not found.");
	if (!doc.storageKey?.trim()) {
		throw new Error("This dataset has no pending MinIO upload.");
	}
	const meta = await assertObjectUploaded(doc.storageKey, 1);
	doc.fileSizeBytes = meta.contentLength;
	if (meta.contentType) doc.fileMime = meta.contentType;
	doc.sizeLabel = formatByteLabel(meta.contentLength);
	doc.fileData = "";
	await doc.save();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return toDatasetDto(doc);
}

export async function deleteDataset(id: string, userId?: string | null): Promise<boolean> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return false;
	const doc = await ResearchDatasetModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return false;
	await deleteStoredAttachment(doc.storageKey);
	await doc.deleteOne();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return true;
}

export async function listDocuments(
	userId?: string | null,
	projectId?: string | null,
	limit = 100,
): Promise<ResearchDocumentDto[]> {
	const uid = requireUserId(userId);
	const rows = await ResearchDocumentModel.find(userFilter(uid, projectId))
		.sort({ updatedAt: -1 })
		.limit(limit);
	return rows.map(toDocumentDto);
}

export async function createDocument(
	userId: string | null | undefined,
	input: {
		projectId?: string;
		title?: string;
		fileName?: string;
		fileMime?: string;
		fileData?: string;
		sizeLabel?: string;
	},
): Promise<ResearchDocumentDto> {
	const uid = requireUserId(userId);
	const fileName = input.fileName?.trim() || input.title?.trim() || "";
	const title = input.title?.trim() || fileName || "Untitled document";
	if (!fileName) throw new Error("A file is required.");
	if (!input.fileData?.trim()) throw new Error("A file is required.");

	const projectObjectId = await resolveProjectObjectId(uid, input.projectId);
	const documentId = new Types.ObjectId();
	const stored = await storeAttachment({
		userId: uid,
		kind: "documents",
		id: documentId.toString(),
		fileName,
		fileMime: input.fileMime,
		fileData: input.fileData,
	});

	const created = await ResearchDocumentModel.create({
		_id: documentId,
		userId: new Types.ObjectId(uid),
		projectId: projectObjectId,
		title,
		fileName,
		fileMime: stored.mime,
		fileData: stored.fileData,
		storageKey: stored.storageKey,
		sizeLabel: input.sizeLabel?.trim() || formatBytes(stored.byteLength),
		kind: inferDocKind(fileName, stored.mime),
	});
	await touchProject(uid, projectObjectId.toString());
	return toDocumentDto(created);
}

export async function getDocumentFile(
	id: string,
	userId?: string | null,
): Promise<AttachmentPayload | null> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return null;
	const doc = await ResearchDocumentModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc || !hasStoredAttachment(doc)) return null;
	const data = await loadAttachmentDataUrl(doc);
	if (!data) return null;
	return {
		name: doc.fileName || "document",
		mime: doc.fileMime || "application/octet-stream",
		data,
	};
}

export async function deleteDocument(id: string, userId?: string | null): Promise<boolean> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return false;
	const doc = await ResearchDocumentModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return false;
	await deleteStoredAttachment(doc.storageKey);
	await doc.deleteOne();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return true;
}

export async function listNotes(
	userId?: string | null,
	projectId?: string | null,
	limit = 100,
): Promise<ResearchNoteDto[]> {
	const uid = requireUserId(userId);
	const rows = await ResearchNoteModel.find(userFilter(uid, projectId))
		.sort({ updatedAt: -1 })
		.limit(limit);
	return rows.map(toNoteDto);
}

export async function createNote(
	userId: string | null | undefined,
	input: { projectId?: string; title?: string; content?: string },
): Promise<ResearchNoteDto> {
	const uid = requireUserId(userId);
	const content = input.content?.trim() ?? "";
	if (!content) throw new Error("Findings content is required.");
	const title = input.title?.trim() || "Untitled finding";
	const projectObjectId = await resolveProjectObjectId(uid, input.projectId);
	const created = await ResearchNoteModel.create({
		userId: new Types.ObjectId(uid),
		projectId: projectObjectId,
		title,
		content,
	});
	await touchProject(uid, projectObjectId.toString());
	return toNoteDto(created);
}

export async function updateNote(
	id: string,
	userId: string | null | undefined,
	input: { title?: string; content?: string },
): Promise<ResearchNoteDto | null> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return null;
	const doc = await ResearchNoteModel.findOne({ _id: id, userId: new Types.ObjectId(uid) });
	if (!doc) return null;
	if (typeof input.title === "string" && input.title.trim()) doc.title = input.title.trim();
	if (typeof input.content === "string") doc.content = input.content.trim();
	await doc.save();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return toNoteDto(doc);
}

export async function deleteNote(id: string, userId?: string | null): Promise<boolean> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return false;
	const doc = await ResearchNoteModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return false;
	await doc.deleteOne();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return true;
}

export async function listReferences(
	userId?: string | null,
	projectId?: string | null,
	limit = 100,
): Promise<ResearchReferenceDto[]> {
	const uid = requireUserId(userId);
	const rows = await ResearchReferenceModel.find(userFilter(uid, projectId))
		.sort({ updatedAt: -1 })
		.limit(limit);
	return rows.map(toReferenceDto);
}

export async function createReference(
	userId: string | null | undefined,
	input: { projectId?: string; title?: string; citation?: string; sourceUrl?: string },
): Promise<ResearchReferenceDto> {
	const uid = requireUserId(userId);
	const title = input.title?.trim() ?? "";
	const citation = input.citation?.trim() ?? "";
	if (!title || !citation) throw new Error("Title and citation are required.");
	const projectObjectId = await resolveProjectObjectId(uid, input.projectId);
	const created = await ResearchReferenceModel.create({
		userId: new Types.ObjectId(uid),
		projectId: projectObjectId,
		title,
		citation,
		sourceUrl: input.sourceUrl?.trim() ?? "",
	});
	await touchProject(uid, projectObjectId.toString());
	return toReferenceDto(created);
}

export async function deleteReference(id: string, userId?: string | null): Promise<boolean> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return false;
	const doc = await ResearchReferenceModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return false;
	await doc.deleteOne();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return true;
}

export async function listActivity(
	userId?: string | null,
	projectId?: string | null,
	limit = 12,
): Promise<ResearchActivityDto[]> {
	const uid = requireUserId(userId);
	const filter = userFilter(uid, projectId);
	const projectQuery = projectId
		? { _id: new Types.ObjectId(projectId), userId: new Types.ObjectId(uid) }
		: { userId: new Types.ObjectId(uid) };

	const [datasets, documents, notes, references, projects] = await Promise.all([
		ResearchDatasetModel.find(filter).sort({ updatedAt: -1 }).limit(limit).select("title updatedAt"),
		ResearchDocumentModel.find(filter)
			.sort({ updatedAt: -1 })
			.limit(limit)
			.select("title fileName updatedAt"),
		ResearchNoteModel.find(filter).sort({ updatedAt: -1 }).limit(limit).select("title updatedAt"),
		ResearchReferenceModel.find(filter).sort({ updatedAt: -1 }).limit(limit).select("title updatedAt"),
		ResearchProjectModel.find(projectQuery)
			.sort({ updatedAt: -1 })
			.limit(projectId ? 1 : limit)
			.select("title updatedAt"),
	]);

	const items: ResearchActivityDto[] = [
		...datasets.map((d) => ({
			id: `dataset-${d._id.toString()}`,
			kind: "dataset" as const,
			label: `Dataset “${d.title}” uploaded`,
			at: d.updatedAt.toISOString(),
		})),
		...documents.map((d) => ({
			id: `document-${d._id.toString()}`,
			kind: "document" as const,
			label: `“${d.title || d.fileName}” updated`,
			at: d.updatedAt.toISOString(),
		})),
		...notes.map((n) => ({
			id: `note-${n._id.toString()}`,
			kind: "note" as const,
			label: `Note “${n.title}” updated`,
			at: n.updatedAt.toISOString(),
		})),
		...references.map((r) => ({
			id: `reference-${r._id.toString()}`,
			kind: "reference" as const,
			label: `Reference “${r.title}” added`,
			at: r.updatedAt.toISOString(),
		})),
		...projects.map((project) => ({
			id: `project-${project._id.toString()}`,
			kind: "project" as const,
			label: `Project “${project.title}” updated`,
			at: project.updatedAt.toISOString(),
		})),
	];

	return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function getWorkspaceBundle(userId: string | null | undefined, projectId: string) {
	const uid = requireUserId(userId);
	const project = await getProject(uid, projectId);
	const [datasets, documents, notes, references, activity] = await Promise.all([
		listDatasets(uid, projectId),
		listDocuments(uid, projectId),
		listNotes(uid, projectId),
		listReferences(uid, projectId),
		listActivity(uid, projectId),
	]);
	return { project, datasets, documents, notes, references, activity };
}
