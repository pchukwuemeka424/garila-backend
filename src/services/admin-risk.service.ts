import { GovernanceRiskModel } from "../db/models/GovernanceRisk.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import type { AdminScope } from "../lib/require-admin.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type RiskCategory =
	| "data_protection"
	| "academic_integrity"
	| "model_safety"
	| "access_control"
	| "third_party"
	| "operational"
	| "legal"
	| "reputational";

export type RiskStatus = "open" | "mitigating" | "accepted" | "closed";

export type GovernanceRiskRecord = {
	id: string;
	title: string;
	description: string;
	category: RiskCategory;
	status: RiskStatus;
	likelihood: number;
	impact: number;
	inherentScore: number;
	residualLikelihood: number | null;
	residualImpact: number | null;
	residualScore: number | null;
	faculty: string | null;
	department: string | null;
	ownerName: string;
	controls: string;
	treatmentPlan: string;
	linkedSystemId: string | null;
	reviewDueAt: string | null;
	createdAt: string;
	updatedAt: string;
};

function scoreBand(score: number): "low" | "medium" | "high" | "critical" {
	if (score >= 20) return "critical";
	if (score >= 12) return "high";
	if (score >= 6) return "medium";
	return "low";
}

function toRecord(doc: {
	_id: { toString(): string };
	title: string;
	description?: string | null;
	category: string;
	status: string;
	likelihood: number;
	impact: number;
	inherentScore: number;
	residualLikelihood?: number | null;
	residualImpact?: number | null;
	residualScore?: number | null;
	faculty?: string | null;
	department?: string | null;
	ownerName?: string | null;
	controls?: string | null;
	treatmentPlan?: string | null;
	linkedSystemId?: string | null;
	reviewDueAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}): GovernanceRiskRecord {
	return {
		id: doc._id.toString(),
		title: doc.title,
		description: doc.description ?? "",
		category: doc.category as RiskCategory,
		status: doc.status as RiskStatus,
		likelihood: doc.likelihood,
		impact: doc.impact,
		inherentScore: doc.inherentScore,
		residualLikelihood: doc.residualLikelihood ?? null,
		residualImpact: doc.residualImpact ?? null,
		residualScore: doc.residualScore ?? null,
		faculty: doc.faculty ?? null,
		department: doc.department ?? null,
		ownerName: doc.ownerName ?? "",
		controls: doc.controls ?? "",
		treatmentPlan: doc.treatmentPlan ?? "",
		linkedSystemId: doc.linkedSystemId ?? null,
		reviewDueAt: doc.reviewDueAt?.toISOString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Kept for startup compatibility — does not seed mock risks. */
export async function ensureDefaultRisks(): Promise<void> {
	/* risks are registered by admins from real institutional assessments */
}

/** Backfill universityId from createdBy for legacy risk records. */
export async function normalizeRiskDefaults() {
	await backfillUniversityIdFromUserRef(GovernanceRiskModel, "createdBy");
}

export async function listRisks(
	options: { status?: string; category?: string } = {},
	scope?: AdminScope,
) {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	if (options.status) filter.status = options.status;
	if (options.category) filter.category = options.category;
	const rows = await GovernanceRiskModel.find(filter).sort({ inherentScore: -1, updatedAt: -1 }).lean();
	return rows.map(toRecord);
}

export async function createRisk(
	input: {
		title: string;
		description?: string;
		category: RiskCategory;
		status?: RiskStatus;
		likelihood: number;
		impact: number;
		residualLikelihood?: number;
		residualImpact?: number;
		faculty?: string;
		department?: string;
		ownerName?: string;
		controls?: string;
		treatmentPlan?: string;
		linkedSystemId?: string;
		reviewDueAt?: string;
		universityId?: string;
	},
	actorId?: string,
	scope?: AdminScope,
) {
	const likelihood = clampScore(input.likelihood);
	const impact = clampScore(input.impact);
	const residualLikelihood = input.residualLikelihood != null ? clampScore(input.residualLikelihood) : null;
	const residualImpact = input.residualImpact != null ? clampScore(input.residualImpact) : null;
	const universityId = await resolveUniversityIdForWrite(scope, actorId, input.universityId);

	const doc = await GovernanceRiskModel.create({
		title: input.title.trim(),
		description: input.description?.trim() ?? "",
		category: input.category,
		status: input.status ?? "open",
		likelihood,
		impact,
		inherentScore: likelihood * impact,
		residualLikelihood: residualLikelihood ?? undefined,
		residualImpact: residualImpact ?? undefined,
		residualScore:
			residualLikelihood != null && residualImpact != null
				? residualLikelihood * residualImpact
				: undefined,
		faculty: input.faculty?.trim(),
		department: input.department?.trim(),
		ownerName: input.ownerName?.trim() ?? "",
		controls: input.controls?.trim() ?? "",
		treatmentPlan: input.treatmentPlan?.trim() ?? "",
		linkedSystemId: input.linkedSystemId,
		reviewDueAt: input.reviewDueAt ? new Date(input.reviewDueAt) : undefined,
		universityId: universityObjectId(universityId),
		createdBy: actorId,
		updatedBy: actorId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "risk.created",
			category: "security",
			actorId,
			summary: `Registered risk “${doc.title}” (score ${doc.inherentScore})`,
			targetType: "governance_risk",
			targetId: doc._id.toString(),
			severity: scoreBand(doc.inherentScore) === "critical" || scoreBand(doc.inherentScore) === "high" ? "high" : "info",
			flagged: doc.inherentScore >= 15,
			flagReason: doc.inherentScore >= 15 ? "High inherent risk registered" : undefined,
		});
	}

	return toRecord(doc.toObject());
}

export async function updateRisk(
	id: string,
	input: Partial<{
		title: string;
		description: string;
		category: RiskCategory;
		status: RiskStatus;
		likelihood: number;
		impact: number;
		residualLikelihood: number;
		residualImpact: number;
		faculty: string;
		department: string;
		ownerName: string;
		controls: string;
		treatmentPlan: string;
		linkedSystemId: string;
		reviewDueAt: string | null;
	}>,
	actorId?: string,
	scope?: AdminScope,
) {
	const existing = await assertDocInScope(GovernanceRiskModel, id, scope);
	if (!existing) return null;

	const likelihood = input.likelihood != null ? clampScore(input.likelihood) : existing.likelihood;
	const impact = input.impact != null ? clampScore(input.impact) : existing.impact;
	const residualLikelihood =
		input.residualLikelihood != null
			? clampScore(input.residualLikelihood)
			: (existing.residualLikelihood ?? null);
	const residualImpact =
		input.residualImpact != null ? clampScore(input.residualImpact) : (existing.residualImpact ?? null);

	const doc = await GovernanceRiskModel.findByIdAndUpdate(
		id,
		{
			...(input.title !== undefined ? { title: input.title.trim() } : {}),
			...(input.description !== undefined ? { description: input.description.trim() } : {}),
			...(input.category !== undefined ? { category: input.category } : {}),
			...(input.status !== undefined ? { status: input.status } : {}),
			likelihood,
			impact,
			inherentScore: likelihood * impact,
			residualLikelihood: residualLikelihood ?? undefined,
			residualImpact: residualImpact ?? undefined,
			residualScore:
				residualLikelihood != null && residualImpact != null
					? residualLikelihood * residualImpact
					: undefined,
			...(input.faculty !== undefined ? { faculty: input.faculty.trim() } : {}),
			...(input.department !== undefined ? { department: input.department.trim() } : {}),
			...(input.ownerName !== undefined ? { ownerName: input.ownerName.trim() } : {}),
			...(input.controls !== undefined ? { controls: input.controls.trim() } : {}),
			...(input.treatmentPlan !== undefined ? { treatmentPlan: input.treatmentPlan.trim() } : {}),
			...(input.linkedSystemId !== undefined ? { linkedSystemId: input.linkedSystemId } : {}),
			...(input.reviewDueAt !== undefined
				? { reviewDueAt: input.reviewDueAt ? new Date(input.reviewDueAt) : null }
				: {}),
			...(actorId ? { updatedBy: actorId } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId) {
		await recordAuditEvent({
			action: "risk.updated",
			category: "security",
			actorId,
			summary: `Updated risk “${doc.title}” → ${doc.status}`,
			targetType: "governance_risk",
			targetId: id,
			details: input,
		});
	}

	return toRecord(doc);
}

export async function deleteRisk(id: string, actorId?: string, scope?: AdminScope): Promise<boolean> {
	const existing = await assertDocInScope(GovernanceRiskModel, id, scope);
	if (!existing) return false;

	const doc = await GovernanceRiskModel.findByIdAndDelete(id).lean();
	if (!doc) return false;
	if (actorId) {
		await recordAuditEvent({
			action: "risk.deleted",
			category: "security",
			actorId,
			summary: `Deleted risk “${doc.title}”`,
			targetType: "governance_risk",
			targetId: id,
			severity: "medium",
		});
	}
	return true;
}

export async function getRiskStats(scope?: AdminScope) {
	const rows = await GovernanceRiskModel.find(scopeFilter(scope))
		.select("status inherentScore residualScore")
		.lean();
	let open = 0;
	let mitigating = 0;
	let accepted = 0;
	let closed = 0;
	let highInherent = 0;
	let highResidual = 0;
	let inherentTotal = 0;
	let residualTotal = 0;
	let residualCount = 0;

	for (const row of rows) {
		if (row.status === "open") open++;
		else if (row.status === "mitigating") mitigating++;
		else if (row.status === "accepted") accepted++;
		else if (row.status === "closed") closed++;
		inherentTotal += row.inherentScore;
		if (row.inherentScore >= 12) highInherent++;
		if (row.residualScore != null) {
			residualTotal += row.residualScore;
			residualCount++;
			if (row.residualScore >= 12) highResidual++;
		}
	}

	return {
		total: rows.length,
		open,
		mitigating,
		accepted,
		closed,
		highInherent,
		highResidual,
		avgInherent: rows.length ? Math.round((inherentTotal / rows.length) * 10) / 10 : 0,
		avgResidual: residualCount ? Math.round((residualTotal / residualCount) * 10) / 10 : 0,
	};
}

function clampScore(n: number): number {
	return Math.min(5, Math.max(1, Math.round(n)));
}

export { scoreBand };
