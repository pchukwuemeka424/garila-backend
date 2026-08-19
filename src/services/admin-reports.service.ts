import { getUsageAnalytics } from "./admin-analytics.service.js";
import { getAuditAlertStats, listAuditLogs, recordAuditEvent } from "./admin-audit.service.js";
import { getAlertStats } from "./admin-alerts.service.js";
import { getContributionStats } from "./admin-contributions.service.js";
import { getIncidentStats } from "./admin-incidents.service.js";
import { getPolicyStats } from "./admin-policy.service.js";
import { getPrivacyStats } from "./admin-privacy.service.js";
import { getProvenanceStats } from "./admin-provenance.service.js";
import { getRetentionStats } from "./admin-retention.service.js";
import { getTokenAdminStats } from "./admin-tokens.service.js";
import { GovernanceReportModel } from "../db/models/GovernanceReport.js";
import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "../lib/require-admin.js";
import {
	assertDocInScope,
	backfillUniversityIdFromUserRef,
	resolveUniversityIdForWrite,
	scopeFilter,
	universityObjectId,
} from "../lib/admin-scope.js";

export type GovernanceReportAudience = "management" | "senate" | "both" | "external_auditors";

export type GovernanceReportRecord = {
	id: string;
	title: string;
	audience: GovernanceReportAudience;
	periodStart: string;
	periodEnd: string;
	status: string;
	summary: string;
	sections: Array<{ heading: string; body: string; metrics?: unknown }>;
	metrics: unknown;
	universityId: string | null;
	generatedBy: string | null;
	generatedByName: string | null;
	createdAt: string;
	updatedAt: string;
};

function toRecord(doc: {
	_id: { toString(): string };
	title: string;
	audience: string;
	periodStart: Date;
	periodEnd: Date;
	status: string;
	summary?: string | null;
	sections?: Array<{ heading: string; body: string; metrics?: unknown }>;
	metrics?: unknown;
	universityId?: { toString(): string } | null;
	generatedBy?: { toString(): string } | null;
	generatedByName?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): GovernanceReportRecord {
	return {
		id: doc._id.toString(),
		title: doc.title,
		audience: doc.audience as GovernanceReportAudience,
		periodStart: doc.periodStart.toISOString(),
		periodEnd: doc.periodEnd.toISOString(),
		status: doc.status,
		summary: doc.summary ?? "",
		sections: doc.sections ?? [],
		metrics: doc.metrics ?? null,
		universityId: doc.universityId?.toString() ?? null,
		generatedBy: doc.generatedBy?.toString() ?? null,
		generatedByName: doc.generatedByName ?? null,
		createdAt: doc.createdAt.toISOString(),
		updatedAt: doc.updatedAt.toISOString(),
	};
}

function topLabels(rows: Array<{ label: string; tokensUsed: number; sessions: number }>, n = 5) {
	return rows
		.slice(0, n)
		.map((r) => `${r.label} (${r.sessions} sessions, ${r.tokensUsed.toLocaleString()} tokens)`)
		.join("; ");
}

function audienceLabel(audience: GovernanceReportAudience): string {
	if (audience === "senate") return "Senate";
	if (audience === "management") return "Management";
	if (audience === "external_auditors") return "External auditors";
	return "Management and Senate";
}

/** Normalize sparse legacy reports and backfill universityId from generatedBy. */
export async function normalizeGovernanceReportDefaults() {
	await backfillUniversityIdFromUserRef(GovernanceReportModel, "generatedBy");
}

export async function generateGovernanceReport(input: {
	audience: GovernanceReportAudience;
	periodStart?: string;
	periodEnd?: string;
	reportType?: string;
	format?: string;
	faculty?: string;
	department?: string;
	programme?: string;
	userRole?: string;
	actorId: string;
	universityId?: string;
	scope?: AdminScope;
}): Promise<GovernanceReportRecord> {
	const scope = input.scope;
	const periodEnd = input.periodEnd ? new Date(input.periodEnd) : new Date();
	const periodStart = input.periodStart
		? new Date(input.periodStart)
		: new Date(periodEnd.getTime() - 90 * 24 * 60 * 60 * 1000);

	const universityId = await resolveUniversityIdForWrite(
		scope,
		input.actorId,
		input.universityId,
	);

	const [
		analytics,
		auditStats,
		alertStats,
		policyStats,
		incidentStats,
		tokenStats,
		contributionStats,
		provenanceStats,
		privacyStats,
		retentionStats,
		flagged,
		actor,
	] = await Promise.all([
		getUsageAnalytics(scope),
		getAuditAlertStats(scope),
		getAlertStats(scope),
		getPolicyStats(scope),
		getIncidentStats(scope),
		getTokenAdminStats(scope),
		getContributionStats(scope),
		getProvenanceStats(scope),
		getPrivacyStats(scope),
		getRetentionStats(scope),
		listAuditLogs({ flaggedOnly: true, limit: 20 }, scope),
		UserModel.findById(input.actorId).select("name").lean(),
	]);

	const label = audienceLabel(input.audience);
	const reportTypeLabel = input.reportType?.trim() || "AI Governance Report";
	const filterBits = [
		input.faculty ? `Faculty: ${input.faculty}` : null,
		input.department ? `Department: ${input.department}` : null,
		input.programme ? `Programme: ${input.programme}` : null,
		input.userRole ? `Role: ${input.userRole}` : null,
	].filter(Boolean);

	const title = `${reportTypeLabel} — ${label} (${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)})`;

	const summary = [
		`Report type: ${reportTypeLabel}.`,
		filterBits.length ? `Filters — ${filterBits.join("; ")}.` : null,
		`Platform usage: ${analytics.totals.activeUsers} active accounts, ${analytics.totals.sessions} research sessions, ${analytics.totals.papers} saved papers, ${analytics.totals.tokensUsed.toLocaleString()} tokens.`,
		`Governance activity: ${alertStats.active} open alerts, ${auditStats.flagged} flagged audit events, ${policyStats.total} policies (${policyStats.blocked} blocked, ${policyStats.restricted} restricted).`,
		`Incidents: ${incidentStats.active} active (${incidentStats.critical} critical).`,
		`Policy compliance: ${policyStats.permitted} permitted rules in force; ${privacyStats.neverRaw} privacy rules deny admin raw research access.`,
		`Institutional AI adoption: ${analytics.totals.ideaSessions} idea sessions, ${analytics.totals.projects} projects.`,
		`AI contribution statements: ${contributionStats.verified}/${contributionStats.total} verified. Provenance: ${provenanceStats.underReview} under review.`,
		`Retention: ${retentionStats.enabled} policies; ${retentionStats.deletionOpen} open deletion/export requests.`,
		input.format ? `Requested export format: ${input.format}.` : null,
	]
		.filter(Boolean)
		.join(" ");

	const closing =
		input.audience === "external_auditors"
			? "External auditors are invited to note usage, governance activity, incidents, policy compliance, and AI adoption evidence above. Research titles and raw research materials are not included."
			: input.audience === "senate"
				? "Senate is invited to note platform usage, governance activity, incidents, policy compliance, and institutional AI adoption, and to request Management follow-up where incidents or incomplete disclosures remain open."
				: "Management is invited to act on open alerts and incidents, confirm policy coverage, and use adoption and token figures for operational planning.";

	const sections = [
		{
			heading: "1. Executive overview",
			body: `This report summarises GARIL AI governance for ${label} covering usage, governance activities, incidents, policy compliance, and institutional AI adoption. Private research content and lecturer research titles are excluded.`,
			metrics: analytics.totals,
		},
		{
			heading: "2. Platform usage",
			body:
				analytics.byFaculty.length === 0
					? "No faculty-level activity recorded in the selected period."
					: `Highest activity: ${topLabels(analytics.byFaculty)}. Departments: ${topLabels(analytics.byDepartment) || "n/a"}. Programmes: ${topLabels(analytics.byProgramme) || "n/a"}. Cohorts: ${topLabels(analytics.byCohort) || "n/a"}.`,
			metrics: {
				totals: analytics.totals,
				byFaculty: analytics.byFaculty.slice(0, 10),
				byDepartment: analytics.byDepartment.slice(0, 10),
				byProgramme: analytics.byProgramme.slice(0, 10),
				byCohort: analytics.byCohort.slice(0, 10),
			},
		},
		{
			heading: "3. Token consumption",
			body: `Estimated consumption ${tokenStats.totalTokensUsed.toLocaleString()} tokens (approx. cost ${tokenStats.estimatedCost}). ${tokenStats.lecturersWithQuota} lecturers/researchers and ${tokenStats.studentsWithQuota} students have quotas.`,
			metrics: tokenStats,
		},
		{
			heading: "4. Governance activities",
			body: [
				`Audit: ${auditStats.total} events (${auditStats.flagged} flagged; ${auditStats.high} high / ${auditStats.critical} critical).`,
				`Alerts: ${alertStats.active} active (${alertStats.critical} critical).`,
				`Policies: ${policyStats.total} (${policyStats.disabled} disabled).`,
				flagged.length === 0
					? "No flagged audit events in the recent window."
					: `Recent flagged activity: ${flagged
							.slice(0, 5)
							.map((f) => `${f.createdAt.slice(0, 10)} — ${f.summary}`)
							.join("; ")}.`,
			].join(" "),
			metrics: { auditStats, alertStats, policyStats, recentFlags: flagged.slice(0, 10) },
		},
		{
			heading: "5. Incidents",
			body: `Active incidents: ${incidentStats.active} (critical ${incidentStats.critical}, high ${incidentStats.high}). Each incident is managed with a recorded history of actions and resolution status.`,
			metrics: incidentStats,
		},
		{
			heading: "6. Policy compliance",
			body: `Institutional AI policies in force: ${policyStats.permitted} permitted, ${policyStats.restricted} restricted, ${policyStats.blocked} blocked. Privacy rules: ${privacyStats.enabled} enabled (${privacyStats.neverRaw} deny admin raw access). Retention: ${retentionStats.enabled} policies; ${retentionStats.deletionOpen} open deletion/export requests.`,
			metrics: { policyStats, privacyStats, retentionStats },
		},
		{
			heading: "7. Institutional AI adoption",
			body: `${analytics.totals.activeUsers} active users; ${analytics.totals.sessions} sessions; ${analytics.totals.ideaSessions} idea generations; ${analytics.totals.papers} papers; ${analytics.totals.projects} projects. Contribution statements: ${contributionStats.total} (${contributionStats.verified} verified). Provenance records: ${provenanceStats.total} (${provenanceStats.underReview} under review, ${provenanceStats.escalated} escalated).`,
			metrics: { contributionStats, provenanceStats, byFeature: analytics.byFeature },
		},
		{
			heading: "8. Oversight conclusion",
			body: closing,
		},
	];

	const metrics = {
		analytics,
		auditStats,
		alertStats,
		policyStats,
		incidentStats,
		tokenStats,
		contributionStats,
		provenanceStats,
		privacyStats,
		retentionStats,
		periodStart: periodStart.toISOString(),
		periodEnd: periodEnd.toISOString(),
		reportType: reportTypeLabel,
		format: input.format ?? null,
		filters: {
			faculty: input.faculty ?? null,
			department: input.department ?? null,
			programme: input.programme ?? null,
			userRole: input.userRole ?? null,
		},
	};

	const doc = await GovernanceReportModel.create({
		title,
		audience: input.audience,
		periodStart,
		periodEnd,
		status: "final",
		summary,
		sections,
		metrics,
		universityId: universityObjectId(universityId),
		generatedBy: input.actorId,
		generatedByName: actor?.name,
	});

	await recordAuditEvent({
		action: "report.generated",
		category: "report",
		actorId: input.actorId,
		summary: `Generated governance report for ${label}`,
		targetType: "governance_report",
		targetId: doc._id.toString(),
		details: { audience: input.audience },
	});

	return toRecord(doc.toObject());
}

export async function listGovernanceReports(
	limit = 50,
	scope?: AdminScope,
): Promise<GovernanceReportRecord[]> {
	const rows = await GovernanceReportModel.find(scopeFilter(scope))
		.sort({ createdAt: -1 })
		.limit(Math.min(Math.max(limit, 1), 100))
		.lean();
	return rows.map(toRecord);
}

export async function getGovernanceReport(
	id: string,
	scope?: AdminScope,
): Promise<GovernanceReportRecord | null> {
	const doc = await assertDocInScope(GovernanceReportModel, id, scope);
	if (!doc) return null;
	return toRecord(doc as never);
}
