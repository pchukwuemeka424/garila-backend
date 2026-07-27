import { GovernanceIncidentModel } from "../db/models/GovernanceIncident.js";
import type { AdminScope } from "../lib/require-admin.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import { recordAuditEvent } from "./admin-audit.service.js";

export type IncidentKind =
	| "policy_breach"
	| "sensitive_data"
	| "unauthorized_use"
	| "model_failure"
	| "third_party"
	| "academic_misconduct"
	| "other";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentStatus =
	| "new"
	| "assigned"
	| "under_investigation"
	| "waiting_for_response"
	| "resolved"
	| "closed";

/** Legacy statuses still present in older documents. */
type LegacyIncidentStatus = "open" | "investigating" | "contained";

const ACTIVE_STATUSES = [
	"new",
	"assigned",
	"under_investigation",
	"waiting_for_response",
	"open",
	"investigating",
	"contained",
] as const;

export function normalizeIncidentStatus(status: string): IncidentStatus {
	switch (status) {
		case "open":
			return "new";
		case "investigating":
			return "under_investigation";
		case "contained":
			return "waiting_for_response";
		case "new":
		case "assigned":
		case "under_investigation":
		case "waiting_for_response":
		case "resolved":
		case "closed":
			return status;
		default:
			return "new";
	}
}

function statusFilterValues(status?: string): string[] | null {
	if (!status) return null;
	const normalized = normalizeIncidentStatus(status);
	switch (normalized) {
		case "new":
			return ["new", "open"];
		case "under_investigation":
			return ["under_investigation", "investigating"];
		case "waiting_for_response":
			return ["waiting_for_response", "contained"];
		default:
			return [normalized];
	}
}

export type GovernanceIncidentRecord = {
	id: string;
	title: string;
	description: string;
	kind: IncidentKind;
	severity: IncidentSeverity;
	status: IncidentStatus;
	faculty: string | null;
	department: string | null;
	reportedByName: string;
	reportedByEmail: string;
	userInvolvedName: string;
	assigneeName: string;
	impactSummary: string;
	evidence: string[];
	containmentActions: string;
	rootCause: string;
	lessonsLearned: string;
	linkedAuditId: string | null;
	linkedSystemId: string | null;
	timeline: Array<{ at: string; actorName: string; action: string; note: string }>;
	detectedAt: string;
	resolvedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	title: string;
	description?: string | null;
	kind: string;
	severity: string;
	status: string;
	faculty?: string | null;
	department?: string | null;
	reportedByName?: string | null;
	reportedByEmail?: string | null;
	userInvolvedName?: string | null;
	assigneeName?: string | null;
	impactSummary?: string | null;
	evidence?: string[] | string | null;
	containmentActions?: string | null;
	rootCause?: string | null;
	lessonsLearned?: string | null;
	linkedAuditId?: string | null;
	linkedSystemId?: string | null;
	timeline?: Array<{ at?: Date; actorName?: string; action?: string; note?: string }>;
	detectedAt?: Date | null;
	resolvedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}): GovernanceIncidentRecord {
	const evidenceRaw = doc.evidence;
	const evidence = Array.isArray(evidenceRaw)
		? evidenceRaw.filter(Boolean)
		: typeof evidenceRaw === "string" && evidenceRaw.trim()
			? [evidenceRaw.trim()]
			: [];

	return {
		id: doc._id.toString(),
		title: doc.title,
		description: doc.description ?? "",
		kind: doc.kind as IncidentKind,
		severity: doc.severity as IncidentSeverity,
		status: normalizeIncidentStatus(doc.status),
		faculty: doc.faculty ?? null,
		department: doc.department ?? null,
		reportedByName: doc.reportedByName ?? "",
		reportedByEmail: doc.reportedByEmail ?? "",
		userInvolvedName: doc.userInvolvedName ?? "",
		assigneeName: doc.assigneeName ?? "",
		impactSummary: doc.impactSummary ?? "",
		evidence,
		containmentActions: doc.containmentActions ?? "",
		rootCause: doc.rootCause ?? "",
		lessonsLearned: doc.lessonsLearned ?? "",
		linkedAuditId: doc.linkedAuditId ?? null,
		linkedSystemId: doc.linkedSystemId ?? null,
		timeline: (doc.timeline ?? []).map((entry) => ({
			at: (entry.at ?? doc.createdAt).toISOString(),
			actorName: entry.actorName ?? "",
			action: entry.action ?? "",
			note: entry.note ?? "",
		})),
		detectedAt: (doc.detectedAt ?? doc.createdAt).toISOString(),
		resolvedAt: doc.resolvedAt?.toISOString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Backfill universityId on legacy incidents from createdBy. */
export async function normalizeIncidentDefaults() {
	await backfillUniversityIdFromUserRef(GovernanceIncidentModel as never, "createdBy");
}

export async function listIncidents(
	options: {
		status?: string;
		severity?: string;
		kind?: string;
		limit?: number;
	} = {},
	scope?: AdminScope,
) {
	const filter: Record<string, unknown> = {
		...scopeFilter(scope),
	};
	const statuses = statusFilterValues(options.status);
	if (statuses) filter.status = { $in: statuses };
	if (options.severity) filter.severity = options.severity;
	if (options.kind) filter.kind = options.kind;
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
	const rows = await GovernanceIncidentModel.find(filter)
		.sort({ createdAt: -1 })
		.limit(limit)
		.lean();
	return rows.map(toRecord);
}

export async function createIncident(
	input: {
		title: string;
		description?: string;
		kind: IncidentKind;
		severity?: IncidentSeverity;
		faculty?: string;
		department?: string;
		reportedByName?: string;
		reportedByEmail?: string;
		userInvolvedName?: string;
		assigneeName?: string;
		impactSummary?: string;
		evidence?: string | string[];
		linkedAuditId?: string;
		linkedSystemId?: string;
	},
	actorId?: string,
	scope?: AdminScope,
) {
	const evidence = Array.isArray(input.evidence)
		? input.evidence.map((e) => e.trim()).filter(Boolean)
		: input.evidence?.trim()
			? [input.evidence.trim()]
			: [];

	const universityId = universityObjectId(
		await resolveUniversityIdForWrite(scope, actorId),
	);

	const doc = await GovernanceIncidentModel.create({
		title: input.title.trim(),
		description: input.description?.trim() ?? "",
		kind: input.kind,
		severity: input.severity ?? "medium",
		status: "new",
		faculty: input.faculty?.trim(),
		department: input.department?.trim(),
		reportedByName: input.reportedByName?.trim() ?? "",
		reportedByEmail: input.reportedByEmail?.trim() ?? "",
		userInvolvedName: input.userInvolvedName?.trim() ?? "",
		assigneeName: input.assigneeName?.trim() ?? "",
		impactSummary: input.impactSummary?.trim() ?? "",
		evidence,
		linkedAuditId: input.linkedAuditId,
		linkedSystemId: input.linkedSystemId,
		timeline: [
			{
				at: new Date(),
				actorName: input.reportedByName?.trim() || "Administrator",
				action: "opened",
				note: input.impactSummary?.trim() || "Incident opened",
			},
		],
		detectedAt: new Date(),
		createdBy: actorId,
		updatedBy: actorId,
		universityId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "incident.opened",
			category: "security",
			actorId,
			summary: `Opened ${doc.severity} incident “${doc.title}”`,
			targetType: "governance_incident",
			targetId: doc._id.toString(),
			severity: doc.severity === "critical" || doc.severity === "high" ? "high" : "medium",
			flagged: true,
			flagReason: `Incident: ${doc.kind}`,
			faculty: doc.faculty ?? undefined,
			department: doc.department ?? undefined,
		});
	}

	return toRecord(doc.toObject());
}

export async function updateIncident(
	id: string,
	input: Partial<{
		title: string;
		description: string;
		kind: IncidentKind;
		severity: IncidentSeverity;
		status: IncidentStatus | LegacyIncidentStatus;
		faculty: string;
		department: string;
		reportedByName: string;
		reportedByEmail: string;
		userInvolvedName: string;
		assigneeName: string;
		impactSummary: string;
		evidence: string | string[];
		containmentActions: string;
		rootCause: string;
		lessonsLearned: string;
		linkedAuditId: string;
		linkedSystemId: string;
		timelineNote: string;
		actorName: string;
	}>,
	actorId?: string,
	scope?: AdminScope,
) {
	const existing = await assertDocInScope(GovernanceIncidentModel, id, scope);
	if (!existing) return null;

	const normalizedStatus =
		input.status !== undefined ? normalizeIncidentStatus(input.status) : undefined;

	const evidence =
		input.evidence !== undefined
			? Array.isArray(input.evidence)
				? input.evidence.map((e) => e.trim()).filter(Boolean)
				: input.evidence.trim()
					? [input.evidence.trim()]
					: []
			: undefined;

	const setFields: Record<string, unknown> = {
		...(input.title !== undefined ? { title: input.title.trim() } : {}),
		...(input.description !== undefined ? { description: input.description.trim() } : {}),
		...(input.kind !== undefined ? { kind: input.kind } : {}),
		...(input.severity !== undefined ? { severity: input.severity } : {}),
		...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
		...(input.faculty !== undefined ? { faculty: input.faculty.trim() } : {}),
		...(input.department !== undefined ? { department: input.department.trim() } : {}),
		...(input.reportedByName !== undefined ? { reportedByName: input.reportedByName.trim() } : {}),
		...(input.reportedByEmail !== undefined
			? { reportedByEmail: input.reportedByEmail.trim() }
			: {}),
		...(input.userInvolvedName !== undefined
			? { userInvolvedName: input.userInvolvedName.trim() }
			: {}),
		...(input.assigneeName !== undefined ? { assigneeName: input.assigneeName.trim() } : {}),
		...(input.impactSummary !== undefined ? { impactSummary: input.impactSummary.trim() } : {}),
		...(evidence !== undefined ? { evidence } : {}),
		...(input.containmentActions !== undefined
			? { containmentActions: input.containmentActions.trim() }
			: {}),
		...(input.rootCause !== undefined ? { rootCause: input.rootCause.trim() } : {}),
		...(input.lessonsLearned !== undefined ? { lessonsLearned: input.lessonsLearned.trim() } : {}),
		...(input.linkedAuditId !== undefined ? { linkedAuditId: input.linkedAuditId } : {}),
		...(input.linkedSystemId !== undefined ? { linkedSystemId: input.linkedSystemId } : {}),
		...(normalizedStatus === "resolved" || normalizedStatus === "closed"
			? { resolvedAt: new Date() }
			: {}),
		...(actorId ? { updatedBy: actorId } : {}),
	};

	const timelineEntry =
		normalizedStatus || input.timelineNote || evidence
			? {
					at: new Date(),
					actorName: input.actorName?.trim() || "Administrator",
					action: normalizedStatus ?? (evidence ? "evidence" : "comment"),
					note:
						input.timelineNote?.trim() ||
						(evidence ? `Evidence: ${evidence.join("; ")}` : "") ||
						input.containmentActions?.trim() ||
						input.rootCause?.trim() ||
						(normalizedStatus ? `Status → ${normalizedStatus}` : ""),
				}
			: null;

	const update: Record<string, unknown> = {};
	if (Object.keys(setFields).length) update.$set = setFields;
	if (timelineEntry) update.$push = { timeline: timelineEntry };

	const doc = await GovernanceIncidentModel.findByIdAndUpdate(id, update, { new: true }).lean();

	if (!doc) return null;

	if (actorId && normalizedStatus) {
		await recordAuditEvent({
			action: `incident.${normalizedStatus}`,
			category: "security",
			actorId,
			summary: `Incident “${doc.title}” → ${normalizedStatus}`,
			targetType: "governance_incident",
			targetId: id,
			severity: doc.severity === "critical" ? "critical" : "medium",
			flagged:
				normalizedStatus === "new" ||
				normalizedStatus === "assigned" ||
				normalizedStatus === "under_investigation",
		});
	}

	return toRecord(doc);
}

export async function getIncidentStats(scope?: AdminScope) {
	const sf = scopeFilter(scope);
	const [total, neu, assigned, investigating, waiting, critical, high] = await Promise.all([
		GovernanceIncidentModel.countDocuments(sf),
		GovernanceIncidentModel.countDocuments({ ...sf, status: { $in: ["new", "open"] } }),
		GovernanceIncidentModel.countDocuments({ ...sf, status: "assigned" }),
		GovernanceIncidentModel.countDocuments({
			...sf,
			status: { $in: ["under_investigation", "investigating"] },
		}),
		GovernanceIncidentModel.countDocuments({
			...sf,
			status: { $in: ["waiting_for_response", "contained"] },
		}),
		GovernanceIncidentModel.countDocuments({
			...sf,
			severity: "critical",
			status: { $in: [...ACTIVE_STATUSES] },
		}),
		GovernanceIncidentModel.countDocuments({
			...sf,
			severity: "high",
			status: { $in: [...ACTIVE_STATUSES] },
		}),
	]);
	return {
		total,
		open: neu,
		new: neu,
		assigned,
		investigating,
		underInvestigation: investigating,
		contained: waiting,
		waitingForResponse: waiting,
		active: neu + assigned + investigating + waiting,
		critical,
		high,
	};
}
