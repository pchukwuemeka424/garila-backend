import {
	DeletionRequestModel,
	RetentionPolicyModel,
} from "../db/models/RetentionPolicy.js";
import type { AdminScope } from "../lib/require-admin.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type RetentionDataCategory =
	| "audit_logs"
	| "ai_conversations"
	| "research_documents"
	| "uploaded_files"
	| "incidents"
	| "governance_reports"
	| "contribution_statements"
	| "governance_alerts"
	| "reports"
	| "research_metadata"
	| "research_content"
	| "user_accounts"
	| "token_usage"
	| "sessions"
	| "other";

export type RetentionExpiryAction = "archive" | "anonymise" | "delete" | "legal_hold";

export type RetentionPolicyRecord = {
	id: string;
	name: string;
	description: string;
	dataCategory: RetentionDataCategory;
	retainDays: number;
	archiveDays: number;
	actionOnExpiry: RetentionExpiryAction;
	legalHold: boolean;
	enabled: boolean;
	regulatoryBasis: string;
	universityId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DeletionRequestType = "erase" | "export" | "restrict" | "rectify";
export type DeletionRequestStatus =
	| "received"
	| "under_review"
	| "approved"
	| "completed"
	| "rejected"
	| "on_hold";

export type DeletionRequestRecord = {
	id: string;
	subjectName: string;
	subjectEmail: string;
	subjectUserId: string | null;
	requestType: DeletionRequestType;
	status: DeletionRequestStatus;
	scope: string;
	notes: string;
	legalHold: boolean;
	dueAt: string | null;
	completedAt: string | null;
	universityId: string | null;
	createdAt: string;
	updatedAt: string;
};

function toPolicyRecord(doc: {
	_id: { toString(): string };
	name: string;
	description?: string | null;
	dataCategory: string;
	retainDays: number;
	archiveDays?: number | null;
	actionOnExpiry?: string;
	legalHold?: boolean;
	enabled?: boolean;
	regulatoryBasis?: string | null;
	universityId?: { toString(): string } | null;
	createdAt: Date;
	updatedAt: Date;
}): RetentionPolicyRecord {
	return {
		id: doc._id.toString(),
		name: doc.name,
		description: doc.description ?? "",
		dataCategory: doc.dataCategory as RetentionDataCategory,
		retainDays: doc.retainDays,
		archiveDays: doc.archiveDays ?? 0,
		actionOnExpiry: (doc.actionOnExpiry as RetentionExpiryAction) ?? "archive",
		legalHold: Boolean(doc.legalHold),
		enabled: doc.enabled !== false,
		regulatoryBasis: doc.regulatoryBasis ?? "",
		universityId: doc.universityId?.toString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function toDeletionRecord(doc: {
	_id: { toString(): string };
	subjectName: string;
	subjectEmail: string;
	subjectUserId?: { toString(): string } | null;
	requestType: string;
	status: string;
	scope?: string | null;
	notes?: string | null;
	legalHold?: boolean;
	dueAt?: Date | null;
	completedAt?: Date | null;
	universityId?: { toString(): string } | null;
	createdAt: Date;
	updatedAt: Date;
}): DeletionRequestRecord {
	return {
		id: doc._id.toString(),
		subjectName: doc.subjectName,
		subjectEmail: doc.subjectEmail,
		subjectUserId: doc.subjectUserId?.toString() ?? null,
		requestType: doc.requestType as DeletionRequestType,
		status: doc.status as DeletionRequestStatus,
		scope: doc.scope ?? "",
		notes: doc.notes ?? "",
		legalHold: Boolean(doc.legalHold),
		dueAt: doc.dueAt?.toISOString() ?? null,
		completedAt: doc.completedAt?.toISOString() ?? null,
		universityId: doc.universityId?.toString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Normalize sparse legacy retention docs and backfill universityId from createdBy. */
export async function normalizeRetentionDefaults() {
	await Promise.all([
		RetentionPolicyModel.updateMany(
			{ enabled: { $exists: false } },
			{ $set: { enabled: true } },
		),
		RetentionPolicyModel.updateMany(
			{ legalHold: { $exists: false } },
			{ $set: { legalHold: false } },
		),
		DeletionRequestModel.updateMany(
			{ legalHold: { $exists: false } },
			{ $set: { legalHold: false } },
		),
	]);

	await Promise.all([
		backfillUniversityIdFromUserRef(RetentionPolicyModel, "createdBy"),
		backfillUniversityIdFromUserRef(DeletionRequestModel, "createdBy"),
	]);
}

export async function listRetentionPolicies(scope?: AdminScope) {
	const rows = await RetentionPolicyModel.find(scopeFilter(scope))
		.sort({ dataCategory: 1, createdAt: -1 })
		.lean();
	return rows.map(toPolicyRecord);
}

export async function createRetentionPolicy(
	input: {
		name: string;
		description?: string;
		dataCategory: RetentionDataCategory;
		retainDays: number;
		archiveDays?: number;
		actionOnExpiry?: RetentionExpiryAction;
		legalHold?: boolean;
		enabled?: boolean;
		regulatoryBasis?: string;
		universityId?: string;
	},
	actorId?: string,
	scope?: AdminScope,
) {
	const universityId = await resolveUniversityIdForWrite(
		scope,
		actorId,
		input.universityId,
	);

	const doc = await RetentionPolicyModel.create({
		name: input.name.trim(),
		description: input.description?.trim() ?? "",
		dataCategory: input.dataCategory,
		retainDays: input.retainDays,
		archiveDays: input.archiveDays ?? 0,
		actionOnExpiry: input.actionOnExpiry ?? "archive",
		legalHold: Boolean(input.legalHold),
		enabled: input.enabled ?? true,
		regulatoryBasis: input.regulatoryBasis?.trim() ?? "",
		universityId: universityObjectId(universityId),
		createdBy: actorId,
		updatedBy: actorId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "retention.created",
			category: "data",
			actorId,
			summary: `Created retention policy “${doc.name}” (${doc.retainDays} days)`,
			targetType: "retention_policy",
			targetId: doc._id.toString(),
			details: { dataCategory: doc.dataCategory, actionOnExpiry: doc.actionOnExpiry },
		});
	}

	return toPolicyRecord(doc.toObject());
}

export async function updateRetentionPolicy(
	id: string,
	input: Partial<{
		name: string;
		description: string;
		dataCategory: RetentionDataCategory;
		retainDays: number;
		archiveDays: number;
		actionOnExpiry: RetentionExpiryAction;
		legalHold: boolean;
		enabled: boolean;
		regulatoryBasis: string;
	}>,
	actorId?: string,
	scope?: AdminScope,
) {
	const existing = await assertDocInScope(RetentionPolicyModel, id, scope);
	if (!existing) return null;

	const doc = await RetentionPolicyModel.findByIdAndUpdate(
		id,
		{
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
			...(input.description !== undefined ? { description: input.description.trim() } : {}),
			...(input.dataCategory !== undefined ? { dataCategory: input.dataCategory } : {}),
			...(input.retainDays !== undefined ? { retainDays: input.retainDays } : {}),
			...(input.archiveDays !== undefined ? { archiveDays: input.archiveDays } : {}),
			...(input.actionOnExpiry !== undefined ? { actionOnExpiry: input.actionOnExpiry } : {}),
			...(input.legalHold !== undefined ? { legalHold: input.legalHold } : {}),
			...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
			...(input.regulatoryBasis !== undefined
				? { regulatoryBasis: input.regulatoryBasis.trim() }
				: {}),
			...(actorId ? { updatedBy: actorId } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId) {
		await recordAuditEvent({
			action: "retention.updated",
			category: "data",
			actorId,
			summary: `Updated retention policy “${doc.name}”`,
			targetType: "retention_policy",
			targetId: id,
		});
	}

	return toPolicyRecord(doc);
}

export async function deleteRetentionPolicy(
	id: string,
	actorId?: string,
	scope?: AdminScope,
) {
	const existing = await assertDocInScope(RetentionPolicyModel, id, scope);
	if (!existing) return false;

	const doc = await RetentionPolicyModel.findByIdAndDelete(id).lean();
	if (!doc) return false;
	if (actorId) {
		await recordAuditEvent({
			action: "retention.deleted",
			category: "data",
			actorId,
			summary: `Deleted retention policy “${doc.name}”`,
			targetType: "retention_policy",
			targetId: id,
			severity: "medium",
		});
	}
	return true;
}

export async function listDeletionRequests(
	options: { status?: string; limit?: number } = {},
	scope?: AdminScope,
) {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	if (options.status) filter.status = options.status;
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
	const rows = await DeletionRequestModel.find(filter)
		.sort({ createdAt: -1 })
		.limit(limit)
		.lean();
	return rows.map(toDeletionRecord);
}

export async function createDeletionRequest(
	input: {
		subjectName: string;
		subjectEmail: string;
		subjectUserId?: string;
		requestType?: DeletionRequestType;
		scope?: string;
		notes?: string;
		legalHold?: boolean;
		dueAt?: string;
		universityId?: string;
	},
	actorId?: string,
	adminScope?: AdminScope,
) {
	const universityId = await resolveUniversityIdForWrite(
		adminScope,
		actorId,
		input.universityId,
	);

	const doc = await DeletionRequestModel.create({
		subjectName: input.subjectName.trim(),
		subjectEmail: input.subjectEmail.trim().toLowerCase(),
		subjectUserId: input.subjectUserId,
		requestType: input.requestType ?? "erase",
		status: "received",
		scope: input.scope?.trim() ?? "",
		notes: input.notes?.trim() ?? "",
		legalHold: Boolean(input.legalHold),
		dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
		universityId: universityObjectId(universityId),
		createdBy: actorId,
		updatedBy: actorId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "deletion_request.received",
			category: "data",
			actorId,
			summary: `Deletion/export request for ${doc.subjectEmail} (${doc.requestType})`,
			targetType: "deletion_request",
			targetId: doc._id.toString(),
			severity: "medium",
		});
	}

	return toDeletionRecord(doc.toObject());
}

export async function updateDeletionRequest(
	id: string,
	input: Partial<{
		status: DeletionRequestStatus;
		notes: string;
		legalHold: boolean;
		scope: string;
	}>,
	actorId?: string,
	adminScope?: AdminScope,
) {
	const existing = await assertDocInScope(DeletionRequestModel, id, adminScope);
	if (!existing) return null;

	const closing =
		input.status === "completed" ? { completedAt: new Date() } : {};

	const doc = await DeletionRequestModel.findByIdAndUpdate(
		id,
		{
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
			...(input.legalHold !== undefined ? { legalHold: input.legalHold } : {}),
			...(input.scope !== undefined ? { scope: input.scope.trim() } : {}),
			...closing,
			...(actorId ? { updatedBy: actorId } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId && input.status) {
		await recordAuditEvent({
			action: `deletion_request.${input.status}`,
			category: "data",
			actorId,
			summary: `Deletion request for ${doc.subjectEmail} → ${input.status}`,
			targetType: "deletion_request",
			targetId: id,
			severity: input.status === "completed" ? "high" : "medium",
			flagged: input.status === "completed" && doc.requestType === "erase",
			flagReason:
				input.status === "completed" && doc.requestType === "erase"
					? "User data erasure completed"
					: undefined,
		});
	}

	return toDeletionRecord(doc);
}

export async function getRetentionStats(scope?: AdminScope) {
	const base = scopeFilter(scope);
	const [policies, enabled, legalHolds, deletionTotal, deletionOpen, deletionCompleted] =
		await Promise.all([
			RetentionPolicyModel.countDocuments(base),
			RetentionPolicyModel.countDocuments({ ...base, enabled: true }),
			RetentionPolicyModel.countDocuments({ ...base, legalHold: true }),
			DeletionRequestModel.countDocuments(base),
			DeletionRequestModel.countDocuments({
				...base,
				status: { $in: ["received", "under_review", "approved", "on_hold"] },
			}),
			DeletionRequestModel.countDocuments({ ...base, status: "completed" }),
		]);
	return {
		policies,
		enabled,
		legalHolds,
		deletionTotal,
		deletionOpen,
		deletionCompleted,
	};
}
