import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to `backend/` */
export function getBackendRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Absolute path to repository root (parent of `backend/`, Next.js app at root) */
export function getRepoRoot(): string {
	return resolve(getBackendRoot(), "..");
}
