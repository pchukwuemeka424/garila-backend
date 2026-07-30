import { Types } from "mongoose";

import { ResearchDatasetModel } from "../db/models/ResearchDataset.js";
import { ResearchDocumentModel } from "../db/models/ResearchDocument.js";
import { ResearchNoteModel } from "../db/models/ResearchNote.js";
import { ResearchProjectModel } from "../db/models/ResearchProject.js";
import { ResearchReferenceModel } from "../db/models/ResearchReference.js";
import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { UserModel } from "../db/models/User.js";
import { deleteStoredAttachment } from "./attachment-storage.service.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type AdminResearchStats = {
	papers: number;
	notebooks: number;
	documents: number;
	datasets: number;
	uploads: number;
	notebooksWithSync: number;
};

export type AdminOwnerInfo = {
	id: string | null;
	name: string;
	email: string;
	role: string | null;
	universityId: string | null;
	institution: string | null;
};

export type AdminResearchPaperRecord = {
	id: string;
	title: string;
	topic: string;
	workflow: string;
	humanEdited: boolean;
	contentLength: number;
	tokenUsage: number | null;
	owner: AdminOwnerInfo;
	createdAt: string;
	updatedAt: string;
};

export type AdminResearchPaperDetail = AdminResearchPaperRecord & {
	content: string;
	aiBaselineContent: string | null;
	sources: {
		documentIds: string[];
		datasetIds: string[];
		noteIds: string[];
		projectIds: string[];
	};
};

export type AdminResearchNotebookRecord = {
	id: string;
	title: string;
	description: string;
	projectType: string;
	status: string;
	progress: number;
	favorite: boolean;
	hasNotebook: boolean;
	notebookBytes: number;
	pageCount: number;
	draftCount: number;
	sectionCount: number;
	documentCount: number;
	datasetCount: number;
	noteCount: number;
	owner: AdminOwnerInfo;
	startedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type AdminResearchNotebookDetail = AdminResearchNotebookRecord & {
	sections: Array<{ id: string; title: string; contentLength: number }>;
	notebookSummary: {
		pages: Array<{ id: string; title: string }>;
		drafts: Array<{ id: string; title: string }>;
		datasets: Array<{ id: string; title: string }>;
		references: number;
		assets: number;
	} | null;
};

export type AdminResearchUploadKind = "document" | "dataset";

export type AdminResearchUploadRecord = {
	id: string;
	kind: AdminResearchUploadKind;
	title: string;
	fileName: string;
	fileMime: string;
	sizeLabel: string;
	fileSizeBytes: number;
	hasFile: boolean;
	storage: "minio" | "mongo" | "none";
	projectId: string | null;
	projectTitle: string | null;
	visibility: string | null;
	format: string | null;
	owner: AdminOwnerInfo;
	createdAt: string;
	updatedAt: string;
};

type OwnerMap = Map<string, AdminOwnerInfo>;

const EMPTY_OWNER: AdminOwnerInfo = {
	id: null,
	name: "Unknown",
	email: "—",
	role: null,
	universityId: null,
	institution: null,
};

function iso(value: Date | null | undefined): string {
	return value ? value.toISOString() : new Date(0).toISOString();
}

function notebookMeta(notebookData: unknown): {
	bytes: number;
	pageCount: number;
	draftCount: number;
	sectionCount: number;
} {
	if (notebookData == null) {
		return { bytes: 0, pageCount: 0, draftCount: 0, sectionCount: 0 };
	}
	try {
		const encoded = JSON.stringify(notebookData);
		const data = notebookData as {
			pages?: unknown[];
			drafts?: unknown[];
			sections?: unknown[];
		};
		return {
			bytes: encoded.length,
			pageCount: Array.isArray(data.pages) ? data.pages.length : 0,
			draftCount: Array.isArray(data.drafts) ? data.drafts.length : 0,
			sectionCount: Array.isArray(data.sections) ? data.sections.length : 0,
		};
	} catch {
		return { bytes: 0, pageCount: 0, draftCount: 0, sectionCount: 0 };
	}
}

function notebookSummary(notebookData: unknown) {
	if (!notebookData || typeof notebookData !== "object") return null;
	const data = notebookData as {
		pages?: Array<{ id?: string; title?: string }>;
		drafts?: Array<{ id?: string; title?: string }>;
		datasets?: Array<{ id?: string; title?: string; name?: string }>;
		references?: unknown[];
		assets?: unknown[];
	};
	return {
		pages: (data.pages ?? []).map((p, i) => ({
			id: String(p.id ?? i),
			title: String(p.title ?? `Page ${i + 1}`),
		})),
		drafts: (data.drafts ?? []).map((d, i) => ({
			id: String(d.id ?? i),
			title: String(d.title ?? `Draft ${i + 1}`),
		})),
		datasets: (data.datasets ?? []).map((d, i) => ({
			id: String(d.id ?? i),
			title: String(d.title ?? d.name ?? `Dataset ${i + 1}`),
		})),
		references: Array.isArray(data.references) ? data.references.length : 0,
		assets: Array.isArray(data.assets) ? data.assets.length : 0,
	};
}

async function buildOwnerMap(userIds: Array<Types.ObjectId | string | null | undefined>): Promise<OwnerMap> {
	const ids = [
		...new Set(
			userIds
				.map((id) => (id ? id.toString() : ""))
				.filter((id) => Types.ObjectId.isValid(id)),
		),
	];
	if (ids.length === 0) return new Map();

	const users = await UserModel.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
		.select("name email role universityId institution")
		.lean();

	const map: OwnerMap = new Map();
	for (const user of users) {
		map.set(user._id.toString(), {
			id: user._id.toString(),
			name: user.name,
			email: user.email,
			role: user.role ?? null,
			universityId: user.universityId ? user.universityId.toString() : null,
			institution: user.institution ?? null,
		});
	}
	return map;
}

function ownerOf(map: OwnerMap, userId: Types.ObjectId | string | null | undefined): AdminOwnerInfo {
	if (!userId) return EMPTY_OWNER;
	return map.get(userId.toString()) ?? { ...EMPTY_OWNER, id: userId.toString() };
}

async function scopedUserObjectIds(universityId?: string | null): Promise<Types.ObjectId[] | null> {
	if (!universityId) return null;
	if (!Types.ObjectId.isValid(universityId)) return [];
	const users = await UserModel.find({ universityId: new Types.ObjectId(universityId) })
		.select("_id")
		.lean();
	return users.map((u) => u._id);
}

function userFilter(userIds: Types.ObjectId[] | null): Record<string, unknown> {
	if (userIds === null) return {};
	return { userId: { $in: userIds } };
}

export async function getAdminResearchStats(universityId?: string | null): Promise<AdminResearchStats> {
	const userIds = await scopedUserObjectIds(universityId);
	const filter = userFilter(userIds);

	const [papers, notebooks, documents, datasets, notebooksWithSync] = await Promise.all([
		SavedResearchModel.countDocuments(filter),
		ResearchProjectModel.countDocuments(filter),
		ResearchDocumentModel.countDocuments(filter),
		ResearchDatasetModel.countDocuments(filter),
		ResearchProjectModel.countDocuments({ ...filter, notebookData: { $ne: null } }),
	]);

	return {
		papers,
		notebooks,
		documents,
		datasets,
		uploads: documents + datasets,
		notebooksWithSync,
	};
}

export async function listAdminResearchPapers(options?: {
	limit?: number;
	universityId?: string | null;
}): Promise<AdminResearchPaperRecord[]> {
	const limit = Math.min(Math.max(options?.limit ?? 500, 1), 2000);
	const userIds = await scopedUserObjectIds(options?.universityId);
	const rows = await SavedResearchModel.find(userFilter(userIds))
		.sort({ updatedAt: -1 })
		.limit(limit)
		.select("userId title topic workflow humanEdited content tokenUsage createdAt updatedAt")
		.lean();

	const owners = await buildOwnerMap(rows.map((r) => r.userId));
	return rows.map((row) => ({
		id: row._id.toString(),
		title: row.title,
		topic: row.topic,
		workflow: row.workflow || "chat-paper",
		humanEdited: Boolean(row.humanEdited),
		contentLength: typeof row.content === "string" ? row.content.length : 0,
		tokenUsage: row.tokenUsage?.totalTokens ?? null,
		owner: ownerOf(owners, row.userId),
		createdAt: iso(row.createdAt),
		updatedAt: iso(row.updatedAt),
	}));
}

export async function getAdminResearchPaper(id: string): Promise<AdminResearchPaperDetail | null> {
	if (!Types.ObjectId.isValid(id)) return null;
	const row = await SavedResearchModel.findById(id).lean();
	if (!row) return null;

	const owners = await buildOwnerMap([row.userId]);
	return {
		id: row._id.toString(),
		title: row.title,
		topic: row.topic,
		workflow: row.workflow || "chat-paper",
		humanEdited: Boolean(row.humanEdited),
		contentLength: typeof row.content === "string" ? row.content.length : 0,
		tokenUsage: row.tokenUsage?.totalTokens ?? null,
		owner: ownerOf(owners, row.userId),
		createdAt: iso(row.createdAt),
		updatedAt: iso(row.updatedAt),
		content: row.content ?? "",
		aiBaselineContent: row.aiBaselineContent ?? null,
		sources: {
			documentIds: row.sources?.documentIds ?? [],
			datasetIds: row.sources?.datasetIds ?? [],
			noteIds: row.sources?.noteIds ?? [],
			projectIds: row.sources?.projectIds ?? [],
		},
	};
}

export async function deleteAdminResearchPaper(
	id: string,
	actorId: string,
): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;
	const row = await SavedResearchModel.findById(id).lean();
	if (!row) return false;

	await SavedResearchModel.deleteOne({ _id: row._id });
	await recordAuditEvent({
		action: "admin.research_paper.delete",
		category: "data",
		actorId,
		summary: `Deleted research paper “${row.title}”`,
		details: {
			paperId: id,
			topic: row.topic,
			ownerId: row.userId?.toString() ?? null,
		},
		targetType: "saved_research",
		targetId: id,
		severity: "medium",
	});
	return true;
}

export async function listAdminResearchNotebooks(options?: {
	limit?: number;
	universityId?: string | null;
}): Promise<AdminResearchNotebookRecord[]> {
	const limit = Math.min(Math.max(options?.limit ?? 500, 1), 2000);
	const userIds = await scopedUserObjectIds(options?.universityId);
	const rows = await ResearchProjectModel.find(userFilter(userIds))
		.sort({ updatedAt: -1 })
		.limit(limit)
		.select(
			"userId title description projectType status progress favorite notebookData sections startedAt createdAt updatedAt",
		)
		.lean();

	const owners = await buildOwnerMap(rows.map((r) => r.userId));
	const projectIds = rows.map((r) => r._id);

	const [docCounts, datasetCounts, noteCounts] = await Promise.all([
		ResearchDocumentModel.aggregate<{ _id: Types.ObjectId; count: number }>([
			{ $match: { projectId: { $in: projectIds } } },
			{ $group: { _id: "$projectId", count: { $sum: 1 } } },
		]),
		ResearchDatasetModel.aggregate<{ _id: Types.ObjectId; count: number }>([
			{ $match: { projectId: { $in: projectIds } } },
			{ $group: { _id: "$projectId", count: { $sum: 1 } } },
		]),
		ResearchNoteModel.aggregate<{ _id: Types.ObjectId; count: number }>([
			{ $match: { projectId: { $in: projectIds } } },
			{ $group: { _id: "$projectId", count: { $sum: 1 } } },
		]),
	]);

	const docMap = new Map(docCounts.map((r) => [r._id.toString(), r.count]));
	const datasetMap = new Map(datasetCounts.map((r) => [r._id.toString(), r.count]));
	const noteMap = new Map(noteCounts.map((r) => [r._id.toString(), r.count]));

	return rows.map((row) => {
		const meta = notebookMeta(row.notebookData);
		const id = row._id.toString();
		return {
			id,
			title: row.title,
			description: row.description ?? "",
			projectType: row.projectType || "research",
			status: row.status || "in_progress",
			progress: row.progress ?? 0,
			favorite: Boolean(row.favorite),
			hasNotebook: row.notebookData != null,
			notebookBytes: meta.bytes,
			pageCount: meta.pageCount,
			draftCount: meta.draftCount,
			sectionCount: Math.max(meta.sectionCount, Array.isArray(row.sections) ? row.sections.length : 0),
			documentCount: docMap.get(id) ?? 0,
			datasetCount: datasetMap.get(id) ?? 0,
			noteCount: noteMap.get(id) ?? 0,
			owner: ownerOf(owners, row.userId),
			startedAt: row.startedAt ? iso(row.startedAt) : null,
			createdAt: iso(row.createdAt),
			updatedAt: iso(row.updatedAt),
		};
	});
}

export async function getAdminResearchNotebook(id: string): Promise<AdminResearchNotebookDetail | null> {
	if (!Types.ObjectId.isValid(id)) return null;
	const row = await ResearchProjectModel.findById(id).lean();
	if (!row) return null;

	const [owners, documentCount, datasetCount, noteCount] = await Promise.all([
		buildOwnerMap([row.userId]),
		ResearchDocumentModel.countDocuments({ projectId: row._id }),
		ResearchDatasetModel.countDocuments({ projectId: row._id }),
		ResearchNoteModel.countDocuments({ projectId: row._id }),
	]);

	const meta = notebookMeta(row.notebookData);
	return {
		id: row._id.toString(),
		title: row.title,
		description: row.description ?? "",
		projectType: row.projectType || "research",
		status: row.status || "in_progress",
		progress: row.progress ?? 0,
		favorite: Boolean(row.favorite),
		hasNotebook: row.notebookData != null,
		notebookBytes: meta.bytes,
		pageCount: meta.pageCount,
		draftCount: meta.draftCount,
		sectionCount: Math.max(meta.sectionCount, Array.isArray(row.sections) ? row.sections.length : 0),
		documentCount,
		datasetCount,
		noteCount,
		owner: ownerOf(owners, row.userId),
		startedAt: row.startedAt ? iso(row.startedAt) : null,
		createdAt: iso(row.createdAt),
		updatedAt: iso(row.updatedAt),
		sections: (row.sections ?? []).map((s) => ({
			id: s.id,
			title: s.title,
			contentLength: typeof s.content === "string" ? s.content.length : 0,
		})),
		notebookSummary: notebookSummary(row.notebookData),
	};
}

async function purgeProjectAttachments(projectId: Types.ObjectId): Promise<void> {
	const [docs, datasets] = await Promise.all([
		ResearchDocumentModel.find({ projectId }).select("storageKey").lean(),
		ResearchDatasetModel.find({ projectId }).select("storageKey").lean(),
	]);
	await Promise.all([
		...docs.map((d) => deleteStoredAttachment(d.storageKey)),
		...datasets.map((d) => deleteStoredAttachment(d.storageKey)),
	]);
}

export async function deleteAdminResearchNotebook(
	id: string,
	actorId: string,
): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;
	const row = await ResearchProjectModel.findById(id).lean();
	if (!row) return false;

	await purgeProjectAttachments(row._id);
	const filter = { projectId: row._id };
	await Promise.all([
		ResearchDatasetModel.deleteMany(filter),
		ResearchDocumentModel.deleteMany(filter),
		ResearchNoteModel.deleteMany(filter),
		ResearchReferenceModel.deleteMany(filter),
	]);
	await ResearchProjectModel.deleteOne({ _id: row._id });

	await recordAuditEvent({
		action: "admin.research_notebook.delete",
		category: "data",
		actorId,
		summary: `Deleted research notebook “${row.title}”`,
		details: {
			projectId: id,
			ownerId: row.userId?.toString() ?? null,
			hadNotebook: row.notebookData != null,
		},
		targetType: "research_project",
		targetId: id,
		severity: "high",
	});
	return true;
}

export async function listAdminResearchUploads(options?: {
	limit?: number;
	universityId?: string | null;
	kind?: AdminResearchUploadKind | "all";
}): Promise<AdminResearchUploadRecord[]> {
	const limit = Math.min(Math.max(options?.limit ?? 500, 1), 2000);
	const kind = options?.kind ?? "all";
	const userIds = await scopedUserObjectIds(options?.universityId);
	const filter = userFilter(userIds);

	const [documents, datasets] = await Promise.all([
		kind === "dataset"
			? Promise.resolve([])
			: ResearchDocumentModel.find(filter)
					.sort({ updatedAt: -1 })
					.limit(limit)
					.select(
						"userId projectId title fileName fileMime sizeLabel storageKey fileData kind createdAt updatedAt",
					)
					.lean(),
		kind === "document"
			? Promise.resolve([])
			: ResearchDatasetModel.find(filter)
					.sort({ updatedAt: -1 })
					.limit(limit)
					.select(
						"userId projectId title fileName fileMime sizeLabel fileSizeBytes storageKey fileData visibility format createdAt updatedAt",
					)
					.lean(),
	]);

	const projectIds = [
		...new Set(
			[...documents, ...datasets]
				.map((r) => r.projectId?.toString())
				.filter((id): id is string => Boolean(id && Types.ObjectId.isValid(id))),
		),
	];
	const projects = projectIds.length
		? await ResearchProjectModel.find({ _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } })
				.select("title")
				.lean()
		: [];
	const projectTitleById = new Map(projects.map((p) => [p._id.toString(), p.title]));

	const owners = await buildOwnerMap([
		...documents.map((d) => d.userId),
		...datasets.map((d) => d.userId),
	]);

	const docRecords: AdminResearchUploadRecord[] = documents.map((row) => {
		const hasMinio = Boolean(row.storageKey?.trim());
		const hasMongo = Boolean(row.fileData?.trim());
		return {
			id: row._id.toString(),
			kind: "document" as const,
			title: row.title,
			fileName: row.fileName,
			fileMime: row.fileMime || "application/octet-stream",
			sizeLabel: row.sizeLabel || "",
			fileSizeBytes: 0,
			hasFile: hasMinio || hasMongo,
			storage: hasMinio ? "minio" : hasMongo ? "mongo" : "none",
			projectId: row.projectId ? row.projectId.toString() : null,
			projectTitle: row.projectId
				? (projectTitleById.get(row.projectId.toString()) ?? null)
				: null,
			visibility: null,
			format: row.kind ?? null,
			owner: ownerOf(owners, row.userId),
			createdAt: iso(row.createdAt),
			updatedAt: iso(row.updatedAt),
		};
	});

	const datasetRecords: AdminResearchUploadRecord[] = datasets.map((row) => {
		const hasMinio = Boolean(row.storageKey?.trim());
		const hasMongo = Boolean(row.fileData?.trim());
		return {
			id: row._id.toString(),
			kind: "dataset" as const,
			title: row.title,
			fileName: row.fileName || "",
			fileMime: row.fileMime || "",
			sizeLabel: row.sizeLabel || "",
			fileSizeBytes: row.fileSizeBytes ?? 0,
			hasFile: hasMinio || hasMongo,
			storage: hasMinio ? "minio" : hasMongo ? "mongo" : "none",
			projectId: row.projectId ? row.projectId.toString() : null,
			projectTitle: row.projectId
				? (projectTitleById.get(row.projectId.toString()) ?? null)
				: null,
			visibility: row.visibility ?? null,
			format: row.format ?? null,
			owner: ownerOf(owners, row.userId),
			createdAt: iso(row.createdAt),
			updatedAt: iso(row.updatedAt),
		};
	});

	return [...docRecords, ...datasetRecords]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, limit);
}

export async function deleteAdminResearchUpload(
	id: string,
	kind: AdminResearchUploadKind,
	actorId: string,
): Promise<boolean> {
	if (!Types.ObjectId.isValid(id)) return false;

	if (kind === "document") {
		const doc = await ResearchDocumentModel.findById(id);
		if (!doc) return false;
		await deleteStoredAttachment(doc.storageKey);
		const title = doc.title;
		const ownerId = doc.userId?.toString() ?? null;
		await doc.deleteOne();
		await recordAuditEvent({
			action: "admin.research_upload.delete",
			category: "data",
			actorId,
			summary: `Deleted uploaded document “${title}”`,
			details: { uploadId: id, kind, ownerId },
			targetType: "research_document",
			targetId: id,
			severity: "medium",
		});
		return true;
	}

	const doc = await ResearchDatasetModel.findById(id);
	if (!doc) return false;
	await deleteStoredAttachment(doc.storageKey);
	const title = doc.title;
	const ownerId = doc.userId?.toString() ?? null;
	await doc.deleteOne();
	await recordAuditEvent({
		action: "admin.research_upload.delete",
		category: "data",
		actorId,
		summary: `Deleted uploaded dataset “${title}”`,
		details: { uploadId: id, kind, ownerId },
		targetType: "research_dataset",
		targetId: id,
		severity: "medium",
	});
	return true;
}

export async function bulkDeleteAdminResearchPapers(
	ids: string[],
	actorId: string,
): Promise<number> {
	let deleted = 0;
	for (const id of ids) {
		if (await deleteAdminResearchPaper(id, actorId)) deleted += 1;
	}
	return deleted;
}

export async function bulkDeleteAdminResearchNotebooks(
	ids: string[],
	actorId: string,
): Promise<number> {
	let deleted = 0;
	for (const id of ids) {
		if (await deleteAdminResearchNotebook(id, actorId)) deleted += 1;
	}
	return deleted;
}

export async function bulkDeleteAdminResearchUploads(
	items: Array<{ id: string; kind: AdminResearchUploadKind }>,
	actorId: string,
): Promise<number> {
	let deleted = 0;
	for (const item of items) {
		if (await deleteAdminResearchUpload(item.id, item.kind, actorId)) deleted += 1;
	}
	return deleted;
}
