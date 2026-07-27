import { getUsageAnalytics } from "./admin-analytics.service.js";
import { getAuditAlertStats, listAuditLogs } from "./admin-audit.service.js";
import { getApprovalStats, listApprovals } from "./admin-approvals.service.js";
import { getAlertStats, listAlerts } from "./admin-alerts.service.js";
import { getComplianceStats } from "./admin-compliance.service.js";
import { getContributionStats } from "./admin-contributions.service.js";
import { getIncidentStats, listIncidents } from "./admin-incidents.service.js";
import { getAiSystemStats, listAiSystems } from "./admin-inventory.service.js";
import { getPolicyStats } from "./admin-policy.service.js";
import { getPrivacyStats } from "./admin-privacy.service.js";
import { getProvenanceStats } from "./admin-provenance.service.js";
import { listGovernanceReports } from "./admin-reports.service.js";
import { getRetentionStats } from "./admin-retention.service.js";
import { getRiskStats, listRisks } from "./admin-risk.service.js";
import type { AdminScope } from "../lib/require-admin.js";
import { getDashboardStats } from "./dashboard.service.js";

export type GovernanceDashboard = {
	platform: Awaited<ReturnType<typeof getDashboardStats>>;
	aiUsage: {
		totals: Awaited<ReturnType<typeof getUsageAnalytics>>["totals"];
		byFaculty: Awaited<ReturnType<typeof getUsageAnalytics>>["byFaculty"];
		byFeature: Awaited<ReturnType<typeof getUsageAnalytics>>["byFeature"];
	};
	policies: Awaited<ReturnType<typeof getPolicyStats>>;
	audit: Awaited<ReturnType<typeof getAuditAlertStats>>;
	alerts: Awaited<ReturnType<typeof getAlertStats>>;
	approvals: Awaited<ReturnType<typeof getApprovalStats>>;
	risks: Awaited<ReturnType<typeof getRiskStats>>;
	compliance: Awaited<ReturnType<typeof getComplianceStats>>;
	incidents: Awaited<ReturnType<typeof getIncidentStats>>;
	inventory: Awaited<ReturnType<typeof getAiSystemStats>>;
	contributions: Awaited<ReturnType<typeof getContributionStats>>;
	provenance: Awaited<ReturnType<typeof getProvenanceStats>>;
	privacy: Awaited<ReturnType<typeof getPrivacyStats>>;
	retention: Awaited<ReturnType<typeof getRetentionStats>>;
	topRisks: Awaited<ReturnType<typeof listRisks>>;
	activeIncidents: Awaited<ReturnType<typeof listIncidents>>;
	activeAlerts: Awaited<ReturnType<typeof listAlerts>>;
	highRiskSystems: Awaited<ReturnType<typeof listAiSystems>>;
	recentFlags: Awaited<ReturnType<typeof listAuditLogs>>;
	pendingApprovals: Awaited<ReturnType<typeof listApprovals>>;
	recentReports: Awaited<ReturnType<typeof listGovernanceReports>>;
};

/** Single institutional view of AI use, compliance, and risk across research. */
export async function getGovernanceDashboard(scope?: AdminScope): Promise<GovernanceDashboard> {
	const [
		platform,
		analytics,
		policies,
		audit,
		alerts,
		approvals,
		risks,
		compliance,
		incidents,
		inventory,
		contributions,
		provenance,
		privacy,
		retention,
		topRisks,
		activeIncidents,
		activeAlerts,
		highRiskSystems,
		recentFlags,
		pendingApprovals,
		recentReports,
	] = await Promise.all([
		getDashboardStats(scope),
		getUsageAnalytics(scope),
		getPolicyStats(scope),
		getAuditAlertStats(scope),
		getAlertStats(scope),
		getApprovalStats(scope),
		getRiskStats(scope),
		getComplianceStats(scope),
		getIncidentStats(scope),
		getAiSystemStats(scope),
		getContributionStats(scope),
		getProvenanceStats(scope),
		getPrivacyStats(scope),
		getRetentionStats(scope),
		listRisks({ status: "open" }, scope),
		listIncidents({ status: "open", limit: 8 }, scope),
		listAlerts({ status: "open", limit: 8 }, scope),
		listAiSystems({ riskTier: "high" }, scope),
		listAuditLogs({ flaggedOnly: true, limit: 8 }, scope),
		listApprovals({ status: "pending", limit: 8 }, scope),
		listGovernanceReports(5, scope),
	]);

	return {
		platform,
		aiUsage: {
			totals: analytics.totals,
			byFaculty: analytics.byFaculty.slice(0, 8),
			byFeature: analytics.byFeature,
		},
		policies,
		audit,
		alerts,
		approvals,
		risks,
		compliance,
		incidents,
		inventory,
		contributions,
		provenance,
		privacy,
		retention,
		topRisks: topRisks.slice(0, 5),
		activeIncidents,
		activeAlerts,
		highRiskSystems: highRiskSystems.slice(0, 5),
		recentFlags,
		pendingApprovals,
		recentReports,
	};
}
