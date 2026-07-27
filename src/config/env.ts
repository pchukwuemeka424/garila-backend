import { resolve } from "node:path";

import { getRepoRoot } from "../lib/paths.js";

export function getPort(): number {
	return Number.parseInt(process.env.PORT ?? "3141", 10);
}

export function getMongoUri(): string {
	return process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/feynman";
}

export function getWorkingDir(): string {
	const configured = process.env.FEYNMAN_WORKSPACE?.trim();
	if (configured) return resolve(configured);
	return getRepoRoot();
}

function parseOpenRouterModelSpec(spec: string): string {
	if (spec.startsWith("openrouter/")) {
		return spec.slice("openrouter/".length);
	}
	return spec;
}

export function getOpenRouterModel(): string {
	const spec = process.env.FEYNMAN_MODEL?.trim() || "openrouter/openai/gpt-5.1";
	return parseOpenRouterModelSpec(spec);
}

/** Faster/cheaper model for lightweight structured tasks (e.g. idea scoping). */
export function getOpenRouterFastModel(): string {
	const spec = process.env.FEYNMAN_FAST_MODEL?.trim() || "openrouter/openai/gpt-4o-mini";
	return parseOpenRouterModelSpec(spec);
}

/** Stronger model for full research outlines (defaults to the main chat model). */
export function getOpenRouterOutlineModel(): string {
	const spec =
		process.env.FEYNMAN_OUTLINE_MODEL?.trim() ||
		process.env.FEYNMAN_MODEL?.trim() ||
		"openrouter/openai/gpt-5.1";
	return parseOpenRouterModelSpec(spec);
}

export function getOpenRouterApiKey(): string {
	const key = process.env.OPENROUTER_API_KEY?.trim();
	if (!key) {
		throw new Error("OPENROUTER_API_KEY is not set. Add it to .env at the repo root.");
	}
	return key;
}

export function getAuthSecret(): string {
	const secret = process.env.AUTH_SECRET?.trim();
	if (secret) return secret;
	if (process.env.NODE_ENV === "production") {
		throw new Error("AUTH_SECRET is required in production.");
	}
	return "feynman-dev-auth-secret-change-in-production";
}

export function getAlphaXivApiBase(): string {
	return process.env.ALPHAXIV_API_BASE?.trim() || "https://api.alphaxiv.org";
}

export function getAlphaXivMcpUrl(): string {
	return process.env.ALPHAXIV_MCP_URL?.trim() || "https://api.alphaxiv.org/mcp/v1";
}

export function getAlphaXivApiKey(): string | null {
	return process.env.ALPHAXIV_API_KEY?.trim() || null;
}

export function isAlphaXivEnabled(): boolean {
	return process.env.ALPHAXIV_ENABLED !== "false";
}

export function getArxivApiUrl(): string {
	return process.env.ARXIV_API?.trim() || "https://export.arxiv.org/api/query";
}

export function getTavilyApiKey(): string | null {
	return process.env.TAVILY_API_KEY?.trim() || null;
}

export function isTavilyEnabled(): boolean {
	return process.env.TAVILY_ENABLED !== "false";
}

/** Local paper library RAG — check Mongo before AlphaXiv/arXiv/Tavily. */
export function isPaperLibraryEnabled(): boolean {
	return process.env.PAPER_LIBRARY_ENABLED !== "false";
}

/** Minimum library hits before skipping external literature APIs. */
export function getPaperLibraryMinHits(): number {
	const raw = Number.parseInt(process.env.PAPER_LIBRARY_MIN_HITS ?? "4", 10);
	if (!Number.isFinite(raw) || raw < 1) return 4;
	return Math.min(raw, 20);
}
