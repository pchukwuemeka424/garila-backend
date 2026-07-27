import { GovernanceAlertModel } from "../db/models/GovernanceAlert.js";
import type { AdminScope } from "../lib/require-admin.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";
import { recordAuditEvent } from "./admin-audit.service.js";
import { notifyOnAlert } from "./notification.service.js";

export type AlertKind =
	| "sensitive_data"
	| "policy_violation"
	| "excessive_token_usage"
	| "unusual_login"
	| "multiple_failed_logins"
	| "suspicious_ai_prompt"
	| "restricted_content"
	| "excessive_document_generation"
	| "abnormal_user_activity"
	| "data_retention_warning"
	| "policy_breach"
	| "high_risk_activity"
	| "unusual_usage"
	| "privacy"
	| "security"
	| "other";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus =
	| "open"
	| "acknowledged"
	| "investigating"
	| "escalated"
	| "resolved"
	| "closed"
	| "dismissed";

export type GovernanceAlertRecord = {
	id: string;
	title: string;
	summary: string;
	kind: AlertKind;
	severity: AlertSeverity;
	status: AlertStatus;
	faculty: string | null;
	department: string | null;
	actorEmail: string | null;
	actorName: string | null;
	actorRole: string | null;
	assigneeName: string | null;
	linkedAuditId: string | null;
	linkedIncidentId: string | null;
	context: unknown;
	responseNotes: string;
	notificationSent: boolean;
	acknowledgedAt: string | null;
	resolvedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	title: string;
	summary: string;
	kind: string;
	severity: string;
	status: string;
	faculty?: string | null;
	department?: string | null;
	actorEmail?: string | null;
	actorName?: string | null;
	actorRole?: string | null;
	assigneeName?: string | null;
	linkedAuditId?: string | null;
	linkedIncidentId?: string | null;
	context?: unknown;
	responseNotes?: string | null;
	notificationSent?: boolean;
	acknowledgedAt?: Date | null;
	resolvedAt?: Date | null;
	createdAt: Date;
	updatedAt: Date;
}): GovernanceAlertRecord {
	return {
		id: doc._id.toString(),
		title: doc.title,
		summary: doc.summary,
		kind: doc.kind as AlertKind,
		severity: doc.severity as AlertSeverity,
		status: doc.status as AlertStatus,
		faculty: doc.faculty ?? null,
		department: doc.department ?? null,
		actorEmail: doc.actorEmail ?? null,
		actorName: doc.actorName ?? null,
		actorRole: doc.actorRole ?? null,
		assigneeName: doc.assigneeName?.trim() ? doc.assigneeName.trim() : null,
		linkedAuditId: doc.linkedAuditId ?? null,
		linkedIncidentId: doc.linkedIncidentId ?? null,
		context: doc.context ?? null,
		responseNotes: doc.responseNotes ?? "",
		notificationSent: Boolean(doc.notificationSent),
		acknowledgedAt: doc.acknowledgedAt?.toISOString() ?? null,
		resolvedAt: doc.resolvedAt?.toISOString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

/** Backfill universityId on legacy alerts from createdBy when present. */
export async function normalizeAlertDefaults() {
	await backfillUniversityIdFromUserRef(GovernanceAlertModel as never, "createdBy");
}

export async function listAlerts(
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
	if (options.status) {
		if (options.status === "closed") {
			filter.status = { $in: ["closed", "dismissed"] };
		} else {
			filter.status = options.status;
		}
	}
	if (options.severity) filter.severity = options.severity;
	if (options.kind) filter.kind = options.kind;
	const limit = Math.min(Math.max(options.limit ?? 100, 1), 300);
	const rows = await GovernanceAlertModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
	return rows.map(toRecord);
}

export async function createAlert(
	input: {
		title: string;
		summary: string;
		kind: AlertKind;
		severity?: AlertSeverity;
		faculty?: string;
		department?: string;
		actorEmail?: string;
		actorName?: string;
		actorRole?: string;
		assigneeName?: string;
		linkedAuditId?: string;
		linkedIncidentId?: string;
		context?: Record<string, unknown>;
		notificationSent?: boolean;
	},
	actorId?: string,
	scope?: AdminScope,
) {
	const severity = input.severity ?? "high";
	const universityId = universityObjectId(
		await resolveUniversityIdForWrite(scope, actorId),
	);

	const doc = await GovernanceAlertModel.create({
		title: input.title.trim(),
		summary: input.summary.trim(),
		kind: input.kind,
		severity,
		status: "open",
		faculty: input.faculty?.trim(),
		department: input.department?.trim(),
		actorEmail: input.actorEmail?.trim(),
		actorName: input.actorName?.trim(),
		actorRole: input.actorRole?.trim(),
		assigneeName: input.assigneeName?.trim() ?? "",
		linkedAuditId: input.linkedAuditId,
		linkedIncidentId: input.linkedIncidentId,
		context: input.context,
		notificationSent: input.notificationSent ?? (severity === "high" || severity === "critical"),
		createdBy: actorId,
		universityId,
	});

	if (actorId) {
		await recordAuditEvent({
			action: "alert.opened",
			category: "security",
			actorId,
			summary: `Opened ${severity} governance alert “${doc.title}”`,
			targetType: "governance_alert",
			targetId: doc._id.toString(),
			severity,
			flagged: true,
			flagReason: `Alert: ${doc.kind}`,
			faculty: doc.faculty ?? undefined,
			department: doc.department ?? undefined,
		});
	}

	if (severity === "high" || severity === "critical") {
		void notifyOnAlert({
			title: doc.title,
			summary: doc.summary,
			severity,
			kind: doc.kind,
		}).catch(() => undefined);
	}

	return toRecord(doc.toObject());
}

export async function updateAlert(
	id: string,
	input: Partial<{
		status: AlertStatus;
		responseNotes: string;
		linkedIncidentId: string;
		severity: AlertSeverity;
		assigneeName: string;
	}>,
	actorId?: string,
	scope?: AdminScope,
) {
	const existing = await assertDocInScope(GovernanceAlertModel, id, scope);
	if (!existing) return null;

	const closing =
		input.status === "resolved" || input.status === "closed" || input.status === "dismissed"
			? { resolvedAt: new Date(), ...(actorId ? { resolvedBy: actorId } : {}) }
			: {};
	const acknowledging =
		input.status === "acknowledged"
			? { acknowledgedAt: new Date(), ...(actorId ? { acknowledgedBy: actorId } : {}) }
			: {};

	const doc = await GovernanceAlertModel.findByIdAndUpdate(
		id,
		{
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.responseNotes !== undefined ? { responseNotes: input.responseNotes.trim() } : {}),
			...(input.linkedIncidentId !== undefined ? { linkedIncidentId: input.linkedIncidentId } : {}),
			...(input.severity !== undefined ? { severity: input.severity } : {}),
			...(input.assigneeName !== undefined ? { assigneeName: input.assigneeName.trim() } : {}),
			...closing,
			...acknowledging,
		},
		{ new: true },
	).lean();

	if (!doc) return null;

	if (actorId && input.status) {
		await recordAuditEvent({
			action: `alert.${input.status}`,
			category: "security",
			actorId,
			summary: `Alert “${doc.title}” → ${input.status}`,
			targetType: "governance_alert",
			targetId: id,
			severity: doc.severity === "critical" ? "critical" : "medium",
		});
	}

	return toRecord(doc);
}

export async function getAlertStats(scope?: AdminScope) {
	const sf = scopeFilter(scope);
	const [
		total,
		open,
		acknowledged,
		investigating,
		escalated,
		critical,
		high,
		last24h,
	] = await Promise.all([
		GovernanceAlertModel.countDocuments(sf),
		GovernanceAlertModel.countDocuments({ ...sf, status: "open" }),
		GovernanceAlertModel.countDocuments({ ...sf, status: "acknowledged" }),
		GovernanceAlertModel.countDocuments({ ...sf, status: "investigating" }),
		GovernanceAlertModel.countDocuments({ ...sf, status: "escalated" }),
		GovernanceAlertModel.countDocuments({
			...sf,
			severity: "critical",
			status: { $in: ["open", "acknowledged", "investigating", "escalated"] },
		}),
		GovernanceAlertModel.countDocuments({
			...sf,
			severity: "high",
			status: { $in: ["open", "acknowledged", "investigating", "escalated"] },
		}),
		GovernanceAlertModel.countDocuments({
			...sf,
			createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
		}),
	]);
	return {
		total,
		open,
		acknowledged,
		investigating,
		escalated,
		active: open + acknowledged + investigating + escalated,
		critical,
		high,
		last24h,
	};
}
