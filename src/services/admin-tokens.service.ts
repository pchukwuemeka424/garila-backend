import { Types } from "mongoose";

import type { StudentTokenQuota } from "../constants/student-tokens.js";
import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "../lib/require-admin.js";
import { universityFilterForScope } from "../lib/require-admin.js";
import {
	getUniversityTokenDefaultsMap,
	quotaForUser,
	type UniversityTokenDefaults,
} from "./token-quota.service.js";

export type AdminTokenRecord = {
	id: string;
	name: string;
	email: string;
	role: string;
	faculty: string | null;
	department: string | null;
	programme: string | null;
	universityId: string | null;
	institution: string | null;
	tokenAllowance: number | null;
	tokenQuota: StudentTokenQuota | null;
};

export type TokenOrgBreakdown = {
	key: string;
	label: string;
	users: number;
	tokensUsed: number;
	allowance: number;
};

export type TokenAdminStats = {
	userCount: number;
	studentsWithQuota: number;
	lecturersWithQuota: number;
	totalTokensUsed: number;
	dailyTokensApprox: number;
	weeklyTokensApprox: number;
	monthlyTokensApprox: number;
	estimatedCost: number;
	byFaculty: TokenOrgBreakdown[];
	byDepartment: TokenOrgBreakdown[];
	byProgramme: TokenOrgBreakdown[];
};

const COST_PER_1K = 0.002;

function toAdminTokenRecord(
	user: {
		_id: { toString(): string };
		name: string;
		email: string;
		role: string;
		faculty?: string | null;
		department?: string | null;
		programme?: string | null;
		universityId?: Types.ObjectId | null;
		institution?: string | null;
		tokensUsed?: number;
		tokenAllowance?: number | null;
	},
	defaultsByUniversity?: Map<string, UniversityTokenDefaults>,
): AdminTokenRecord {
	return {
		id: user._id.toString(),
		name: user.name,
		email: user.email,
		role: user.role,
		faculty: user.faculty ?? null,
		department: user.department ?? null,
		programme: user.programme ?? null,
		universityId: user.universityId ? user.universityId.toString() : null,
		institution: user.institution ?? null,
		tokenAllowance: user.tokenAllowance ?? null,
		tokenQuota: quotaForUser(user, defaultsByUniversity),
	};
}

async function assertUserInScope(userId: string, scope?: AdminScope) {
	if (!scope || scope.kind === "platform") return;
	const user = await UserModel.findById(userId).select("universityId").lean();
	if (!user?.universityId || user.universityId.toString() !== scope.universityId) {
		throw new Error("You can only manage users in your university.");
	}
}

const TOKEN_SELECT =
	"name email role faculty department programme universityId institution tokensUsed tokenAllowance";

export async function listUsersTokenQuotas(scope?: AdminScope): Promise<AdminTokenRecord[]> {
	const filter = scope ? universityFilterForScope(scope) : {};
	const users = await UserModel.find(filter).select(TOKEN_SELECT).sort({ name: 1 }).lean();
	const defaults = await getUniversityTokenDefaultsMap(users.map((u) => u.universityId));
	return users.map((u) => toAdminTokenRecord(u, defaults));
}

export async function resetUserTokens(
	userId: string,
	scope?: AdminScope,
): Promise<AdminTokenRecord | null> {
	await assertUserInScope(userId, scope);
	const user = await UserModel.findByIdAndUpdate(userId, { tokensUsed: 0 }, { new: true })
		.select(TOKEN_SELECT)
		.lean();
	if (!user) return null;
	const defaults = await getUniversityTokenDefaultsMap([user.universityId]);
	return toAdminTokenRecord(user, defaults);
}

export async function setUserTokensUsed(
	userId: string,
	tokensUsed: number,
	scope?: AdminScope,
): Promise<AdminTokenRecord | null> {
	await assertUserInScope(userId, scope);
	const used = Math.max(0, Math.round(tokensUsed));
	const user = await UserModel.findByIdAndUpdate(userId, { tokensUsed: used }, { new: true })
		.select(TOKEN_SELECT)
		.lean();
	if (!user) return null;
	const defaults = await getUniversityTokenDefaultsMap([user.universityId]);
	return toAdminTokenRecord(user, defaults);
}

export async function setUserTokenAllowance(
	userId: string,
	tokenAllowance: number | null,
	scope?: AdminScope,
): Promise<AdminTokenRecord | null> {
	await assertUserInScope(userId, scope);
	const value =
		tokenAllowance == null || !Number.isFinite(tokenAllowance) || tokenAllowance <= 0
			? null
			: Math.round(tokenAllowance);
	const user = await UserModel.findByIdAndUpdate(
		userId,
		{ tokenAllowance: value },
		{ new: true },
	)
		.select(TOKEN_SELECT)
		.lean();
	if (!user) return null;
	const defaults = await getUniversityTokenDefaultsMap([user.universityId]);
	return toAdminTokenRecord(user, defaults);
}

export async function bulkResetUserTokens(
	userIds: string[],
	scope?: AdminScope,
): Promise<{ reset: number }> {
	if (userIds.length === 0) return { reset: 0 };
	const filter: Record<string, unknown> = {
		_id: { $in: userIds.map((id) => new Types.ObjectId(id)) },
		...(scope ? universityFilterForScope(scope) : {}),
	};
	const result = await UserModel.updateMany(filter, { tokensUsed: 0 });
	return { reset: result.modifiedCount };
}

export async function getTokenAdminStats(scope?: AdminScope): Promise<TokenAdminStats> {
	const filter = scope ? universityFilterForScope(scope) : {};
	const users = await UserModel.find(filter)
		.select("role tokensUsed tokenAllowance faculty department programme universityId")
		.lean();
	const defaults = await getUniversityTokenDefaultsMap(users.map((u) => u.universityId));
	let totalTokensUsed = 0;
	let studentsWithQuota = 0;
	let lecturersWithQuota = 0;
	const facultyMap = new Map<string, TokenOrgBreakdown>();
	const departmentMap = new Map<string, TokenOrgBreakdown>();
	const programmeMap = new Map<string, TokenOrgBreakdown>();

	const bump = (map: Map<string, TokenOrgBreakdown>, key: string | null | undefined, used: number, allowance: number) => {
		const label = key?.trim() || "Unassigned";
		const current = map.get(label) ?? { key: label, label, users: 0, tokensUsed: 0, allowance: 0 };
		current.users += 1;
		current.tokensUsed += used;
		current.allowance += allowance;
		map.set(label, current);
	};

	for (const user of users) {
		const quota = quotaForUser(user, defaults);
		const used = quota?.used ?? user.tokensUsed ?? 0;
		const allowance = quota?.allowance ?? 0;
		totalTokensUsed += used;
		if (user.role === "student") studentsWithQuota++;
		if (user.role === "lecturer" || user.role === "researcher") lecturersWithQuota++;
		bump(facultyMap, user.faculty, used, allowance);
		bump(departmentMap, user.department, used, allowance);
		bump(programmeMap, user.programme, used, allowance);
	}

	const sortRows = (map: Map<string, TokenOrgBreakdown>) =>
		[...map.values()].sort((a, b) => b.tokensUsed - a.tokensUsed);

	const dailyTokensApprox = Math.round(totalTokensUsed / 30);
	const weeklyTokensApprox = Math.round(totalTokensUsed / 4.3);
	const monthlyTokensApprox = totalTokensUsed;
	const estimatedCost = Math.round((totalTokensUsed / 1000) * COST_PER_1K * 100) / 100;

	return {
		userCount: users.length,
		studentsWithQuota,
		lecturersWithQuota,
		totalTokensUsed,
		dailyTokensApprox,
		weeklyTokensApprox,
		monthlyTokensApprox,
		estimatedCost,
		byFaculty: sortRows(facultyMap),
		byDepartment: sortRows(departmentMap),
		byProgramme: sortRows(programmeMap),
	};
}
