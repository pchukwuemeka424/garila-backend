import { ResearchIdeaSessionModel } from "../db/models/ResearchIdeaSession.js";
import { ResearchProjectModel } from "../db/models/ResearchProject.js";
import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { SessionModel } from "../db/models/Session.js";
import { UserModel } from "../db/models/User.js";
import { orgDimensionsForUser, type OrgDimensions } from "../lib/org-dimensions.js";
import type { AdminScope } from "../lib/require-admin.js";
import { scopeFilter } from "../lib/admin-scope.js";

export type UsageBreakdownRow = {
	key: string;
	label: string;
	users: number;
	activeUsers: number;
	tokensUsed: number;
	sessions: number;
	ideaSessions: number;
	papers: number;
	projects: number;
	intensity: number;
};

export type UsageAnalytics = {
	totals: {
		users: number;
		activeUsers: number;
		tokensUsed: number;
		sessions: number;
		ideaSessions: number;
		papers: number;
		projects: number;
	};
	byFaculty: UsageBreakdownRow[];
	byDepartment: UsageBreakdownRow[];
	byProgramme: UsageBreakdownRow[];
	byCohort: UsageBreakdownRow[];
	byRole: UsageBreakdownRow[];
	byFeature: Array<{ feature: string; count: number; label: string }>;
};

type UserLean = {
	_id: { toString(): string };
	role: string;
	status: string;
	department?: string | null;
	faculty?: string | null;
	programme?: string | null;
	cohort?: string | null;
	tokensUsed?: number;
	createdAt: Date;
};

function emptyBucket(key: string, label: string): UsageBreakdownRow {
	return {
		key,
		label,
		users: 0,
		activeUsers: 0,
		tokensUsed: 0,
		sessions: 0,
		ideaSessions: 0,
		papers: 0,
		projects: 0,
		intensity: 0,
	};
}

function bump(
	map: Map<string, UsageBreakdownRow>,
	key: string,
	label: string,
	patch: Partial<UsageBreakdownRow>,
) {
	const row = map.get(key) ?? emptyBucket(key, label);
	row.users += patch.users ?? 0;
	row.activeUsers += patch.activeUsers ?? 0;
	row.tokensUsed += patch.tokensUsed ?? 0;
	row.sessions += patch.sessions ?? 0;
	row.ideaSessions += patch.ideaSessions ?? 0;
	row.papers += patch.papers ?? 0;
	row.projects += patch.projects ?? 0;
	map.set(key, row);
}

function finalize(map: Map<string, UsageBreakdownRow>): UsageBreakdownRow[] {
	return [...map.values()]
		.map((row) => ({
			...row,
			intensity:
				row.activeUsers > 0
					? Math.round((row.sessions + row.ideaSessions + row.papers + row.projects) / row.activeUsers)
					: 0,
		}))
		.sort((a, b) => b.tokensUsed - a.tokensUsed || b.sessions - a.sessions || a.label.localeCompare(b.label));
}

export async function getUsageAnalytics(scope?: AdminScope): Promise<UsageAnalytics> {
	const userFilter = scopeFilter(scope);

	const users = (await UserModel.find(userFilter)
		.select("role status department faculty programme cohort tokensUsed createdAt")
		.lean()) as UserLean[];

	const userIds = users.map((u) => u._id);
	const activityFilter =
		scope?.kind === "university" ? { userId: { $in: userIds } } : {};

	const [sessions, ideaSessions, papers, projects] = await Promise.all([
		SessionModel.find(activityFilter).select("userId").lean(),
		ResearchIdeaSessionModel.find(activityFilter).select("userId").lean(),
		SavedResearchModel.find(activityFilter).select("userId").lean(),
		ResearchProjectModel.find(activityFilter).select("userId").lean(),
	]);

	const orgByUser = new Map<string, OrgDimensions & { role: string; status: string; tokensUsed: number }>();
	for (const user of users) {
		const org = orgDimensionsForUser(user);
		orgByUser.set(user._id.toString(), {
			...org,
			role: user.role,
			status: user.status,
			tokensUsed: user.tokensUsed ?? 0,
		});
	}

	const countByUser = (rows: Array<{ userId?: { toString(): string } | null }>) => {
		const map = new Map<string, number>();
		for (const row of rows) {
			const id = row.userId?.toString();
			if (!id) continue;
			map.set(id, (map.get(id) ?? 0) + 1);
		}
		return map;
	};

	const sessionCounts = countByUser(sessions);
	const ideaCounts = countByUser(ideaSessions);
	const paperCounts = countByUser(papers);
	const projectCounts = countByUser(projects);

	const byFaculty = new Map<string, UsageBreakdownRow>();
	const byDepartment = new Map<string, UsageBreakdownRow>();
	const byProgramme = new Map<string, UsageBreakdownRow>();
	const byCohort = new Map<string, UsageBreakdownRow>();
	const byRole = new Map<string, UsageBreakdownRow>();

	let totalTokens = 0;
	let activeUsers = 0;

	for (const [userId, org] of orgByUser) {
		const sessionsN = sessionCounts.get(userId) ?? 0;
		const ideasN = ideaCounts.get(userId) ?? 0;
		const papersN = paperCounts.get(userId) ?? 0;
		const projectsN = projectCounts.get(userId) ?? 0;
		const isActive = org.status === "active" ? 1 : 0;
		totalTokens += org.tokensUsed;
		activeUsers += isActive;

		const patch = {
			users: 1,
			activeUsers: isActive,
			tokensUsed: org.tokensUsed,
			sessions: sessionsN,
			ideaSessions: ideasN,
			papers: papersN,
			projects: projectsN,
		};

		bump(byFaculty, org.faculty, org.faculty, patch);
		bump(byDepartment, org.department, org.department, patch);
		bump(byProgramme, org.programme, org.programme, patch);
		bump(byCohort, org.cohort, org.cohort, patch);
		bump(byRole, org.role, org.role, patch);
	}

	return {
		totals: {
			users: users.length,
			activeUsers,
			tokensUsed: totalTokens,
			sessions: sessions.length,
			ideaSessions: ideaSessions.length,
			papers: papers.length,
			projects: projects.length,
		},
		byFaculty: finalize(byFaculty),
		byDepartment: finalize(byDepartment),
		byProgramme: finalize(byProgramme),
		byCohort: finalize(byCohort),
		byRole: finalize(byRole),
		byFeature: [
			{ feature: "research-sessions", label: "Research chat / papers", count: sessions.length },
			{ feature: "research-ideas", label: "Research ideas", count: ideaSessions.length },
			{ feature: "saved-papers", label: "Saved papers", count: papers.length },
			{ feature: "research-projects", label: "Research projects", count: projects.length },
		],
	};
}
