import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_NAME } from "../constants/default-admin.js";
import { UserModel } from "../db/models/User.js";
import { hashPassword } from "../lib/password.js";

function adminEmail(): string {
	return (process.env.DEFAULT_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL).toLowerCase();
}

function adminPassword(): string {
	const fromEnv = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
	if (!fromEnv) {
		throw new Error(
			"DEFAULT_ADMIN_ENABLED=true requires DEFAULT_ADMIN_PASSWORD in the environment.",
		);
	}
	if (fromEnv.length < 12) {
		throw new Error("DEFAULT_ADMIN_PASSWORD must be at least 12 characters.");
	}
	return fromEnv;
}

function adminName(): string {
	return process.env.DEFAULT_ADMIN_NAME?.trim() || DEFAULT_ADMIN_NAME;
}

/**
 * Opt-in first-run bootstrap: creates a platform admin only when the account does not exist.
 * Never overwrites an existing password hash (prevents known-credential resets on restart).
 */
export async function ensureDefaultAdmin(): Promise<void> {
	if (process.env.DEFAULT_ADMIN_ENABLED !== "true") return;

	if (process.env.NODE_ENV === "production") {
		console.warn(
			"[auth] DEFAULT_ADMIN_ENABLED=true in production. Disable after first bootstrap (DEFAULT_ADMIN_ENABLED=false).",
		);
	}

	const email = adminEmail();
	const password = adminPassword();
	const name = adminName();

	const existing = await UserModel.findOne({ email }).select("_id role status").lean();
	if (existing) {
		console.log(`[auth] Bootstrap admin already exists (${email}); password left unchanged.`);
		return;
	}

	const passwordHash = await hashPassword(password);
	await UserModel.create({
		name,
		email,
		passwordHash,
		role: "admin",
		status: "active",
		department: "Administration",
	});
	console.log(`[auth] Default admin created (${email}). Set DEFAULT_ADMIN_ENABLED=false after first login.`);
}
