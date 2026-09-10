import { createHash, randomBytes } from "node:crypto";

import { Types } from "mongoose";

import { getAppUrl } from "../config/env.js";
import type { StudentTokenQuota } from "../constants/student-tokens.js";
import { UserModel, type UserDocument } from "../db/models/User.js";
import { signAuthToken } from "../lib/auth-token.js";
import { isFreeEmail, LECTURER_FREE_EMAIL_ERROR } from "../lib/email.js";
import { sendMail } from "../lib/mailer.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
	getActiveUniversityByCatalogueId,
	getFeaturesForUniversityId,
	isUniversityActive,
} from "./admin-universities.service.js";
import { DEFAULT_UNIVERSITY_FEATURES } from "../lib/university-features.js";
import { quotaForUserAsync } from "./token-quota.service.js";

export type PublicUser = {
	id: string;
	name: string;
	email: string;
	role: string;
	status: string;
	department: string | null;
	institution: string | null;
	programme: string | null;
	cohort: string | null;
	universityId: string | null;
	lastActiveAt: string | null;
	createdAt: string;
	tokenQuota?: StudentTokenQuota;
	features?: import("../lib/university-features.js").UniversityFeatures;
};

const UNIVERSITY_NOT_ONBOARDED =
	"Your university is not yet onboarded on this platform. Contact your administrator.";

async function toPublicUser(user: UserDocument | Record<string, unknown>): Promise<PublicUser> {
	const doc = user as UserDocument & {
		createdAt: Date;
		lastActiveAt?: Date;
		tokensUsed?: number;
		tokenAllowance?: number | null;
		universityId?: Types.ObjectId | null;
	};
	const publicUser: PublicUser = {
		id: doc._id.toString(),
		name: doc.name,
		email: doc.email,
		role: doc.role,
		status: doc.status,
		department: doc.department ?? null,
		institution: doc.institution ?? null,
		programme: doc.programme ?? null,
		cohort: doc.cohort ?? null,
		universityId: doc.universityId ? doc.universityId.toString() : null,
		lastActiveAt: doc.lastActiveAt?.toISOString() ?? null,
		createdAt: doc.createdAt.toISOString(),
		features:
			doc.role === "admin"
				? { ...DEFAULT_UNIVERSITY_FEATURES }
				: await getFeaturesForUniversityId(doc.universityId ?? null),
	};
	const tokenQuota = await quotaForUserAsync(doc);
	if (tokenQuota) {
		publicUser.tokenQuota = tokenQuota;
	}
	return publicUser;
}

function validateEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function assertUniversityAccess(user: {
	role: string;
	universityId?: Types.ObjectId | null;
}) {
	if (user.role === "admin") return;
	const active = await isUniversityActive(user.universityId ?? null);
	if (!active) throw new Error(UNIVERSITY_NOT_ONBOARDED);
}

async function resolveRegistrationUniversity(input: {
	catalogueId?: string;
	institution?: string;
	country?: string;
}) {
	const catalogueId = input.catalogueId?.trim();
	if (!catalogueId) throw new Error("Please select your institution.");

	// Gate before any user write: only onboarded (active) universities may register.
	const university = await getActiveUniversityByCatalogueId(catalogueId);
	if (!university) throw new Error(UNIVERSITY_NOT_ONBOARDED);

	const requestedCountry = input.country?.trim().toUpperCase();
	const universityCountry = ((university as { country?: string }).country ?? "NG").toUpperCase();
	if (requestedCountry && requestedCountry !== universityCountry) {
		throw new Error("Selected institution does not match the chosen country.");
	}

	return {
		universityId: university._id,
		institution: university.name,
	};
}

export async function registerStudent(input: {
	name: string;
	email: string;
	password: string;
	department: string;
	institution?: string;
	catalogueId?: string;
	country?: string;
}) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const department = input.department.trim();

	if (name.length < 2) throw new Error("Please enter your full name.");
	if (!validateEmail(email)) throw new Error("Please enter a valid email address.");
	if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
	if (department.length < 2) throw new Error("Please enter your program or department.");

	const { universityId, institution } = await resolveRegistrationUniversity(input);

	const existing = await UserModel.findOne({ email }).select("+passwordHash");
	if (existing?.passwordHash) {
		throw new Error("An account with this email already exists.");
	}

	const passwordHash = await hashPassword(input.password);

	const user = existing
		? await UserModel.findByIdAndUpdate(
				existing._id,
				{
					name,
					passwordHash,
					department,
					institution,
					universityId,
					role: "student",
					status: "active",
					lastActiveAt: new Date(),
				},
				{ new: true },
			)
		: await UserModel.create({
				name,
				email,
				passwordHash,
				department,
				institution,
				universityId,
				role: "student",
				status: "active",
				lastActiveAt: new Date(),
			});

	if (!user) throw new Error("Registration failed.");

	await assertUniversityAccess(user);

	const token = signAuthToken({
		sub: user._id.toString(),
		email: user.email,
		role: user.role,
	});

	return { token, user: await toPublicUser(user) };
}

export async function registerLecturer(input: {
	name: string;
	email: string;
	password: string;
	department: string;
	institution?: string;
	catalogueId?: string;
	country?: string;
}) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const department = input.department.trim();

	if (name.length < 2) throw new Error("Please enter your full name.");
	if (!validateEmail(email)) throw new Error("Please enter a valid email address.");
	if (isFreeEmail(email)) throw new Error(LECTURER_FREE_EMAIL_ERROR);
	if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
	if (department.length < 2) throw new Error("Please enter your department or faculty.");

	const { universityId, institution } = await resolveRegistrationUniversity(input);

	const existing = await UserModel.findOne({ email }).select("+passwordHash");
	if (existing?.passwordHash) {
		throw new Error("An account with this email already exists.");
	}

	const passwordHash = await hashPassword(input.password);

	const user = existing
		? await UserModel.findByIdAndUpdate(
				existing._id,
				{
					name,
					passwordHash,
					department,
					institution,
					universityId,
					role: "lecturer",
					status: "active",
					lastActiveAt: new Date(),
				},
				{ new: true },
			)
		: await UserModel.create({
				name,
				email,
				passwordHash,
				department,
				institution,
				universityId,
				role: "lecturer",
				status: "active",
				lastActiveAt: new Date(),
			});

	if (!user) throw new Error("Registration failed.");

	await assertUniversityAccess(user);

	const token = signAuthToken({
		sub: user._id.toString(),
		email: user.email,
		role: user.role,
	});

	return { token, user: await toPublicUser(user) };
}

export async function loginUser(input: { email: string; password: string }) {
	const email = input.email.trim().toLowerCase();
	const user = await UserModel.findOne({ email }).select("+passwordHash");
	if (!user?.passwordHash) {
		throw new Error("Invalid email or password.");
	}

	const valid = await verifyPassword(input.password, user.passwordHash);
	if (!valid) throw new Error("Invalid email or password.");
	if (user.status !== "active") {
		throw new Error("Your account is inactive. Contact your administrator.");
	}

	await assertUniversityAccess(user);

	user.lastActiveAt = new Date();
	await user.save();

	const token = signAuthToken({
		sub: user._id.toString(),
		email: user.email,
		role: user.role,
	});

	return { token, user: await toPublicUser(user) };
}

export async function getUserById(id: string): Promise<PublicUser | null> {
	const user = await UserModel.findById(id);
	if (!user) return null;
	return toPublicUser(user);
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const GENERIC_RESET_MESSAGE =
	"If an account exists for that email, you will receive password reset instructions shortly.";

function hashResetToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a self-service password reset. Always returns a generic message to avoid email enumeration.
 * When email is not configured (local), includes `devResetUrl` outside production.
 */
export async function requestPasswordReset(input: {
	email: string;
}): Promise<{ message: string; devResetUrl?: string }> {
	const email = input.email.trim().toLowerCase();
	if (!validateEmail(email)) {
		return { message: GENERIC_RESET_MESSAGE };
	}

	const user = await UserModel.findOne({ email }).select(
		"+passwordHash +passwordResetTokenHash +passwordResetExpires",
	);
	if (!user?.passwordHash || user.status !== "active") {
		return { message: GENERIC_RESET_MESSAGE };
	}

	const rawToken = randomBytes(32).toString("hex");
	user.passwordResetTokenHash = hashResetToken(rawToken);
	user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
	await user.save();

	const resetUrl = `${getAppUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
	const text = [
		`Hi ${user.name},`,
		"",
		"We received a request to reset your Garil AI password.",
		"Open this link to choose a new password (expires in 1 hour):",
		resetUrl,
		"",
		"If you did not request this, you can ignore this email.",
	].join("\n");

	const html = `
		<p>Hi ${escapeHtml(user.name)},</p>
		<p>We received a request to reset your Garil AI password.</p>
		<p><a href="${resetUrl}">Choose a new password</a> (expires in 1 hour).</p>
		<p>If you did not request this, you can ignore this email.</p>
	`.trim();

	let delivered = false;
	try {
		const result = await sendMail({
			to: user.email,
			subject: "Reset your Garil AI password",
			text,
			html,
		});
		delivered = result.delivered;
	} catch (err) {
		console.error("[auth] Failed to send password reset email:", err);
		// Still expose the link in non-production so local recovery stays usable.
		if (process.env.NODE_ENV === "production") {
			throw new Error("Unable to send password reset email. Please try again later.");
		}
	}

	const response: { message: string; devResetUrl?: string } = {
		message: GENERIC_RESET_MESSAGE,
	};
	if (!delivered && process.env.NODE_ENV !== "production") {
		response.devResetUrl = resetUrl;
	}
	return response;
}

export async function resetPasswordWithToken(input: {
	token: string;
	password: string;
}): Promise<{ message: string }> {
	const token = input.token.trim();
	if (!token || token.length < 32) {
		throw new Error("Invalid or expired reset link.");
	}
	if (input.password.length < 8) {
		throw new Error("Password must be at least 8 characters.");
	}

	const tokenHash = hashResetToken(token);
	const user = await UserModel.findOne({
		passwordResetTokenHash: tokenHash,
		passwordResetExpires: { $gt: new Date() },
	}).select("+passwordHash +passwordResetTokenHash +passwordResetExpires");

	if (!user) {
		throw new Error("Invalid or expired reset link.");
	}
	if (user.status !== "active") {
		throw new Error("Your account is inactive. Contact your administrator.");
	}

	user.passwordHash = await hashPassword(input.password);
	await user.save();
	await UserModel.updateOne(
		{ _id: user._id },
		{ $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } },
	);

	return { message: "Password updated. You can sign in with your new password." };
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export { UNIVERSITY_NOT_ONBOARDED };
