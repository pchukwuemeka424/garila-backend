import { config } from "dotenv";
import { resolve } from "node:path";

import { getPort } from "./config/env.js";
import { getBackendRoot, getRepoRoot } from "./lib/paths.js";
import { ensureSupportedNodeVersion } from "./system/node-version.js";

// Coolify/Docker inject process.env; local secrets live in backend/.env.
const dotenvOpts = { quiet: true } as const;
config({ path: resolve(getBackendRoot(), ".env"), ...dotenvOpts });
config({ path: resolve(process.cwd(), ".env"), ...dotenvOpts });
config({ path: resolve(getRepoRoot(), ".env"), ...dotenvOpts });

async function run(): Promise<void> {
	ensureSupportedNodeVersion();
	const { startServer } = await import("./server.js");
	await startServer(getPort());
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
