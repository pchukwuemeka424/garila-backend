import { getUsageAnalytics } from "./admin-analytics.service.js";
import { getAuditAlertStats, listAuditLogs } from "./admin-audit.service.js";
import { getAlertStats, listAlerts } from "./admin-alerts.service.js";
import { getContributionStats } from "./admin-contributions.service.js";
import { getIncidentStats, listIncidents } from "./admin-incidents.service.js";
import { getPolicyStats } from "./admin-policy.service.js";
import { getPrivacyStats } from "./admin-privacy.service.js";
import { getProvenanceStats } from "./admin-provenance.service.js";
import { listGovernanceReports } from "./admin-reports.service.js";
import { getRetentionStats } from "./admin-retention.service.js";
import { getTokenAdminStats } from "./admin-tokens.service.js";
import type { AdminScope } from "../lib/require-admin.js";
import { getDashboardStats } from "./dashboard.service.js";

export type GovernanceDashboard = {
	platform: Awaited<ReturnType<typeof getDashboardStats>>;
	aiUsage: {
		totals: Awaited<ReturnType<typeof getUsageAnalytics>>["totals"];
		byFaculty: Awaited<ReturnType<typeof getUsageAnalytics>>["byFaculty"];
		byFeature: Awaited<ReturnType<typeof getUsageAnalytics>>["byFeature"];
	};
	tokens: Awaited<ReturnType<typeof getTokenAdminStats>>;
	policies: Awaited<ReturnType<typeof getPolicyStats>>;
	audit: Awaited<ReturnType<typeof getAuditAlertStats>>;
	alerts: Awaited<ReturnType<typeof getAlertStats>>;
	incidents: Awaited<ReturnType<typeof getIncidentStats>>;
	contributions: Awaited<ReturnType<typeof getContributionStats>>;
	provenance: Awaited<ReturnType<typeof getProvenanceStats>>;
	privacy: Awaited<ReturnType<typeof getPrivacyStats>>;
	retention: Awaited<ReturnType<typeof getRetentionStats>>;
	activeIncidents: Awaited<ReturnType<typeof listIncidents>>;
	activeAlerts: Awaited<ReturnType<typeof listAlerts>>;
	recentFlags: Awaited<ReturnType<typeof listAuditLogs>>;
	recentReports: Awaited<ReturnType<typeof listGovernanceReports>>;
};

/** Single institutional view of AI use, alerts, adoption, and platform health. */
export async function getGovernanceDashboard(scope?: AdminScope): Promise<GovernanceDashboard> {
	const [
		platform,
		analytics,
		tokens,
		policies,
		audit,
		alerts,
		incidents,
		contributions,
		provenance,
		privacy,
		retention,
		activeIncidents,
		activeAlerts,
		recentFlags,
		recentReports,
	] = await Promise.all([
		getDashboardStats(scope),
		getUsageAnalytics(scope),
		getTokenAdminStats(scope),
		getPolicyStats(scope),
		getAuditAlertStats(scope),
		getAlertStats(scope),
		getIncidentStats(scope),
		getContributionStats(scope),
		getProvenanceStats(scope),
		getPrivacyStats(scope),
		getRetentionStats(scope),
		listIncidents({ limit: 12 }, scope),
		listAlerts({ status: "open", limit: 8 }, scope),
		listAuditLogs({ flaggedOnly: true, limit: 8 }, scope),
		listGovernanceReports(5, scope),
	]);

	return {
		platform,
		aiUsage: {
			totals: analytics.totals,
			byFaculty: analytics.byFaculty.slice(0, 8),
			byFeature: analytics.byFeature,
		},
		tokens,
		policies,
		audit,
		alerts,
		incidents,
		contributions,
		provenance,
		privacy,
		retention,
		activeIncidents: activeIncidents
			.filter((item) => !["resolved", "closed"].includes(item.status))
			.slice(0, 8),
		activeAlerts,
		recentFlags,
		recentReports,
	};
}
