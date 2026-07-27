import { GovernancePolicyModel } from "../db/models/GovernancePolicy.js";
import type { AdminScope } from "../lib/require-admin.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type PolicyEffect = "permitted" | "restricted" | "blocked";
export type PolicyScope = "feature" | "dataset" | "tool" | "use_case" | "content";

export type GovernancePolicyRecord = {
	id: string;
	name: string;
	description: string;
	scope: PolicyScope;
	target: string;
	effect: PolicyEffect;
	roles: string[];
	faculties: string[];
	enabled: boolean;
	priority: number;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	name: string;
	description?: string | null;
	scope: string;
	target: string;
	effect: string;
	roles?: string[] | null;
	faculties?: string[] | null;
	enabled?: boolean;
	priority?: number;
	createdAt: Date;
	updatedAt: Date;
}): GovernancePolicyRecord {
	return {
		id: doc._id.toString(),
		name: doc.name,
		description: doc.description ?? "",
		scope: doc.scope as PolicyScope,
		target: doc.target,
		effect: doc.effect as PolicyEffect,
		roles: doc.roles ?? [],
		faculties: doc.faculties ?? [],
		enabled: doc.enabled !== false,
		priority: doc.priority ?? 100,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Kept for server startup compatibility — no longer seeds mock policies. */
export async function ensureDefaultPolicies(): Promise<void> {
	/* policies are created by admins from real institutional rules */
}

/** Backfill universityId on legacy policies from createdBy. */
export async function normalizePolicyDefaults() {
	await backfillUniversityIdFromUserRef(GovernancePolicyModel as never, "createdBy");
}

export async function listPolicies(scope?: AdminScope): Promise<GovernancePolicyRecord[]> {
	const rows = await GovernancePolicyModel.find({ ...scopeFilter(scope) })
		.sort({ priority: 1, name: 1 })
		.lean();
	return rows.map(toRecord);
}

export async function createPolicy(
	input: {
		name: string;
		description?: string;
		scope: PolicyScope;
		target: string;
		effect: PolicyEffect;
		roles?: string[];
		faculties?: string[];
		enabled?: boolean;
		priority?: number;
	},
	actorId?: string,
	scope?: AdminScope,
): Promise<GovernancePolicyRecord> {
	const universityId = universityObjectId(
		await resolveUniversityIdForWrite(scope, actorId),
	);

	const doc = await GovernancePolicyModel.create({
		name: input.name.trim(),
		description: input.description?.trim() ?? "",
		scope: input.scope,
		target: input.target.trim(),
		effect: input.effect,
		roles: input.roles ?? [],
		faculties: input.faculties ?? [],
		enabled: input.enabled !== false,
		priority: input.priority ?? 100,
		createdBy: actorId,
		updatedBy: actorId,
		universityId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "policy.created",
			category: "policy",
			actorId,
			summary: `Created policy “${doc.name}” (${doc.effect})`,
			targetType: "policy",
			targetId: doc._id.toString(),
			details: { effect: doc.effect, scope: doc.scope, target: doc.target },
		});
	}

	return toRecord(doc.toObject());
}

export async function updatePolicy(
	id: string,
	input: Partial<{
		name: string;
		description: string;
		scope: PolicyScope;
		target: string;
		effect: PolicyEffect;
		roles: string[];
		faculties: string[];
		enabled: boolean;
		priority: number;
	}>,
	actorId?: string,
	scope?: AdminScope,
): Promise<GovernancePolicyRecord | null> {
	const existing = await assertDocInScope(GovernancePolicyModel, id, scope);
	if (!existing) return null;

	const doc = await GovernancePolicyModel.findByIdAndUpdate(
		id,
		{
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
			...(input.description !== undefined ? { description: input.description.trim() } : {}),
			...(input.scope !== undefined ? { scope: input.scope } : {}),
			...(input.target !== undefined ? { target: input.target.trim() } : {}),
			...(input.effect !== undefined ? { effect: input.effect } : {}),
			...(input.roles !== undefined ? { roles: input.roles } : {}),
			...(input.faculties !== undefined ? { faculties: input.faculties } : {}),
			...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...(actorId ? { updatedBy: actorId } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId) {
		await recordAuditEvent({
			action: "policy.updated",
			category: "policy",
			actorId,
			summary: `Updated policy “${doc.name}”`,
			targetType: "policy",
			targetId: id,
			details: input,
			severity: input.effect === "blocked" ? "medium" : "info",
		});
	}

	return toRecord(doc);
}

export async function deletePolicy(
	id: string,
	actorId?: string,
	scope?: AdminScope,
): Promise<boolean> {
	const existing = await assertDocInScope(GovernancePolicyModel, id, scope);
	if (!existing) return false;

	const doc = await GovernancePolicyModel.findByIdAndDelete(id).lean();
	if (!doc) return false;
	if (actorId) {
		await recordAuditEvent({
			action: "policy.deleted",
			category: "policy",
			actorId,
			summary: `Deleted policy “${doc.name}”`,
			targetType: "policy",
			targetId: id,
			severity: "medium",
		});
	}
	return true;
}

export type PolicyEvaluation = {
	effect: PolicyEffect;
	matchedPolicyId: string | null;
	matchedPolicyName: string | null;
	reason: string;
};

export async function evaluatePolicy(
	input: {
		scope: PolicyScope;
		target: string;
		role: string;
		faculty?: string | null;
	},
	adminScope?: AdminScope,
): Promise<PolicyEvaluation> {
	const policies = await GovernancePolicyModel.find({
		...scopeFilter(adminScope),
		enabled: true,
		scope: input.scope,
		target: input.target,
	})
		.sort({ priority: 1 })
		.lean();

	for (const policy of policies) {
		const roles = policy.roles ?? [];
		const faculties = policy.faculties ?? [];
		const roleOk = roles.length === 0 || roles.includes(input.role as never);
		const facultyOk =
			faculties.length === 0 ||
			(!input.faculty ? false : faculties.some((f) => f.toLowerCase() === input.faculty!.toLowerCase()));
		if (roleOk && (faculties.length === 0 || facultyOk)) {
			return {
				effect: policy.effect as PolicyEffect,
				matchedPolicyId: policy._id.toString(),
				matchedPolicyName: policy.name,
				reason: policy.description || `Matched policy “${policy.name}”.`,
			};
		}
	}

	return {
		effect: "permitted",
		matchedPolicyId: null,
		matchedPolicyName: null,
		reason: "No matching institutional policy; default permit.",
	};
}

export async function getPolicyStats(scope?: AdminScope) {
	const sf = scopeFilter(scope);
	const [total, permitted, restricted, blocked, disabled] = await Promise.all([
		GovernancePolicyModel.countDocuments(sf),
		GovernancePolicyModel.countDocuments({ ...sf, effect: "permitted", enabled: true }),
		GovernancePolicyModel.countDocuments({ ...sf, effect: "restricted", enabled: true }),
		GovernancePolicyModel.countDocuments({ ...sf, effect: "blocked", enabled: true }),
		GovernancePolicyModel.countDocuments({ ...sf, enabled: false }),
	]);
	return { total, permitted, restricted, blocked, disabled };
}
