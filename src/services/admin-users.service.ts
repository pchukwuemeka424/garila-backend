import { Types } from "mongoose";

import { hashPassword } from "../lib/password.js";
import { UserModel } from "../db/models/User.js";
import type { AdminScope } from "../lib/require-admin.js";
import { universityFilterForScope } from "../lib/require-admin.js";
import {
	createUser,
	deleteUser,
	getDashboardStats,
	listConsoleAdmins,
	listRecentSessions,
	listRecentSessionTopics,
	listUsers,
	updateUser,
} from "./dashboard.service.js";

export {
	getDashboardStats,
	listRecentSessions,
	listRecentSessionTopics,
	listUsers,
	listConsoleAdmins,
	createUser,
	updateUser,
	deleteUser,
};

export async function resetUserPassword(id: string, password: string, scope?: AdminScope) {
	if (password.length < 8) throw new Error("Password must be at least 8 characters.");

	const existing = await UserModel.findById(id).lean();
	if (!existing) return null;
	if (scope?.kind === "university") {
		if (!existing.universityId || existing.universityId.toString() !== scope.universityId) {
			throw new Error("You can only manage users in your university.");
		}
	}

	const passwordHash = await hashPassword(password);
	const user = await UserModel.findByIdAndUpdate(id, { passwordHash }, { new: true }).lean();
	if (!user) return null;

	return {
		id: user._id.toString(),
		name: user.name,
		email: user.email,
		role: user.role,
		status: user.status,
		department: user.department ?? null,
		institution: user.institution ?? null,
		universityId: user.universityId ? user.universityId.toString() : null,
		lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
		createdAt: user.createdAt.toISOString(),
	};
}

export async function bulkUpdateUserStatus(
	ids: string[],
	status: "active" | "inactive" | "suspended",
	scope?: AdminScope,
) {
	if (ids.length === 0) return { updated: 0 };
	const filter: Record<string, unknown> = {
		_id: { $in: ids.map((id) => new Types.ObjectId(id)) },
		...universityFilterForScope(scope ?? { kind: "platform", actorId: "", role: "admin" }),
	};
	const result = await UserModel.updateMany(filter, { status });
	return { updated: result.modifiedCount };
}

export async function bulkDeleteUsers(ids: string[], scope?: AdminScope) {
	if (ids.length === 0) return { deleted: 0 };
	const filter: Record<string, unknown> = {
		_id: { $in: ids.map((id) => new Types.ObjectId(id)) },
		...universityFilterForScope(scope ?? { kind: "platform", actorId: "", role: "admin" }),
	};
	if (scope?.kind === "university") {
		filter.role = { $ne: "admin" };
	}
	const result = await UserModel.deleteMany(filter);
	return { deleted: result.deletedCount };
}
