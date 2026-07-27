import {
	DEFAULT_ADMIN_EMAIL,
	DEFAULT_ADMIN_NAME,
	DEFAULT_ADMIN_PASSWORD,
} from "../constants/default-admin.js";
import { UserModel } from "../db/models/User.js";
import { hashPassword, verifyPassword } from "../lib/password.js";

function adminEmail(): string {
	return (process.env.DEFAULT_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL).toLowerCase();
}

function adminPassword(): string {
	return process.env.DEFAULT_ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD;
}

function adminName(): string {
	return process.env.DEFAULT_ADMIN_NAME?.trim() || DEFAULT_ADMIN_NAME;
}

/** Ensures the default admin account exists for /admin/login. */
export async function ensureDefaultAdmin(): Promise<void> {
	if (process.env.DEFAULT_ADMIN_ENABLED === "false") return;

	const email = adminEmail();
	const password = adminPassword();
	const name = adminName();
	const passwordHash = await hashPassword(password);

	const existing = await UserModel.findOne({ email }).select("+passwordHash");

	if (!existing) {
		await UserModel.create({
			name,
			email,
			passwordHash,
			role: "admin",
			status: "active",
			department: "Administration",
		});
		console.log(`[auth] Default admin created (${email})`);
		return;
	}

	let dirty = false;

	if (existing.role !== "admin") {
		existing.role = "admin";
		dirty = true;
	}
	if (existing.status !== "active") {
		existing.status = "active";
		dirty = true;
	}
	if (!existing.passwordHash) {
		existing.passwordHash = passwordHash;
		dirty = true;
	} else {
		const matches = await verifyPassword(password, existing.passwordHash);
		if (!matches) {
			existing.passwordHash = passwordHash;
			dirty = true;
		}
	}

	if (dirty) {
		await existing.save();
		console.log(`[auth] Default admin updated (${email})`);
	}
}
