import { config } from "dotenv";
import { resolve } from "node:path";

import { getPort } from "./config/env.js";
import { getBackendRoot, getRepoRoot } from "./lib/paths.js";
import { ensureSupportedNodeVersion } from "./system/node-version.js";

config({ path: resolve(getRepoRoot(), ".env") });
config({ path: resolve(getBackendRoot(), ".env") });

async function run(): Promise<void> {
	ensureSupportedNodeVersion();
	const { startServer } = await import("./server.js");
	await startServer(getPort());
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
