import { createHmac, timingSafeEqual } from "node:crypto";

import { getAuthSecret } from "../config/env.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthTokenPayload = {
	sub: string;
	email: string;
	role: string;
	exp: number;
};

function base64UrlEncode(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
	return Buffer.from(value, "base64url").toString("utf8");
}

export function signAuthToken(payload: Omit<AuthTokenPayload, "exp">): string {
	const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64UrlEncode(
		JSON.stringify({
			...payload,
			exp: Date.now() + TOKEN_TTL_MS,
		} satisfies AuthTokenPayload),
	);
	const signature = createHmac("sha256", getAuthSecret())
		.update(`${header}.${body}`)
		.digest("base64url");
	return `${header}.${body}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [header, body, signature] = parts;
	const expected = createHmac("sha256", getAuthSecret())
		.update(`${header}.${body}`)
		.digest("base64url");

	const sigBuf = Buffer.from(signature, "utf8");
	const expectedBuf = Buffer.from(expected, "utf8");
	if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
		return null;
	}

	try {
		const payload = JSON.parse(base64UrlDecode(body)) as AuthTokenPayload;
		if (!payload.sub || !payload.email || !payload.exp || payload.exp < Date.now()) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}

export function extractBearerToken(header: string | undefined): string | null {
	if (!header?.startsWith("Bearer ")) return null;
	const token = header.slice("Bearer ".length).trim();
	return token || null;
}
