import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the backend package root (contains `package.json`, `prompts/`, `dist/`). */
export function getBackendRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * True when this backend lives inside the GARIL monorepo (`…/backend` next to the Next app).
 * Standalone clones (e.g. garila-backend) are the package root themselves.
 */
export function isMonorepoLayout(backendRoot = getBackendRoot()): boolean {
	if (basename(backendRoot) !== "backend") return false;
	const parent = resolve(backendRoot, "..");
	return (
		existsSync(resolve(parent, "package.json")) ||
		existsSync(resolve(parent, "deploy")) ||
		existsSync(resolve(parent, "next.config.ts")) ||
		existsSync(resolve(parent, "next.config.js"))
	);
}

/**
 * Monorepo: parent of `backend/`.
 * Standalone / Docker API image: same as `getBackendRoot()`.
 * Override with `FEYNMAN_REPO_ROOT` when needed.
 */
export function getRepoRoot(): string {
	const configured = process.env.FEYNMAN_REPO_ROOT?.trim();
	if (configured) return resolve(configured);

	const backendRoot = getBackendRoot();
	if (isMonorepoLayout(backendRoot)) {
		return resolve(backendRoot, "..");
	}
	return backendRoot;
}
