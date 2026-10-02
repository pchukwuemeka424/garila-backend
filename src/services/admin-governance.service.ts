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

export type RoleAiPosture = {
	role: "student" | "lecturer";
	label: string;
	activeUsers: number;
	tokensUsed: number;
	sessions: number;
	ideaSessions: number;
	papers: number;
	projects: number;
	contributions: number;
	provenance: number;
	openAlerts: number;
};

export type GovernanceDashboard = {
	platform: Awaited<ReturnType<typeof getDashboardStats>>;
	aiUsage: {
		totals: Awaited<ReturnType<typeof getUsageAnalytics>>["totals"];
		byFaculty: Awaited<ReturnType<typeof getUsageAnalytics>>["byFaculty"];
		byFeature: Awaited<ReturnType<typeof getUsageAnalytics>>["byFeature"];
		byRole: Awaited<ReturnType<typeof getUsageAnalytics>>["byRole"];
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
	studentPosture: RoleAiPosture;
	lecturerPosture: RoleAiPosture;
	activeIncidents: Awaited<ReturnType<typeof listIncidents>>;
	activeAlerts: Awaited<ReturnType<typeof listAlerts>>;
	recentFlags: Awaited<ReturnType<typeof listAuditLogs>>;
	recentReports: Awaited<ReturnType<typeof listGovernanceReports>>;
};

function postureFromRole(
	roleKey: "student" | "lecturer",
	label: string,
	byRole: Awaited<ReturnType<typeof getUsageAnalytics>>["byRole"],
	byOwnerRole: { student: number; lecturer: number },
	provByRole: { student: number; lecturer: number },
	alertsByRole: { student: number; lecturer: number },
): RoleAiPosture {
	const row = byRole.find((r) => {
		const key = r.key.toLowerCase();
		if (roleKey === "student") return key === "student";
		return key === "lecturer" || key === "researcher";
	});
	const lecturerTokens = byRole
		.filter((r) => {
			const key = r.key.toLowerCase();
			return key === "lecturer" || key === "researcher";
		})
		.reduce(
			(acc, r) => ({
				activeUsers: acc.activeUsers + r.activeUsers,
				tokensUsed: acc.tokensUsed + r.tokensUsed,
				sessions: acc.sessions + r.sessions,
				ideaSessions: acc.ideaSessions + r.ideaSessions,
				papers: acc.papers + r.papers,
				projects: acc.projects + r.projects,
			}),
			{ activeUsers: 0, tokensUsed: 0, sessions: 0, ideaSessions: 0, papers: 0, projects: 0 },
		);

	if (roleKey === "lecturer") {
		return {
			role: roleKey,
			label,
			activeUsers: lecturerTokens.activeUsers,
			tokensUsed: lecturerTokens.tokensUsed,
			sessions: lecturerTokens.sessions,
			ideaSessions: lecturerTokens.ideaSessions,
			papers: lecturerTokens.papers,
			projects: lecturerTokens.projects,
			contributions: byOwnerRole.lecturer,
			provenance: provByRole.lecturer,
			openAlerts: alertsByRole.lecturer,
		};
	}

	return {
		role: roleKey,
		label,
		activeUsers: row?.activeUsers ?? 0,
		tokensUsed: row?.tokensUsed ?? 0,
		sessions: row?.sessions ?? 0,
		ideaSessions: row?.ideaSessions ?? 0,
		papers: row?.papers ?? 0,
		projects: row?.projects ?? 0,
		contributions: byOwnerRole.student,
		provenance: provByRole.student,
		openAlerts: alertsByRole.student,
	};
}

/** Institutional AI governance overview — student vs lecturer posture, alerts, integrity. */
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

	const studentPosture = postureFromRole(
		"student",
		"Student AI posture",
		analytics.byRole,
		contributions.byOwnerRole,
		provenance.byOwnerRole,
		alerts.byActorRole,
	);
	const lecturerPosture = postureFromRole(
		"lecturer",
		"Lecturer AI posture",
		analytics.byRole,
		contributions.byOwnerRole,
		provenance.byOwnerRole,
		alerts.byActorRole,
	);

	return {
		platform,
		aiUsage: {
			totals: analytics.totals,
			byFaculty: analytics.byFaculty.slice(0, 8),
			byFeature: analytics.byFeature,
			byRole: analytics.byRole,
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
		studentPosture,
		lecturerPosture,
		activeIncidents: activeIncidents
			.filter((item) => !["resolved", "closed"].includes(item.status))
			.slice(0, 8),
		activeAlerts,
		recentFlags,
		recentReports,
	};
}
