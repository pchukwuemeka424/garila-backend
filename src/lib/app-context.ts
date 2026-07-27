import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getWorkingDir } from "../config/env.js";
import { getBackendRoot } from "./paths.js";

export type AppContext = {
	backendRoot: string;
	version: string;
	workingDir: string;
};

export function createAppContext(): AppContext {
	const backendRoot = getBackendRoot();
	const raw = readFileSync(resolve(backendRoot, "package.json"), "utf8");
	const parsed = JSON.parse(raw) as { version?: string };
	return {
		backendRoot,
		version: parsed.version ?? "0.0.0",
		workingDir: getWorkingDir(),
	};
}
