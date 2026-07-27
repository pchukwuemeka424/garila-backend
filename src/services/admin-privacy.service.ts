import { ResearchPrivacySettingModel } from "../db/models/ResearchPrivacySetting.js";
import type { AdminScope } from "../lib/require-admin.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type PrivacyDataClass =
	| "public"
	| "internal"
	| "confidential"
	| "restricted"
	| "special_category";

export type PrivacyScope = "global" | "faculty" | "role" | "feature";
export type AdminRawAccess = "never" | "policy_authorised" | "incident_only" | "always";

export type ResearchPrivacySettingRecord = {
	id: string;
	name: string;
	description: string;
	dataClass: PrivacyDataClass;
	scope: PrivacyScope;
	faculties: string[];
	roles: string[];
	features: string[];
	adminRawAccess: AdminRawAccess;
	allowGovernanceMetadata: boolean;
	allowProvenanceReview: boolean;
	redactPiiInLogs: boolean;
	requireExplicitAuthorisation: boolean;
	enabled: boolean;
	priority: number;
	universityId: string | null;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	name: string;
	description?: string | null;
	dataClass: string;
	scope: string;
	faculties?: string[];
	roles?: string[];
	features?: string[];
	adminRawAccess?: string;
	allowGovernanceMetadata?: boolean;
	allowProvenanceReview?: boolean;
	redactPiiInLogs?: boolean;
	requireExplicitAuthorisation?: boolean;
	enabled?: boolean;
	priority?: number;
	universityId?: { toString(): string } | null;
	createdAt: Date;
	updatedAt: Date;
}): ResearchPrivacySettingRecord {
	return {
		id: doc._id.toString(),
		name: doc.name,
		description: doc.description ?? "",
		dataClass: (doc.dataClass as PrivacyDataClass) || "internal",
		scope: (doc.scope as PrivacyScope) || "global",
		faculties: doc.faculties ?? [],
		roles: doc.roles ?? [],
		features: doc.features ?? [],
		adminRawAccess: (doc.adminRawAccess as AdminRawAccess) ?? "never",
		allowGovernanceMetadata: doc.allowGovernanceMetadata !== false,
		allowProvenanceReview: doc.allowProvenanceReview !== false,
		redactPiiInLogs: doc.redactPiiInLogs !== false,
		requireExplicitAuthorisation: doc.requireExplicitAuthorisation !== false,
		enabled: doc.enabled !== false,
		priority: doc.priority ?? 100,
		universityId: doc.universityId?.toString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Normalize sparse legacy privacy settings and backfill universityId from createdBy. */
export async function normalizePrivacyDefaults() {
	await Promise.all([
		ResearchPrivacySettingModel.updateMany(
			{ allowGovernanceMetadata: { $exists: false } },
			{ $set: { allowGovernanceMetadata: true } },
		),
		ResearchPrivacySettingModel.updateMany(
			{ allowProvenanceReview: { $exists: false } },
			{ $set: { allowProvenanceReview: true } },
		),
		ResearchPrivacySettingModel.updateMany(
			{ redactPiiInLogs: { $exists: false } },
			{ $set: { redactPiiInLogs: true } },
		),
		ResearchPrivacySettingModel.updateMany(
			{ requireExplicitAuthorisation: { $exists: false } },
			{ $set: { requireExplicitAuthorisation: true } },
		),
		ResearchPrivacySettingModel.updateMany(
			{ enabled: { $exists: false } },
			{ $set: { enabled: true } },
		),
	]);

	await backfillUniversityIdFromUserRef(ResearchPrivacySettingModel, "createdBy");
}

export async function listPrivacySettings(scope?: AdminScope) {
	const rows = await ResearchPrivacySettingModel.find(scopeFilter(scope))
		.sort({ priority: 1, createdAt: -1 })
		.lean();
	return rows.map(toRecord);
}

export async function createPrivacySetting(
	input: {
		name: string;
		description?: string;
		dataClass: PrivacyDataClass;
		scope?: PrivacyScope;
		faculties?: string[];
		roles?: string[];
		features?: string[];
		adminRawAccess?: AdminRawAccess;
		allowGovernanceMetadata?: boolean;
		allowProvenanceReview?: boolean;
		redactPiiInLogs?: boolean;
		requireExplicitAuthorisation?: boolean;
		enabled?: boolean;
		priority?: number;
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

	const doc = await ResearchPrivacySettingModel.create({
		name: input.name.trim(),
		description: input.description?.trim() ?? "",
		dataClass: input.dataClass,
		scope: input.scope ?? "global",
		faculties: input.faculties ?? [],
		roles: input.roles ?? [],
		features: input.features ?? [],
		adminRawAccess: input.adminRawAccess ?? "never",
		allowGovernanceMetadata: input.allowGovernanceMetadata ?? true,
		allowProvenanceReview: input.allowProvenanceReview ?? true,
		redactPiiInLogs: input.redactPiiInLogs ?? true,
		requireExplicitAuthorisation: input.requireExplicitAuthorisation ?? true,
		enabled: input.enabled ?? true,
		priority: input.priority ?? 100,
		universityId: universityObjectId(universityId),
		createdBy: actorId,
		updatedBy: actorId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "privacy.created",
			category: "data",
			actorId,
			summary: `Created research privacy rule “${doc.name}”`,
			targetType: "research_privacy_setting",
			targetId: doc._id.toString(),
			details: { dataClass: doc.dataClass, adminRawAccess: doc.adminRawAccess },
		});
	}

	return toRecord(doc.toObject());
}

export async function updatePrivacySetting(
	id: string,
	input: Partial<{
		name: string;
		description: string;
		dataClass: PrivacyDataClass;
		scope: PrivacyScope;
		faculties: string[];
		roles: string[];
		features: string[];
		adminRawAccess: AdminRawAccess;
		allowGovernanceMetadata: boolean;
		allowProvenanceReview: boolean;
		redactPiiInLogs: boolean;
		requireExplicitAuthorisation: boolean;
		enabled: boolean;
		priority: number;
	}>,
	actorId?: string,
	adminScope?: AdminScope,
) {
	const existing = await assertDocInScope(ResearchPrivacySettingModel, id, adminScope);
	if (!existing) return null;

	const doc = await ResearchPrivacySettingModel.findByIdAndUpdate(
		id,
		{
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
			...(input.description !== undefined ? { description: input.description.trim() } : {}),
			...(input.dataClass !== undefined ? { dataClass: input.dataClass } : {}),
			...(input.scope !== undefined ? { scope: input.scope } : {}),
			...(input.faculties !== undefined ? { faculties: input.faculties } : {}),
			...(input.roles !== undefined ? { roles: input.roles } : {}),
			...(input.features !== undefined ? { features: input.features } : {}),
			...(input.adminRawAccess !== undefined ? { adminRawAccess: input.adminRawAccess } : {}),
			...(input.allowGovernanceMetadata !== undefined
				? { allowGovernanceMetadata: input.allowGovernanceMetadata }
				: {}),
			...(input.allowProvenanceReview !== undefined
				? { allowProvenanceReview: input.allowProvenanceReview }
				: {}),
			...(input.redactPiiInLogs !== undefined ? { redactPiiInLogs: input.redactPiiInLogs } : {}),
			...(input.requireExplicitAuthorisation !== undefined
				? { requireExplicitAuthorisation: input.requireExplicitAuthorisation }
				: {}),
			...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...(actorId ? { updatedBy: actorId } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId) {
		await recordAuditEvent({
			action: "privacy.updated",
			category: "data",
			actorId,
			summary: `Updated research privacy rule “${doc.name}”`,
			targetType: "research_privacy_setting",
			targetId: id,
		});
	}

	return toRecord(doc);
}

export async function deletePrivacySetting(
	id: string,
	actorId?: string,
	adminScope?: AdminScope,
) {
	const existing = await assertDocInScope(ResearchPrivacySettingModel, id, adminScope);
	if (!existing) return false;

	const doc = await ResearchPrivacySettingModel.findByIdAndDelete(id).lean();
	if (!doc) return false;
	if (actorId) {
		await recordAuditEvent({
			action: "privacy.deleted",
			category: "data",
			actorId,
			summary: `Deleted research privacy rule “${doc.name}”`,
			targetType: "research_privacy_setting",
			targetId: id,
			severity: "medium",
		});
	}
	return true;
}

export async function getPrivacyStats(scope?: AdminScope) {
	const base = scopeFilter(scope);
	const [total, enabled, neverRaw, restricted, special] = await Promise.all([
		ResearchPrivacySettingModel.countDocuments(base),
		ResearchPrivacySettingModel.countDocuments({ ...base, enabled: true }),
		ResearchPrivacySettingModel.countDocuments({
			...base,
			adminRawAccess: "never",
			enabled: true,
		}),
		ResearchPrivacySettingModel.countDocuments({
			...base,
			dataClass: "restricted",
			enabled: true,
		}),
		ResearchPrivacySettingModel.countDocuments({
			...base,
			dataClass: "special_category",
			enabled: true,
		}),
	]);
	return { total, enabled, neverRaw, restricted, special, disabled: total - enabled };
}
