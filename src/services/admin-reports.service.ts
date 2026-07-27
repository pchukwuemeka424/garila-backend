import { getUsageAnalytics } from "./admin-analytics.service.js";
import { getAuditAlertStats, listAuditLogs, recordAuditEvent } from "./admin-audit.service.js";
import { getApprovalStats } from "./admin-approvals.service.js";
import { getAlertStats } from "./admin-alerts.service.js";
import { getComplianceStats } from "./admin-compliance.service.js";
import { getContributionStats } from "./admin-contributions.service.js";
import { getIncidentStats } from "./admin-incidents.service.js";
import { getAiSystemStats } from "./admin-inventory.service.js";
import { getPolicyStats } from "./admin-policy.service.js";
import { getPrivacyStats } from "./admin-privacy.service.js";
import { getProvenanceStats } from "./admin-provenance.service.js";
import { getRetentionStats } from "./admin-retention.service.js";
import { getRiskStats } from "./admin-risk.service.js";
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

export type GovernanceReportAudience = "management" | "senate" | "both";

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
		approvalStats,
		riskStats,
		complianceStats,
		incidentStats,
		inventoryStats,
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
		getApprovalStats(scope),
		getRiskStats(scope),
		getComplianceStats(scope),
		getIncidentStats(scope),
		getAiSystemStats(scope),
		getContributionStats(scope),
		getProvenanceStats(scope),
		getPrivacyStats(scope),
		getRetentionStats(scope),
		listAuditLogs({ flaggedOnly: true, limit: 20 }, scope),
		UserModel.findById(input.actorId).select("name").lean(),
	]);

	const audienceLabel =
		input.audience === "senate"
			? "Senate"
			: input.audience === "management"
				? "Management"
				: "Management and Senate";

	const reportTypeLabel = input.reportType?.trim() || "AI Governance Report";
	const filterBits = [
		input.faculty ? `Faculty: ${input.faculty}` : null,
		input.department ? `Department: ${input.department}` : null,
		input.programme ? `Programme: ${input.programme}` : null,
		input.userRole ? `Role: ${input.userRole}` : null,
	].filter(Boolean);

	const title = `${reportTypeLabel} — ${audienceLabel} (${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)})`;

	const summary = [
		`Report type: ${reportTypeLabel}.`,
		filterBits.length ? `Filters — ${filterBits.join("; ")}.` : null,
		`Institutional AI use across research: ${analytics.totals.activeUsers} active accounts,`,
		`${analytics.totals.sessions} research sessions, ${analytics.totals.ideaSessions} idea generations,`,
		`${analytics.totals.papers} saved papers, and ${analytics.totals.tokensUsed.toLocaleString()} tokens consumed.`,
		`Compliance score ${complianceStats.score}% (${complianceStats.gap} gaps).`,
		`Risk register: ${riskStats.open} open / ${riskStats.mitigating} mitigating (avg inherent ${riskStats.avgInherent}, residual ${riskStats.avgResidual}).`,
		`Incidents: ${incidentStats.active} active (${incidentStats.critical} critical).`,
		`AI inventory: ${inventoryStats.active} active systems, ${inventoryStats.highRisk} high-risk, ${inventoryStats.dpiaPending} DPIA pending.`,
		`Policy posture: ${policyStats.permitted} permitted, ${policyStats.restricted} restricted, ${policyStats.blocked} blocked rules.`,
		`Approvals: ${approvalStats.pending} pending, ${approvalStats.approved} approved, ${approvalStats.rejected} rejected.`,
		`Audit: ${auditStats.flagged} flagged events (${auditStats.high} high / ${auditStats.critical} critical).`,
		`Governance alerts: ${alertStats.active} active (${alertStats.critical} critical).`,
		`AI contribution statements: ${contributionStats.verified}/${contributionStats.total} verified; ${contributionStats.incomplete} incomplete disclosures.`,
		`Provenance reviews: ${provenanceStats.underReview} under review, ${provenanceStats.escalated} escalated.`,
		`Privacy rules: ${privacyStats.enabled} enabled (${privacyStats.neverRaw} deny admin raw access).`,
		`Retention: ${retentionStats.enabled} policies; ${retentionStats.deletionOpen} open deletion/export requests.`,
		input.format ? `Requested export format: ${input.format}.` : null,
	]
		.filter(Boolean)
		.join(" ");

	const sections = [
		{
			heading: "1. Executive overview",
			body:
				input.audience === "senate"
					? `This report provides Senate with evidence of how AI is used in research across the university, the institutional policy controls in force, and material risk events requiring oversight.`
					: `This report summarises adoption, intensity, policy controls, and residual risk for Management decision-making on institutional AI governance.`,
			metrics: analytics.totals,
		},
		{
			heading: "2. Adoption by faculty",
			body:
				analytics.byFaculty.length === 0
					? "No faculty-level activity recorded in the selected period."
					: `Highest activity: ${topLabels(analytics.byFaculty)}.`,
			metrics: analytics.byFaculty.slice(0, 10),
		},
		{
			heading: "3. Adoption by department, programme, and cohort",
			body: [
				`Departments with strongest use: ${topLabels(analytics.byDepartment) || "n/a"}.`,
				`Programmes: ${topLabels(analytics.byProgramme) || "n/a"}.`,
				`Cohorts: ${topLabels(analytics.byCohort) || "n/a"}.`,
			].join(" "),
			metrics: {
				byDepartment: analytics.byDepartment.slice(0, 10),
				byProgramme: analytics.byProgramme.slice(0, 10),
				byCohort: analytics.byCohort.slice(0, 10),
			},
		},
		{
			heading: "4. Policy engine posture",
			body: `The institution currently maintains ${policyStats.total} governance policies (${policyStats.disabled} disabled). Blocked categories protect sensitive content; restricted categories require oversight or approval.`,
			metrics: policyStats,
		},
		{
			heading: "5. Compliance frameworks",
			body: `Overall compliance score ${complianceStats.score}%. Controls: ${complianceStats.compliant} compliant, ${complianceStats.inProgress} in progress, ${complianceStats.gap} gaps (${complianceStats.criticalGaps} critical/high). Primary national framework: Nigeria AI Act / National AI Strategy (NAIS), with NDPA data-protection controls and supporting EU AI Act, ISO 42001, and UNESCO guidance.`,
			metrics: complianceStats,
		},
		{
			heading: "6. Risk register",
			body: `Register holds ${riskStats.total} risks (${riskStats.open} open, ${riskStats.mitigating} mitigating, ${riskStats.accepted} accepted). Average inherent score ${riskStats.avgInherent}; average residual ${riskStats.avgResidual}. High inherent risks: ${riskStats.highInherent}; high residual: ${riskStats.highResidual}.`,
			metrics: riskStats,
		},
		{
			heading: "7. Incidents and audit alerts",
			body: [
				`Active incidents: ${incidentStats.active} (critical ${incidentStats.critical}, high ${incidentStats.high}).`,
				flagged.length === 0
					? "No flagged audit events in the recent window."
					: `Recent flagged activity includes: ${flagged
							.slice(0, 5)
							.map((f) => `${f.createdAt.slice(0, 10)} — ${f.summary}`)
							.join("; ")}.`,
			].join(" "),
			metrics: { incidentStats, auditStats, recentFlags: flagged.slice(0, 10) },
		},
		{
			heading: "8. AI system inventory & DPIA",
			body: `${inventoryStats.total} systems registered (${inventoryStats.active} active, ${inventoryStats.restricted} restricted). High/unacceptable risk systems: ${inventoryStats.highRisk}. DPIAs pending: ${inventoryStats.dpiaPending}; overdue: ${inventoryStats.dpiaOverdue}.`,
			metrics: inventoryStats,
		},
		{
			heading: "9. Approval pipeline",
			body: `${approvalStats.pending + approvalStats.underReview} items await decision (tools, datasets, or use cases). Approved entries: ${approvalStats.approved}; rejected: ${approvalStats.rejected}.`,
			metrics: approvalStats,
		},
		{
			heading: "10. AI contribution & provenance transparency",
			body: [
				`Contribution statements on file: ${contributionStats.total} (${contributionStats.verified} verified, ${contributionStats.incomplete} incomplete).`,
				`Provenance records: ${provenanceStats.total} (${provenanceStats.underReview} under review, ${provenanceStats.cleared} cleared, ${provenanceStats.escalated} escalated).`,
				"These records support academic integrity reviews without exposing raw research content.",
			].join(" "),
			metrics: { contributionStats, provenanceStats },
		},
		{
			heading: "11. Privacy, retention, and deletion",
			body: [
				`Privacy controls: ${privacyStats.enabled} active rules; admin raw research access denied by ${privacyStats.neverRaw} rules.`,
				`Retention policies: ${retentionStats.enabled} enabled (${retentionStats.legalHolds} legal holds).`,
				`Deletion/export requests: ${retentionStats.deletionOpen} open of ${retentionStats.deletionTotal} total (${retentionStats.deletionCompleted} completed).`,
			].join(" "),
			metrics: { privacyStats, retentionStats, alertStats },
		},
		{
			heading: "12. Oversight conclusion",
			body:
				input.audience === "senate"
					? "Senate is invited to note the evidence base above and request Management follow-up on compliance gaps, high residual risks, active incidents, pending DPIAs, incomplete AI disclosures, and open retention/deletion requests that affect academic integrity or data protection."
					: "Management is invited to close compliance gaps, treat high residual risks, resolve active incidents and alerts, complete pending DPIAs, verify AI contribution statements, and confirm retention/privacy policies for faculties with highest intensity of use.",
		},
	];

	const metrics = {
		analytics,
		auditStats,
		alertStats,
		policyStats,
		approvalStats,
		riskStats,
		complianceStats,
		incidentStats,
		inventoryStats,
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
		summary: `Generated governance report for ${audienceLabel}`,
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
	return toRecord(doc as unknown as Parameters<typeof toRecord>[0]);
}
