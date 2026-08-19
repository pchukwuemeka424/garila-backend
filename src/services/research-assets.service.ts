import { Types } from "mongoose";

import { ResearchDatasetModel } from "../db/models/ResearchDataset.js";
import { ResearchDocumentModel } from "../db/models/ResearchDocument.js";
import { ResearchProjectModel } from "../db/models/ResearchProject.js";
import { ResearchQuestionnaireModel } from "../db/models/ResearchQuestionnaire.js";
import { ResearchReferenceModel } from "../db/models/ResearchReference.js";
import {
	computeNotebookProgress,
	sanitizeNotebookData,
	type ResearchNotebookData,
} from "../lib/research-notebook.js";
import {
	clipMeta,
	clipTitle,
	decodeDataUrlToBuffer,
	itemsFromColumns,
	parseTabularBuffer,
	sampleByColumn,
	sanitizeQuestionnaireItems,
	type QuestionnaireItem,
} from "../lib/research-questionnaire.js";
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
		references: number;
		questionnaires: number;
	};
	notebookData: ResearchNotebookData;
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
	kind: "dataset" | "document" | "reference" | "project" | "questionnaire";
	label: string;
	at: string;
};

export type ResearchQuestionnaireDto = {
	id: string;
	title: string;
	description: string;
	population: string;
	sampleSize: number;
	distributionNote: string;
	items: QuestionnaireItem[];
	responseDatasetId: string | null;
	instrumentDocumentId: string | null;
	rowCount: number;
	importedFileName: string;
	columns: string[];
	createdAt: string;
	updatedAt: string;
};

function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function inferDocKind(fileName: string, mime: string): "doc" | "pdf" | "sheet" | "other" {
	const lower = `${fileName} ${mime}`.toLowerCase();
	if (lower.includes("image/") || /\.(jpe?g|png|gif|webp|heic)$/i.test(fileName)) return "other";
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
		notebookData?: unknown;
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
		notebookData: sanitizeNotebookData(doc.notebookData),
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
	const [documents, datasets, references, questionnaires] = await Promise.all([
		ResearchDocumentModel.countDocuments(filter),
		ResearchDatasetModel.countDocuments(filter),
		ResearchReferenceModel.countDocuments(filter),
		ResearchQuestionnaireModel.countDocuments(filter),
	]);
	return { documents, datasets, references, questionnaires };
}

async function countPictures(userId: string, projectId: string): Promise<number> {
	return ResearchDocumentModel.countDocuments({
		userId: new Types.ObjectId(userId),
		projectId: new Types.ObjectId(projectId),
		fileMime: { $regex: /^image\//i },
	});
}

async function persistNotebookProgress(
	userId: string,
	projectId: string,
	notebookData: unknown,
): Promise<number> {
	const filter = {
		userId: new Types.ObjectId(userId),
		projectId: new Types.ObjectId(projectId),
	};
	const [counts, pictures, questionnaires] = await Promise.all([
		countAssets(userId, projectId),
		countPictures(userId, projectId),
		ResearchQuestionnaireModel.find(filter)
			.select("description population distributionNote items.prompt")
			.lean(),
	]);
	const surveyTexts = questionnaires.map((q) => {
		const prompts = Array.isArray(q.items) ? q.items.map((item) => String(item?.prompt ?? "")).join(" ") : "";
		return `${q.description ?? ""} ${q.population ?? ""} ${q.distributionNote ?? ""} ${prompts}`;
	});
	return computeNotebookProgress(notebookData, {
		datasets: counts.datasets,
		questionnaires: counts.questionnaires,
		pictures,
		files: Math.max(0, counts.documents - pictures),
		surveyTexts,
	});
}

async function touchProject(userId: string, projectId: string): Promise<void> {
	const doc = await requireOwnedProject(userId, projectId);
	const progress = await persistNotebookProgress(userId, projectId, doc.notebookData);
	await ResearchProjectModel.updateOne(
		{ _id: doc._id, userId: new Types.ObjectId(userId) },
		{ $set: { progress } },
	);
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
		ResearchReferenceModel.updateMany(orphanFilter, update),
		ResearchQuestionnaireModel.updateMany(orphanFilter, update),
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
			const progress = await persistNotebookProgress(uid, doc._id.toString(), doc.notebookData);
			return { ...toProjectDto(doc, counts), progress };
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
	const progress = await persistNotebookProgress(uid, doc._id.toString(), doc.notebookData);
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
	const progress = await persistNotebookProgress(uid, doc._id.toString(), doc.notebookData);
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
		notebookData?: unknown;
		progress?: number;
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

	if (input.notebookData !== undefined) {
		doc.set("notebookData", sanitizeNotebookData(input.notebookData));
		doc.markModified("notebookData");
	}

	const counts = await countAssets(uid, doc._id.toString());
	doc.progress = await persistNotebookProgress(uid, doc._id.toString(), doc.notebookData);
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
		ResearchReferenceModel.deleteMany(filter),
		ResearchQuestionnaireModel.deleteMany(filter),
	]);
	const result = await ResearchProjectModel.deleteOne({ _id: doc._id, userId: new Types.ObjectId(uid) });
	return result.deletedCount > 0;
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

	const mime = (input.fileMime ?? "").toLowerCase();
	if (mime.startsWith("image/")) {
		const comma = input.fileData.indexOf(",");
		const b64 = comma >= 0 ? input.fileData.slice(comma + 1) : input.fileData;
		const bytes = Math.floor((b64.length * 3) / 4);
		if (bytes > IMAGE_MAX_BYTES) throw new Error("Images must be 8 MB or smaller.");
		if (!/^image\/(jpeg|jpg|png|gif|webp)$/i.test(mime)) {
			throw new Error("Use JPEG, PNG, GIF, or WebP images.");
		}
	}

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

function oidString(value: Types.ObjectId | string | null | undefined): string | null {
	if (!value) return null;
	return typeof value === "string" ? value : value.toString();
}

function toQuestionnaireDto(doc: {
	_id: Types.ObjectId;
	title: string;
	description?: string | null;
	population?: string | null;
	sampleSize?: number | null;
	distributionNote?: string | null;
	items?: unknown;
	responseDatasetId?: Types.ObjectId | string | null;
	instrumentDocumentId?: Types.ObjectId | string | null;
	rowCount?: number | null;
	importedFileName?: string | null;
	columns?: string[] | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchQuestionnaireDto {
	return {
		id: doc._id.toString(),
		title: doc.title,
		description: doc.description ?? "",
		population: doc.population ?? "",
		sampleSize: Number(doc.sampleSize) || 0,
		distributionNote: doc.distributionNote ?? "",
		items: sanitizeQuestionnaireItems(doc.items),
		responseDatasetId: oidString(doc.responseDatasetId),
		instrumentDocumentId: oidString(doc.instrumentDocumentId),
		rowCount: Number(doc.rowCount) || 0,
		importedFileName: doc.importedFileName ?? "",
		columns: Array.isArray(doc.columns) ? doc.columns.map((c) => String(c)) : [],
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

export async function listQuestionnaires(
	userId?: string | null,
	projectId?: string | null,
	limit = 100,
): Promise<ResearchQuestionnaireDto[]> {
	const uid = requireUserId(userId);
	const rows = await ResearchQuestionnaireModel.find(userFilter(uid, projectId))
		.sort({ updatedAt: -1 })
		.limit(limit);
	return rows.map(toQuestionnaireDto);
}

export async function createQuestionnaire(
	userId: string | null | undefined,
	input: {
		projectId?: string;
		title?: string;
		description?: string;
		population?: string;
		sampleSize?: number;
		distributionNote?: string;
		items?: unknown;
		instrumentDocumentId?: string;
	},
): Promise<ResearchQuestionnaireDto> {
	const uid = requireUserId(userId);
	const title = clipTitle(input.title) || "Untitled questionnaire";
	const projectObjectId = await resolveProjectObjectId(uid, input.projectId);
	const instrumentId = parseObjectId(input.instrumentDocumentId);
	const created = await ResearchQuestionnaireModel.create({
		userId: new Types.ObjectId(uid),
		projectId: projectObjectId,
		title,
		description: clipMeta(input.description, 4000),
		population: clipMeta(input.population, 400),
		sampleSize: Number.isFinite(Number(input.sampleSize)) ? Math.max(0, Math.round(Number(input.sampleSize))) : 0,
		distributionNote: clipMeta(input.distributionNote, 400),
		items: sanitizeQuestionnaireItems(input.items),
		instrumentDocumentId: instrumentId,
		responseDatasetId: null,
		rowCount: 0,
		importedFileName: "",
		columns: [],
	});
	await touchProject(uid, projectObjectId.toString());
	return toQuestionnaireDto(created);
}

export async function updateQuestionnaire(
	id: string,
	userId: string | null | undefined,
	input: {
		title?: string;
		description?: string;
		population?: string;
		sampleSize?: number;
		distributionNote?: string;
		items?: unknown;
		instrumentDocumentId?: string | null;
	},
): Promise<ResearchQuestionnaireDto | null> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return null;
	const doc = await ResearchQuestionnaireModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return null;
	if (typeof input.title === "string" && input.title.trim()) doc.title = clipTitle(input.title);
	if (typeof input.description === "string") doc.description = clipMeta(input.description, 4000);
	if (typeof input.population === "string") doc.population = clipMeta(input.population, 400);
	if (input.sampleSize !== undefined) {
		const n = Number(input.sampleSize);
		if (Number.isFinite(n)) doc.sampleSize = Math.max(0, Math.round(n));
	}
	if (typeof input.distributionNote === "string") {
		doc.distributionNote = clipMeta(input.distributionNote, 400);
	}
	if (input.items !== undefined) {
		doc.set("items", sanitizeQuestionnaireItems(input.items));
		doc.markModified("items");
	}
	if (input.instrumentDocumentId === null) {
		doc.instrumentDocumentId = null;
	} else if (typeof input.instrumentDocumentId === "string") {
		doc.instrumentDocumentId = parseObjectId(input.instrumentDocumentId);
	}
	await doc.save();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return toQuestionnaireDto(doc);
}

export async function importQuestionnaireResponses(
	id: string,
	userId: string | null | undefined,
	input: {
		fileName?: string;
		fileMime?: string;
		fileData?: string;
		columnMap?: Record<string, string>;
	},
): Promise<ResearchQuestionnaireDto> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) throw new Error("Questionnaire not found.");
	const doc = await ResearchQuestionnaireModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) throw new Error("Questionnaire not found.");
	const fileData = input.fileData?.trim() ?? "";
	const fileName = input.fileName?.trim() || "responses.csv";
	if (!fileData) throw new Error("Upload a CSV or Excel file of collated responses.");

	const buffer = decodeDataUrlToBuffer(fileData);
	const parsed = await parseTabularBuffer(fileName, buffer);
	const samples = sampleByColumn(parsed.columns, parsed.rows);
	const existing = sanitizeQuestionnaireItems(doc.items);
	const map = input.columnMap && typeof input.columnMap === "object" ? input.columnMap : {};

	let items = existing;
	if (items.length === 0) {
		items = itemsFromColumns(parsed.columns, samples);
	} else {
		const byPrompt = new Map(items.map((item) => [item.prompt.trim().toLowerCase(), item]));
		for (const column of parsed.columns) {
			const mappedId = map[column];
			const existingItem = mappedId
				? items.find((item) => item.id === mappedId)
				: byPrompt.get(column.trim().toLowerCase());
			if (existingItem) {
				existingItem.column = column;
			} else {
				const [created] = itemsFromColumns([column], { [column]: samples[column] ?? [] });
				if (created) items.push(created);
			}
		}
	}

	const pid = projectIdString(doc.projectId) ?? "";
	const dataset = await createDataset(uid, {
		projectId: pid,
		title: `${doc.title} responses`,
		description: `Collated questionnaire responses (${parsed.rows.length} rows) from ${fileName}`,
		discipline: "",
		format: "survey_responses",
		year: "",
		license: "",
		accessUrl: "",
		sizeLabel: "",
		tags: ["questionnaire", "survey"],
		visibility: "private",
		fileName,
		fileMime: input.fileMime,
		fileData,
	});

	doc.set("items", items);
	doc.markModified("items");
	doc.responseDatasetId = new Types.ObjectId(dataset.id);
	doc.rowCount = parsed.rows.length;
	doc.importedFileName = fileName;
	doc.columns = parsed.columns;
	if (!doc.sampleSize) doc.sampleSize = parsed.rows.length;
	await doc.save();
	if (pid) await touchProject(uid, pid);
	return toQuestionnaireDto(doc);
}

export async function deleteQuestionnaire(id: string, userId?: string | null): Promise<boolean> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(id)) return false;
	const doc = await ResearchQuestionnaireModel.findOne({
		_id: id,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) return false;
	await doc.deleteOne();
	const pid = projectIdString(doc.projectId);
	if (pid) await touchProject(uid, pid);
	return true;
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

	const [datasets, documents, references, questionnaires, projects] = await Promise.all([
		ResearchDatasetModel.find(filter).sort({ updatedAt: -1 }).limit(limit).select("title updatedAt"),
		ResearchDocumentModel.find(filter)
			.sort({ updatedAt: -1 })
			.limit(limit)
			.select("title fileName updatedAt"),
		ResearchReferenceModel.find(filter).sort({ updatedAt: -1 }).limit(limit).select("title updatedAt"),
		ResearchQuestionnaireModel.find(filter)
			.sort({ updatedAt: -1 })
			.limit(limit)
			.select("title updatedAt"),
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
		...references.map((r) => ({
			id: `reference-${r._id.toString()}`,
			kind: "reference" as const,
			label: `Reference “${r.title}” added`,
			at: r.updatedAt.toISOString(),
		})),
		...questionnaires.map((q) => ({
			id: `questionnaire-${q._id.toString()}`,
			kind: "questionnaire" as const,
			label: `Questionnaire “${q.title}” updated`,
			at: q.updatedAt.toISOString(),
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
	const [datasets, documents, references, questionnaires, activity] = await Promise.all([
		listDatasets(uid, projectId),
		listDocuments(uid, projectId),
		listReferences(uid, projectId),
		listQuestionnaires(uid, projectId),
		listActivity(uid, projectId),
	]);
	return { project, datasets, documents, references, questionnaires, activity };
}
