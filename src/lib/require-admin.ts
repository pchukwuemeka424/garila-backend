import { Types } from "mongoose";

import {
	DEFAULT_ROLE_PERMISSIONS,
	UserModel,
	type FeatureAction,
	type GovernanceFeature,
} from "../db/models/User.js";
import { extractBearerToken, verifyAuthToken } from "./auth-token.js";

export class AdminRequiredError extends Error {
	constructor(
		public statusCode: 401 | 403,
		message: string,
	) {
		super(message);
	}
}

export const ADMIN_CONSOLE_ROLES = new Set([
	"admin",
	"governance_admin",
	"faculty_admin",
	"department_admin",
	"compliance_officer",
	"data_protection_officer",
	"research_integrity_officer",
	"auditor",
]);

export const SUPER_ADMIN_ROLE = "admin";

export type AdminScope =
	| { kind: "platform"; actorId: string; role: string }
	| { kind: "university"; actorId: string; role: string; universityId: string };

export function isAdminConsoleRole(role: string | null | undefined): boolean {
	return Boolean(role && ADMIN_CONSOLE_ROLES.has(role));
}

export function isSuperAdminRole(role: string | null | undefined): boolean {
	return role === SUPER_ADMIN_ROLE;
}

async function loadAdminActor(authorization?: string) {
	const token = extractBearerToken(authorization);
	if (!token) throw new AdminRequiredError(401, "Authentication required.");

	const payload = verifyAuthToken(token);
	if (!payload?.sub) throw new AdminRequiredError(401, "Invalid or expired token.");

	const user = await UserModel.findById(payload.sub).select("role universityId faculty department permissions").lean();
	if (!user) throw new AdminRequiredError(401, "User not found.");
	if (!isAdminConsoleRole(user.role)) {
		throw new AdminRequiredError(403, "Admin access required.");
	}

	return {
		actorId: payload.sub,
		role: user.role,
		universityId: user.universityId ? user.universityId.toString() : null,
		faculty: (user as Record<string, unknown>).faculty as string | null,
		department: (user as Record<string, unknown>).department as string | null,
		permissions: (user as Record<string, unknown>).permissions as Map<string, string[]> | undefined,
	};
}

export async function requireAdmin(authorization?: string): Promise<string> {
	const actor = await loadAdminActor(authorization);
	return actor.actorId;
}

export async function requireSuperAdmin(authorization?: string): Promise<string> {
	const actor = await loadAdminActor(authorization);
	if (!isSuperAdminRole(actor.role)) {
		throw new AdminRequiredError(403, "Super admin access required.");
	}
	return actor.actorId;
}

export async function requireAdminScope(authorization?: string): Promise<AdminScope> {
	const actor = await loadAdminActor(authorization);
	if (isSuperAdminRole(actor.role)) {
		return { kind: "platform", actorId: actor.actorId, role: actor.role };
	}
	if (!actor.universityId) {
		throw new AdminRequiredError(
			403,
			"University admin is not assigned to a university. Contact the super administrator.",
		);
	}
	return {
		kind: "university",
		actorId: actor.actorId,
		role: actor.role,
		universityId: actor.universityId,
	};
}

export function universityFilterForScope(scope: AdminScope): Record<string, unknown> {
	if (scope.kind === "platform") return {};
	return { universityId: new Types.ObjectId(scope.universityId) };
}

export function hasFeaturePermission(
	role: string,
	feature: GovernanceFeature,
	action: FeatureAction,
	customPermissions?: Map<string, string[]> | undefined,
): boolean {
	if (role === "admin") return true;

	if (customPermissions && customPermissions.has(feature)) {
		const actions = customPermissions.get(feature)!;
		return actions.includes(action);
	}

	const rolePerms = DEFAULT_ROLE_PERMISSIONS[role];
	if (!rolePerms) return false;
	const featurePerms = rolePerms[feature];
	if (!featurePerms) return false;
	return featurePerms.includes(action);
}

export async function requireFeatureAccess(
	authorization: string | undefined,
	feature: GovernanceFeature,
	action: FeatureAction,
): Promise<AdminScope> {
	const actor = await loadAdminActor(authorization);

	if (!isSuperAdminRole(actor.role)) {
		if (!hasFeaturePermission(actor.role, feature, action, actor.permissions)) {
			throw new AdminRequiredError(
				403,
				`Access denied: ${actor.role} does not have '${action}' permission for '${feature}'.`,
			);
		}
	}

	if (isSuperAdminRole(actor.role)) {
		return { kind: "platform", actorId: actor.actorId, role: actor.role };
	}
	if (!actor.universityId) {
		throw new AdminRequiredError(
			403,
			"University admin is not assigned to a university. Contact the super administrator.",
		);
	}
	return {
		kind: "university",
		actorId: actor.actorId,
		role: actor.role,
		universityId: actor.universityId,
	};
}
