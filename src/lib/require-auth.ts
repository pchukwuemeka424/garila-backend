import { UserModel } from "../db/models/User.js";
import { extractBearerToken, verifyAuthToken } from "./auth-token.js";

export class AuthRequiredError extends Error {
	constructor(
		public statusCode: 401 | 403,
		message: string,
	) {
		super(message);
	}
}

/** Require a valid Bearer JWT for an active account. */
export async function requireAuthUser(authorization?: string): Promise<string> {
	const token = extractBearerToken(authorization);
	if (!token) throw new AuthRequiredError(401, "Authentication required.");

	const payload = verifyAuthToken(token);
	if (!payload?.sub) throw new AuthRequiredError(401, "Invalid or expired token.");

	const user = await UserModel.findById(payload.sub).select("status").lean();
	if (!user) throw new AuthRequiredError(401, "User not found.");
	if (user.status !== "active") {
		throw new AuthRequiredError(403, "Account is not active.");
	}

	return payload.sub;
}

/** Resolve user id from Bearer token, or null if missing/invalid/inactive. */
export async function resolveActiveUserId(authorization?: string): Promise<string | null> {
	try {
		return await requireAuthUser(authorization);
	} catch (error) {
		if (error instanceof AuthRequiredError) return null;
		throw error;
	}
}
