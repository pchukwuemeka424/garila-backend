import { resolve } from "node:path";
import { existsSync } from "node:fs";

import { getBackendRoot, getRepoRoot, isMonorepoLayout } from "../lib/paths.js";

export function getPort(): number {
	return Number.parseInt(process.env.PORT ?? "3141", 10);
}

export function getMongoUri(): string {
	const configured = process.env.MONGODB_URI?.trim();
	if (configured) return configured;

	const fallback = "mongodb://127.0.0.1:27017/feynman";
	const inDocker = existsSync("/.dockerenv");
	if (process.env.NODE_ENV === "production" || inDocker) {
		throw new Error(
			[
				"MONGODB_URI is required in production/Docker.",
				"In Coolify: Environment → add MONGODB_URI pointing at your MongoDB resource",
				"(e.g. mongodb://USER:PASS@HOST:27017/feynman). Do not use 127.0.0.1 inside a container.",
			].join(" "),
		);
	}
	return fallback;
}

export function getWorkingDir(): string {
	const configured = process.env.FEYNMAN_WORKSPACE?.trim();
	if (configured) return resolve(configured);
	// Monorepo: Next/export workspace at repo root. Standalone API: backend package root.
	if (isMonorepoLayout()) return getRepoRoot();
	return getBackendRoot();
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
		throw new Error("OPENROUTER_API_KEY is not set. Add it to backend/.env.");
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

/** Public web app origin used in password-reset emails (no trailing slash). */
export function getAppUrl(): string {
	const configured = process.env.APP_URL?.trim() || process.env.FRONTEND_URL?.trim();
	if (configured) return configured.replace(/\/$/, "");
	if (process.env.NODE_ENV === "production") {
		return "https://garilai.com";
	}
	return "http://localhost:3000";
}

export function getResendApiKey(): string | null {
	return process.env.RESEND_API_KEY?.trim() || null;
}

export function getMailFrom(): string {
	return process.env.MAIL_FROM?.trim() || "Garil AI <noreply@garilai.com>";
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

export function getHuggingFaceToken(): string | null {
	return process.env.HF_TOKEN?.trim() || process.env.HUGGINGFACE_API_KEY?.trim() || null;
}

export function isHuggingFaceEnabled(): boolean {
	return process.env.HUGGINGFACE_ENABLED !== "false" && Boolean(getHuggingFaceToken());
}

export function getHuggingFaceEmbedModel(): string {
	return process.env.HUGGINGFACE_EMBED_MODEL?.trim() || "sentence-transformers/all-MiniLM-L6-v2";
}

export function getHuggingFaceNliModel(): string {
	return (
		process.env.HUGGINGFACE_NLI_MODEL?.trim() ||
		"MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
	);
}

export function getOpenAlexApiKey(): string | null {
	return process.env.OPENALEX_API_KEY?.trim() || null;
}

export function getOpenAlexApiBase(): string {
	return process.env.OPENALEX_API_BASE?.trim() || "https://api.openalex.org";
}

export function isOpenAlexEnabled(): boolean {
	return process.env.OPENALEX_ENABLED !== "false";
}

export function getPubmedApiKey(): string | null {
	return process.env.PUBMED_API_KEY?.trim() || process.env.NCBI_API_KEY?.trim() || null;
}

export function getPubmedApiBase(): string {
	return (
		process.env.PUBMED_API_BASE?.trim() ||
		"https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
	);
}

export function isPubmedEnabled(): boolean {
	return process.env.PUBMED_ENABLED !== "false";
}

export function getDoajApiBase(): string {
	return process.env.DOAJ_API_BASE?.trim() || "https://doaj.org/api";
}

export function isDoajEnabled(): boolean {
	return process.env.DOAJ_ENABLED !== "false";
}

export function getEuropePmcApiBase(): string {
	return (
		process.env.EUROPE_PMC_API_BASE?.trim() ||
		"https://www.ebi.ac.uk/europepmc/webservices/rest"
	);
}

export function isEuropePmcEnabled(): boolean {
	return process.env.EUROPE_PMC_ENABLED !== "false";
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

/** S3-compatible storage (MinIO / AWS). Optional — disabled when endpoint or keys are missing. */
export type S3Config = {
	endpoint: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	forcePathStyle: boolean;
	publicUrl: string | null;
};

export function getS3Endpoint(): string | null {
	return process.env.S3_ENDPOINT?.trim() || null;
}

export function getS3Region(): string {
	return process.env.S3_REGION?.trim() || "us-east-1";
}

export function getS3Bucket(): string {
	return process.env.S3_BUCKET?.trim() || "garil";
}

export function getS3AccessKey(): string | null {
	return process.env.S3_ACCESS_KEY?.trim() || null;
}

export function getS3SecretKey(): string | null {
	return process.env.S3_SECRET_KEY?.trim() || null;
}

export function isS3ForcePathStyle(): boolean {
	return process.env.S3_FORCE_PATH_STYLE !== "false";
}

/** Optional CDN / public base URL for objects (defaults to endpoint). */
export function getS3PublicUrl(): string | null {
	return process.env.S3_PUBLIC_URL?.trim() || null;
}

export function isS3Enabled(): boolean {
	return Boolean(getS3Endpoint() && getS3AccessKey() && getS3SecretKey());
}

/** Max object size for direct MinIO uploads (default 2 GiB). */
export function getS3MaxUploadBytes(): number {
	const raw = Number.parseInt(process.env.S3_MAX_UPLOAD_BYTES ?? String(2 * 1024 * 1024 * 1024), 10);
	if (!Number.isFinite(raw) || raw < 1) return 2 * 1024 * 1024 * 1024;
	return raw;
}

/** Max bytes the API will load into memory (data-URL / graph / AI context). */
export function getS3MaxInlineBytes(): number {
	const raw = Number.parseInt(process.env.S3_MAX_INLINE_BYTES ?? String(32 * 1024 * 1024), 10);
	if (!Number.isFinite(raw) || raw < 1) return 32 * 1024 * 1024;
	return raw;
}

export function getS3Config(): S3Config {
	const endpoint = getS3Endpoint();
	const accessKeyId = getS3AccessKey();
	const secretAccessKey = getS3SecretKey();
	if (!endpoint || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"S3 is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, and S3_SECRET_KEY in .env.",
		);
	}
	return {
		endpoint: endpoint.replace(/\/$/, ""),
		region: getS3Region(),
		bucket: getS3Bucket(),
		accessKeyId,
		secretAccessKey,
		forcePathStyle: isS3ForcePathStyle(),
		publicUrl: getS3PublicUrl()?.replace(/\/$/, "") || null,
	};
}
