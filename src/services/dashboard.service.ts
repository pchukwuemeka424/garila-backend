import { Types } from "mongoose";

import { hashPassword } from "../lib/password.js";
import { MessageModel } from "../db/models/Message.js";
import { SessionModel } from "../db/models/Session.js";
import { enrichSessionsWithOwnership } from "./session-enrichment.service.js";
import { UserModel } from "../db/models/User.js";
import { UniversityModel } from "../db/models/University.js";
import {
	type AdminScope,
	isSuperAdminRole,
	universityFilterForScope,
} from "../lib/require-admin.js";
import {
	getUniversityTokenDefaultsMap,
	quotaForUser,
	type UniversityTokenDefaults,
} from "./token-quota.service.js";

const CONSOLE_ROLES = new Set([
	"admin",
	"governance_admin",
	"faculty_admin",
	"department_admin",
	"compliance_officer",
	"data_protection_officer",
	"research_integrity_officer",
	"auditor",
]);
const UNI_ADMIN_ROLES = new Set(
	[...CONSOLE_ROLES].filter((role) => role !== "admin"),
);

export async function getDashboardStats(scope?: AdminScope) {
	const userFilter = scope ? universityFilterForScope(scope) : {};
	const users = await UserModel.find(userFilter).select("_id").lean();
	const userIds = users.map((u) => u._id);
	const sessionFilter =
		scope?.kind === "university" ? { userId: { $in: userIds } } : {};
	const sessionIds =
		scope?.kind === "university"
			? await SessionModel.find(sessionFilter).distinct("_id")
			: null;

	const [userCount, activeUsers, sessionCount, messageCount, activeSessions] = await Promise.all([
		UserModel.countDocuments(userFilter),
		UserModel.countDocuments({ ...userFilter, status: "active" }),
		SessionModel.countDocuments(sessionFilter),
		MessageModel.countDocuments({
			...(sessionIds ? { sessionId: { $in: sessionIds } } : {}),
			role: { $in: ["user", "assistant"] },
		}),
		SessionModel.countDocuments({
			...sessionFilter,
			state: { $in: ["running", "starting"] },
		}),
	]);

	return {
		userCount,
		activeUsers,
		sessionCount,
		messageCount,
		activeSessions,
	};
}

function mapUserRecord(
	user: {
		_id: { toString(): string };
		name: string;
		email: string;
		role: string;
		status: string;
		department?: string | null;
		institution?: string | null;
		universityId?: Types.ObjectId | null;
		faculty?: string | null;
		programme?: string | null;
		cohort?: string | null;
		lastActiveAt?: Date | null;
		createdAt: Date;
		updatedAt?: Date;
		tokensUsed?: number | null;
		tokenAllowance?: number | null;
		suspensionReason?: string | null;
		invitedBy?: Types.ObjectId | null;
		invitedAt?: Date | null;
		complianceFlags?: string[] | null;
	},
	defaultsByUniversity?: Map<string, UniversityTokenDefaults>,
) {
	return {
		id: user._id.toString(),
		name: user.name,
		email: user.email,
		role: user.role,
		status: user.status,
		department: user.department ?? null,
		institution: user.institution ?? null,
		universityId: user.universityId ? user.universityId.toString() : null,
		faculty: user.faculty ?? null,
		programme: user.programme ?? null,
		cohort: user.cohort ?? null,
		lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
		createdAt: user.createdAt.toISOString(),
		updatedAt: user.updatedAt?.toISOString() ?? user.createdAt.toISOString(),
		tokenQuota: quotaForUser(user, defaultsByUniversity),
		tokenAllowance: user.tokenAllowance ?? null,
		suspensionReason: user.suspensionReason ?? null,
		invitedBy: user.invitedBy ? user.invitedBy.toString() : null,
		invitedAt: user.invitedAt?.toISOString() ?? null,
		complianceFlags: user.complianceFlags ?? [],
	};
}

export async function listUsers(scope?: AdminScope) {
	const filter = scope ? universityFilterForScope(scope) : {};
	const users = await UserModel.find(filter).sort({ createdAt: -1 }).lean();
	const defaults = await getUniversityTokenDefaultsMap(users.map((u) => u.universityId));
	return users.map((u) => mapUserRecord(u, defaults));
}

export async function listConsoleAdmins() {
	const users = await UserModel.find({
		role: { $in: [...CONSOLE_ROLES] },
	})
		.sort({ createdAt: -1 })
		.lean();
	const defaults = await getUniversityTokenDefaultsMap(users.map((u) => u.universityId));
	return users.map((u) => mapUserRecord(u, defaults));
}

export async function getAdminUserById(id: string, scope?: AdminScope) {
	if (!Types.ObjectId.isValid(id)) return null;
	const filter: Record<string, unknown> = { _id: new Types.ObjectId(id) };
	if (scope?.kind === "university") {
		Object.assign(filter, universityFilterForScope(scope));
	}
	const user = await UserModel.findOne(filter).lean();
	if (!user) return null;
	const defaults = await getUniversityTokenDefaultsMap([user.universityId]);
	return mapUserRecord(user, defaults);
}

async function resolveUniversityFields(input: {
	universityId?: string;
	institution?: string;
}) {
	if (!input.universityId) {
		return {
			universityId: undefined as Types.ObjectId | undefined,
			institution: input.institution?.trim() || undefined,
		};
	}
	if (!Types.ObjectId.isValid(input.universityId)) {
		throw new Error("Invalid university.");
	}
	const uni = await UniversityModel.findById(input.universityId).lean();
	if (!uni) throw new Error("University not found.");
	return {
		universityId: uni._id,
		institution: input.institution?.trim() || uni.name,
	};
}

function assertRoleAssignment(scope: AdminScope | undefined, role: string | undefined) {
	if (!role) return;
	if (isSuperAdminRole(role) && scope?.kind === "university") {
		throw new Error("Only a super administrator can assign the Super Administrator role.");
	}
	if (scope?.kind === "university" && CONSOLE_ROLES.has(role) && !UNI_ADMIN_ROLES.has(role)) {
		throw new Error("University admins cannot assign platform super admin.");
	}
	if (scope?.kind === "university" && role === "admin") {
		throw new Error("University admins cannot create super administrators.");
	}
}

export async function createUser(
	input: {
		name: string;
		email: string;
		role?: string;
		status?: string;
		department?: string;
		institution?: string;
		universityId?: string;
		faculty?: string;
		programme?: string;
		cohort?: string;
		password?: string;
	},
	scope?: AdminScope,
) {
	if (input.password && input.password.length < 8) {
		throw new Error("Password must be at least 8 characters.");
	}

	const role = input.role ?? "lecturer";
	assertRoleAssignment(scope, role);

	let universityId = input.universityId;
	let institution = input.institution;

	if (scope?.kind === "university") {
		universityId = scope.universityId;
		if (role === "admin") {
			throw new Error("University admins cannot create super administrators.");
		}
	}

	if (CONSOLE_ROLES.has(role) && role !== "admin" && !universityId) {
		throw new Error("University admins must be assigned to a university.");
	}

	if (role !== "admin" && !universityId && scope?.kind === "platform") {
		throw new Error("universityId is required for non–super-admin accounts.");
	}

	const uniFields = await resolveUniversityFields({ universityId, institution });
	const passwordHash = input.password ? await hashPassword(input.password) : undefined;
	const isInvite = !passwordHash && scope?.actorId && Types.ObjectId.isValid(scope.actorId);

	const user = await UserModel.create({
		name: input.name.trim(),
		email: input.email.trim().toLowerCase(),
		role,
		status: input.status ?? "active",
		department: input.department?.trim(),
		institution: uniFields.institution,
		universityId: role === "admin" ? undefined : uniFields.universityId,
		faculty: input.faculty?.trim(),
		programme: input.programme?.trim(),
		cohort: input.cohort?.trim(),
		...(passwordHash ? { passwordHash } : {}),
		...(isInvite
			? { invitedBy: new Types.ObjectId(scope!.actorId), invitedAt: new Date() }
			: {}),
	});
	const defaults = await getUniversityTokenDefaultsMap([user.universityId]);
	return mapUserRecord(user.toObject(), defaults);
}

export async function updateUser(
	id: string,
	input: Partial<{
		name: string;
		email: string;
		role: string;
		status: string;
		department: string;
		institution: string;
		universityId: string | null;
		faculty: string;
		programme: string;
		cohort: string;
		suspensionReason: string | null;
	}>,
	scope?: AdminScope,
) {
	const existing = await UserModel.findById(id).lean();
	if (!existing) return null;

	if (scope?.kind === "university") {
		if (!existing.universityId || existing.universityId.toString() !== scope.universityId) {
			throw new Error("You can only manage users in your university.");
		}
		if (input.role === "admin") {
			throw new Error("University admins cannot assign super administrator.");
		}
		if (input.universityId && input.universityId !== scope.universityId) {
			throw new Error("You cannot move users to another university.");
		}
	}

	assertRoleAssignment(scope, input.role);

	const nextRole = input.role ?? existing.role;
	let uniUpdate: Record<string, unknown> = {};
	if (input.universityId !== undefined || input.institution !== undefined) {
		if (nextRole === "admin") {
			uniUpdate = { universityId: null, institution: input.institution?.trim() ?? existing.institution };
		} else if (input.universityId === null) {
			uniUpdate = {
				universityId: null,
				...(input.institution !== undefined ? { institution: input.institution.trim() } : {}),
			};
		} else {
			const uniFields = await resolveUniversityFields({
				universityId: input.universityId ?? existing.universityId?.toString(),
				institution: input.institution,
			});
			uniUpdate = {
				universityId: uniFields.universityId,
				institution: uniFields.institution,
			};
		}
	}

	if (CONSOLE_ROLES.has(nextRole) && nextRole !== "admin") {
		const effectiveUni =
			(uniUpdate.universityId as Types.ObjectId | null | undefined) ?? existing.universityId;
		if (!effectiveUni) {
			throw new Error("University admins must be assigned to a university.");
		}
	}

	const nextStatus = input.status ?? existing.status;
	let suspensionUpdate: Record<string, unknown> = {};
	if (input.status !== undefined || input.suspensionReason !== undefined) {
		if (nextStatus === "suspended") {
			const reason =
				input.suspensionReason !== undefined
					? input.suspensionReason?.trim() || null
					: existing.suspensionReason ?? null;
			suspensionUpdate = { suspensionReason: reason };
		} else if (input.status !== undefined && nextStatus !== "suspended") {
			suspensionUpdate = { suspensionReason: null };
		} else if (input.suspensionReason !== undefined) {
			suspensionUpdate = {
				suspensionReason: input.suspensionReason?.trim() || null,
			};
		}
	}

	const user = await UserModel.findByIdAndUpdate(
		id,
		{
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
			...(input.email !== undefined ? { email: input.email.trim().toLowerCase() } : {}),
			...(input.role !== undefined ? { role: input.role } : {}),
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.department !== undefined ? { department: input.department.trim() } : {}),
			...(input.faculty !== undefined ? { faculty: input.faculty.trim() } : {}),
			...(input.programme !== undefined ? { programme: input.programme.trim() } : {}),
			...(input.cohort !== undefined ? { cohort: input.cohort.trim() } : {}),
			...uniUpdate,
			...suspensionUpdate,
			...(nextRole === "admin" ? { universityId: null } : {}),
		},
		{ new: true, runValidators: true },
	).lean();

	if (!user) return null;

	const defaults = await getUniversityTokenDefaultsMap([user.universityId]);
	return mapUserRecord(user, defaults);
}

export async function deleteUser(id: string, scope?: AdminScope) {
	const existing = await UserModel.findById(id).lean();
	if (!existing) return false;

	if (scope?.actorId && scope.actorId === id) {
		throw new Error("You cannot delete your own account.");
	}

	if (scope?.kind === "university") {
		if (!existing.universityId || existing.universityId.toString() !== scope.universityId) {
			throw new Error("You can only manage users in your university.");
		}
		if (existing.role === "admin") {
			throw new Error("You cannot delete a super administrator.");
		}
	}

	const result = await UserModel.findByIdAndDelete(id);
	return Boolean(result);
}

async function scopedUserIds(scope?: AdminScope) {
	if (scope?.kind !== "university") return null;
	const users = await UserModel.find(universityFilterForScope(scope)).select("_id").lean();
	return users.map((u) => u._id);
}

export async function listRecentSessions(limit = 10, scope?: AdminScope) {
	const userIds = await scopedUserIds(scope);
	const filter: Record<string, unknown> = {};
	if (userIds) filter.userId = { $in: userIds };

	const sessions = await SessionModel.find(filter)
		.select("userId workflow topic model state createdAt updatedAt")
		.sort({ updatedAt: -1 })
		.limit(limit)
		.lean();
	const sessionIds = sessions.map((s) => s._id);

	const messageCounts = await MessageModel.aggregate<{ _id: (typeof sessionIds)[number]; count: number }>([
		{ $match: { sessionId: { $in: sessionIds }, role: { $in: ["user", "assistant"] } } },
		{ $group: { _id: "$sessionId", count: { $sum: 1 } } },
	]);

	const countMap = new Map(messageCounts.map((row) => [row._id.toString(), row.count]));

	const base = sessions.map((session) => ({
		id: session._id.toString(),
		userId: session.userId?.toString() ?? null,
		workflow: session.workflow ?? null,
		topic: session.topic ?? null,
		model: session.model,
		state: session.state,
		messageCount: countMap.get(session._id.toString()) ?? 0,
		createdAt: session.createdAt.toISOString(),
		updatedAt: session.updatedAt.toISOString(),
	}));

	return enrichSessionsWithOwnership(
		base.map((session) => ({
			...session,
			topic: session.topic?.trim() || session.workflow?.trim() || "General research",
		})),
	);
}

export async function listRecentSessionTopics(limit = 8, scope?: AdminScope) {
	const userIds = await scopedUserIds(scope);
	const filter: Record<string, unknown> = {};
	if (userIds) filter.userId = { $in: userIds };

	const sessions = await SessionModel.find(filter)
		.select("userId topic workflow model state createdAt updatedAt")
		.sort({ updatedAt: -1 })
		.limit(limit)
		.lean();

	const sessionIds = sessions.map((s) => s._id);
	const messageCounts = await MessageModel.aggregate<{ _id: (typeof sessionIds)[number]; count: number }>([
		{ $match: { sessionId: { $in: sessionIds }, role: { $in: ["user", "assistant"] } } },
		{ $group: { _id: "$sessionId", count: { $sum: 1 } } },
	]);
	const countMap = new Map(messageCounts.map((row) => [row._id.toString(), row.count]));

	const base = sessions.map((session) => {
		const id = session._id.toString();
		return {
			id,
			userId: session.userId?.toString() ?? null,
			topic: session.topic?.trim() || session.workflow?.trim() || "General research",
			workflow: session.workflow ?? null,
			model: session.model,
			state: session.state,
			messageCount: countMap.get(id) ?? 0,
			createdAt: session.createdAt.toISOString(),
			updatedAt: session.updatedAt.toISOString(),
		};
	});

	return enrichSessionsWithOwnership(base);
}
