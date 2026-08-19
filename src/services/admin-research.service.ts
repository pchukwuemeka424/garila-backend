import { Types } from "mongoose";

import { ResearchDatasetModel } from "../db/models/ResearchDataset.js";
import { ResearchDocumentModel } from "../db/models/ResearchDocument.js";
import { ResearchProjectModel } from "../db/models/ResearchProject.js";
import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { UserModel } from "../db/models/User.js";
import { deleteStoredAttachment } from "./attachment-storage.service.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type AdminResearchStats = {
	papers: number;
	documents: number;
	datasets: number;
	uploads: number;
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
		questionnaireIds: string[];
		noteIds: string[];
		projectIds: string[];
	};
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

	const [papers, documents, datasets] = await Promise.all([
		SavedResearchModel.countDocuments(filter),
		ResearchDocumentModel.countDocuments(filter),
		ResearchDatasetModel.countDocuments(filter),
	]);

	return {
		papers,
		documents,
		datasets,
		uploads: documents + datasets,
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
			questionnaireIds: row.sources?.questionnaireIds ?? [],
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
