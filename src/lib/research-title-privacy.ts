import { createHmac } from "node:crypto";

import { getAuthSecret } from "../config/env.js";

/** Roles whose research titles must never appear in plaintext on university /admin. */
const PROTECTED_OWNER_ROLES = new Set(["lecturer", "researcher", "student"]);

export function shouldEncryptResearchTitle(ownerRole?: string | null): boolean {
	if (!ownerRole) return true;
	return PROTECTED_OWNER_ROLES.has(ownerRole);
}

export function encryptResearchTitleForAdmin(
	title: string,
	ownerId?: string | null,
	universityId?: string | null,
): string {
	const hmac = createHmac("sha256", getAuthSecret());
	hmac.update(`${universityId ?? ""}|${ownerId ?? ""}|${title.trim()}`);
	const digest = hmac.digest("hex").slice(0, 8);
	return `Encrypted research title · ${digest}`;
}

export function redactTitleInText(
	text: string,
	title: string,
	ownerId?: string | null,
	universityId?: string | null,
): string {
	const trimmed = title.trim();
	if (!trimmed || !text.includes(trimmed)) return text;
	return text.split(trimmed).join(encryptResearchTitleForAdmin(trimmed, ownerId, universityId));
}
