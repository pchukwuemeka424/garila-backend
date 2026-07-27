import { ComplianceControlModel } from "../db/models/ComplianceControl.js";
import {
	assertDocInScope,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import type { AdminScope } from "../lib/require-admin.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type ComplianceFramework =
	| "nigeria_ai_act"
	| "eu_ai_act"
	| "ndpr"
	| "institutional"
	| "iso_42001"
	| "unesco";

export type ComplianceDomain =
	| "transparency"
	| "human_oversight"
	| "data_governance"
	| "accuracy_robustness"
	| "privacy"
	| "accountability"
	| "fairness"
	| "security";

export type ComplianceStatus = "not_started" | "in_progress" | "compliant" | "gap" | "not_applicable";

export type ComplianceControlRecord = {
	id: string;
	code: string;
	title: string;
	description: string;
	framework: ComplianceFramework;
	domain: ComplianceDomain;
	status: ComplianceStatus;
	evidence: string;
	ownerName: string;
	priority: string;
	lastAssessedAt: string | null;
	nextReviewAt: string | null;
	notes: string;
	createdAt: string;
	updatedAt: string;
};

export const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
	nigeria_ai_act: "Nigeria AI Act",
	eu_ai_act: "EU AI Act",
	ndpr: "NDPA / NDPR",
	institutional: "Institutional",
	iso_42001: "ISO 42001",
	unesco: "UNESCO",
};

/** Known previously seeded control codes — removed on cleanup. */
export const SEEDED_COMPLIANCE_CODES = [
	"NG-AI-01",
	"NG-AI-02",
	"NG-AI-03",
	"NG-AI-04",
	"NG-AI-05",
	"NG-AI-06",
	"NG-AI-07",
	"NG-AI-08",
	"NG-AI-09",
	"NG-AI-10",
	"EAA-01",
	"EAA-02",
	"EAA-03",
	"NDPR-01",
	"NDPR-02",
	"INST-01",
	"INST-02",
	"INST-03",
	"ISO-01",
	"UNESCO-01",
] as const;

function toRecord(doc: {
	_id: { toString(): string };
	code: string;
	title: string;
	description?: string | null;
	framework: string;
	domain: string;
	status: string;
	evidence?: string | null;
	ownerName?: string | null;
	priority?: string | null;
	lastAssessedAt?: Date | null;
	nextReviewAt?: Date | null;
	notes?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): ComplianceControlRecord {
	return {
		id: doc._id.toString(),
		code: doc.code,
		title: doc.title,
		description: doc.description ?? "",
		framework: doc.framework as ComplianceFramework,
		domain: doc.domain as ComplianceDomain,
		status: doc.status as ComplianceStatus,
		evidence: doc.evidence ?? "",
		ownerName: doc.ownerName ?? "",
		priority: doc.priority ?? "medium",
		lastAssessedAt: doc.lastAssessedAt?.toISOString() ?? null,
		nextReviewAt: doc.nextReviewAt?.toISOString() ?? null,
		notes: doc.notes ?? "",
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** No longer seeds controls — kept as no-op for older call sites. */
export async function ensureDefaultComplianceControls(): Promise<void> {
	/* compliance controls are created by admins from real assessments */
}

/** No user-ref field suitable for backfill; kept for startup compatibility. */
export async function normalizeComplianceDefaults(): Promise<void> {
	/* ComplianceControl only has updatedBy — skip university backfill */
}

export async function listComplianceControls(
	options: {
		framework?: string;
		status?: string;
	} = {},
	scope?: AdminScope,
) {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	if (options.framework) filter.framework = options.framework;
	if (options.status) filter.status = options.status;
	const rows = await ComplianceControlModel.find(filter).sort({ framework: 1, code: 1 }).lean();
	return rows.map(toRecord);
}

export async function createComplianceControl(
	input: {
		code: string;
		title: string;
		description?: string;
		framework: ComplianceFramework;
		domain: ComplianceDomain;
		priority?: string;
		status?: ComplianceStatus;
		ownerName?: string;
		evidence?: string;
		notes?: string;
		universityId?: string;
	},
	actorId?: string,
	scope?: AdminScope,
): Promise<ComplianceControlRecord> {
	const code = input.code.trim().toUpperCase();
	if (!code || !input.title.trim()) {
		throw new Error("code and title are required.");
	}

	const universityId = await resolveUniversityIdForWrite(scope, actorId, input.universityId);

	const existing = await ComplianceControlModel.findOne({
		framework: input.framework,
		code,
		...(universityId
			? { universityId: universityObjectId(universityId) }
			: { $or: [{ universityId: { $exists: false } }, { universityId: null }] }),
	}).lean();
	if (existing) {
		throw new Error(`Control ${code} already exists for this framework.`);
	}

	const doc = await ComplianceControlModel.create({
		code,
		title: input.title.trim(),
		description: input.description?.trim() ?? "",
		framework: input.framework,
		domain: input.domain,
		priority: input.priority ?? "medium",
		status: input.status ?? "not_started",
		ownerName: input.ownerName?.trim() ?? "",
		evidence: input.evidence?.trim() ?? "",
		notes: input.notes?.trim() ?? "",
		universityId: universityObjectId(universityId),
		updatedBy: actorId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "compliance.created",
			category: "policy",
			actorId,
			summary: `Created compliance control ${doc.code}`,
			targetType: "compliance_control",
			targetId: doc._id.toString(),
			details: { framework: doc.framework, code: doc.code },
		});
	}

	return toRecord(doc.toObject());
}

export async function updateComplianceControl(
	id: string,
	input: Partial<{
		status: ComplianceStatus;
		evidence: string;
		ownerName: string;
		priority: string;
		notes: string;
		title: string;
		description: string;
		nextReviewAt: string | null;
	}>,
	actorId?: string,
	scope?: AdminScope,
) {
	const existing = await assertDocInScope(ComplianceControlModel, id, scope);
	if (!existing) return null;

	const doc = await ComplianceControlModel.findByIdAndUpdate(
		id,
		{
			...(input.status !== undefined ? { status: input.status, lastAssessedAt: new Date() } : {}),
			...(input.evidence !== undefined ? { evidence: input.evidence.trim() } : {}),
			...(input.ownerName !== undefined ? { ownerName: input.ownerName.trim() } : {}),
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
			...(input.title !== undefined ? { title: input.title.trim() } : {}),
			...(input.description !== undefined ? { description: input.description.trim() } : {}),
			...(input.nextReviewAt !== undefined
				? { nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null }
				: {}),
			...(actorId ? { updatedBy: actorId } : {}),
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId) {
		await recordAuditEvent({
			action: "compliance.updated",
			category: "policy",
			actorId,
			summary: `Compliance ${doc.code} → ${doc.status}`,
			targetType: "compliance_control",
			targetId: id,
			details: input,
			severity: doc.status === "gap" ? "high" : "info",
			flagged: doc.status === "gap",
			flagReason: doc.status === "gap" ? `Compliance gap: ${doc.code}` : undefined,
		});
	}

	return toRecord(doc);
}

export async function deleteComplianceControl(
	id: string,
	actorId?: string,
	scope?: AdminScope,
): Promise<boolean> {
	const existing = await assertDocInScope(ComplianceControlModel, id, scope);
	if (!existing) return false;

	const doc = await ComplianceControlModel.findByIdAndDelete(id).lean();
	if (!doc) return false;
	if (actorId) {
		await recordAuditEvent({
			action: "compliance.deleted",
			category: "policy",
			actorId,
			summary: `Deleted compliance control ${doc.code}`,
			targetType: "compliance_control",
			targetId: id,
			severity: "medium",
		});
	}
	return true;
}

export async function getComplianceStats(scope?: AdminScope) {
	const rows = await ComplianceControlModel.find(scopeFilter(scope))
		.select("framework status priority")
		.lean();
	const byFramework: Record<string, { total: number; compliant: number; gap: number }> = {};
	let compliant = 0;
	let gap = 0;
	let inProgress = 0;
	let notStarted = 0;
	let criticalGaps = 0;

	for (const row of rows) {
		const fw = row.framework;
		if (!byFramework[fw]) byFramework[fw] = { total: 0, compliant: 0, gap: 0 };
		byFramework[fw].total++;
		if (row.status === "compliant") {
			compliant++;
			byFramework[fw].compliant++;
		} else if (row.status === "gap") {
			gap++;
			byFramework[fw].gap++;
			if (row.priority === "critical" || row.priority === "high") criticalGaps++;
		} else if (row.status === "in_progress") inProgress++;
		else if (row.status === "not_started") notStarted++;
	}

	const assessed = compliant + gap + inProgress;
	const score = assessed > 0 ? Math.round((compliant / (compliant + gap + inProgress)) * 100) : 0;

	return {
		total: rows.length,
		compliant,
		gap,
		inProgress,
		notStarted,
		criticalGaps,
		score,
		byFramework,
	};
}
