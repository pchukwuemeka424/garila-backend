import { createHash, randomBytes } from "node:crypto";

import { Types } from "mongoose";

import { getAppUrl } from "../config/env.js";
import type { StudentTokenQuota } from "../constants/student-tokens.js";
import { UserModel, type UserDocument } from "../db/models/User.js";
import { signAuthToken } from "../lib/auth-token.js";
import { isFreeEmail, LECTURER_FREE_EMAIL_ERROR } from "../lib/email.js";
import {
	buildPasswordChangedEmail,
	buildPasswordResetEmail,
} from "../lib/email-templates.js";
import { sendMail } from "../lib/mailer.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { POLICIES_REQUIRED_ERROR } from "../lib/policy-consent.js";
import {
	getActiveUniversityByCatalogueId,
	getFeaturesForUniversityId,
	isUniversityActive,
} from "./admin-universities.service.js";
import { DEFAULT_UNIVERSITY_FEATURES } from "../lib/university-features.js";
import { getAccountPolicyVersion } from "./legal-documents.service.js";
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
	policyVersion: string | null;
	needsPolicyAcceptance: boolean;
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
		policyVersion?: string | null;
	};
	const currentPolicyVersion = await getAccountPolicyVersion();
	const policyVersion = doc.policyVersion?.trim() || null;
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
		policyVersion,
		needsPolicyAcceptance: policyVersion !== currentPolicyVersion,
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

function assertPoliciesAccepted(acceptedPolicies: boolean | undefined) {
	if (acceptedPolicies !== true) {
		throw new Error(POLICIES_REQUIRED_ERROR);
	}
}

async function policyAcceptanceFields() {
	const now = new Date();
	const policyVersion = await getAccountPolicyVersion();
	return {
		termsAcceptedAt: now,
		privacyAcceptedAt: now,
		aupAcceptedAt: now,
		policyVersion,
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
	acceptedPolicies?: boolean;
}) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const department = input.department.trim();

	if (name.length < 2) throw new Error("Please enter your full name.");
	if (!validateEmail(email)) throw new Error("Please enter a valid email address.");
	if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
	if (department.length < 2) throw new Error("Please enter your program or department.");
	assertPoliciesAccepted(input.acceptedPolicies);

	const { universityId, institution } = await resolveRegistrationUniversity(input);

	const existing = await UserModel.findOne({ email }).select("+passwordHash");
	if (existing?.passwordHash) {
		throw new Error("An account with this email already exists.");
	}

	const passwordHash = await hashPassword(input.password);
	const policies = await policyAcceptanceFields();

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
					...policies,
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
				...policies,
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
	acceptedPolicies?: boolean;
}) {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const department = input.department.trim();

	if (name.length < 2) throw new Error("Please enter your full name.");
	if (!validateEmail(email)) throw new Error("Please enter a valid email address.");
	if (isFreeEmail(email)) throw new Error(LECTURER_FREE_EMAIL_ERROR);
	if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
	if (department.length < 2) throw new Error("Please enter your department or faculty.");
	assertPoliciesAccepted(input.acceptedPolicies);

	const { universityId, institution } = await resolveRegistrationUniversity(input);

	const existing = await UserModel.findOne({ email }).select("+passwordHash");
	if (existing?.passwordHash) {
		throw new Error("An account with this email already exists.");
	}

	const passwordHash = await hashPassword(input.password);
	const policies = await policyAcceptanceFields();

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
					...policies,
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
				...policies,
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

export async function acceptPolicies(userId: string): Promise<PublicUser> {
	const policies = await policyAcceptanceFields();
	const user = await UserModel.findByIdAndUpdate(userId, { $set: policies }, { new: true });
	if (!user) throw new Error("User not found.");
	return toPublicUser(user);
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_SENT_MESSAGE =
	"Password reset instructions have been sent to your email. Check your inbox and spam folder.";

function hashResetToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a self-service password reset.
 * When email is not configured (local), includes `devResetUrl` outside production.
 */
export async function requestPasswordReset(input: {
	email: string;
}): Promise<{ message: string; devResetUrl?: string }> {
	const email = input.email.trim().toLowerCase();
	if (!validateEmail(email)) {
		throw new Error("Enter a valid email address.");
	}

	const user = await UserModel.findOne({ email }).select(
		"+passwordHash +passwordResetTokenHash +passwordResetExpires",
	);
	if (!user?.passwordHash || user.status !== "active") {
		throw new Error("No account exists for that email.");
	}

	const rawToken = randomBytes(32).toString("hex");
	user.passwordResetTokenHash = hashResetToken(rawToken);
	user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
	await user.save();

	const resetUrl = `${getAppUrl()}/reset-password?token=${encodeURIComponent(rawToken)}`;
	const mail = buildPasswordResetEmail({ name: user.name, resetUrl });

	let delivered = false;
	try {
		const result = await sendMail({
			to: user.email,
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
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
		message: RESET_SENT_MESSAGE,
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

	try {
		const mail = buildPasswordChangedEmail({ name: user.name });
		await sendMail({
			to: user.email,
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		});
	} catch (err) {
		// Password already updated — do not fail the reset if notification email fails.
		console.error("[auth] Failed to send password-changed email:", err);
	}

	return { message: "Password updated. You can sign in with your new password." };
}

export { UNIVERSITY_NOT_ONBOARDED };
