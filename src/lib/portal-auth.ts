import { Types } from "mongoose";

import { UserModel } from "../db/models/User.js";
import { extractBearerToken, verifyAuthToken } from "./auth-token.js";
import { UnauthorizedError, ForbiddenError } from "./portal-errors.js";

export type PortalActor = {
	userId: string;
	/** University id when set; otherwise the actor's user id (legacy fallback). */
	tenantId: string;
	/** Real university membership; null if the account is not linked to a university. */
	universityId: string | null;
	role: string;
	name: string;
	email: string;
};

const SUPERVISOR_ROLES = new Set(["lecturer", "researcher", "admin"]);

export function isSupervisorRole(role: string) {
	return SUPERVISOR_ROLES.has(role);
}

export function isStudentRole(role: string) {
	return role === "student";
}

export async function requirePortalActor(authorization?: string): Promise<PortalActor> {
	const token = extractBearerToken(authorization);
	if (!token) throw new UnauthorizedError();
	const payload = verifyAuthToken(token);
	if (!payload?.sub) throw new UnauthorizedError();

	const user = await UserModel.findById(payload.sub)
		.select("name email role universityId status")
		.lean();
	if (!user || user.status !== "active") throw new UnauthorizedError("Account is not active.");

	const universityId = user.universityId ? String(user.universityId) : null;
	const tenantId = universityId ?? String(user._id);

	return {
		userId: String(user._id),
		tenantId,
		universityId,
		role: user.role,
		name: user.name,
		email: user.email,
	};
}

export function requireStudent(actor: PortalActor) {
	if (!isStudentRole(actor.role)) {
		throw new ForbiddenError("Only students can perform this action");
	}
}

export function requireSupervisor(actor: PortalActor) {
	if (!isSupervisorRole(actor.role)) {
		throw new ForbiddenError("Only lecturers can perform this action");
	}
}

export function asObjectId(id: string) {
	if (!Types.ObjectId.isValid(id)) return null;
	return new Types.ObjectId(id);
}
