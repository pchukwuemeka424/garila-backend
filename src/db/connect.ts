import mongoose from "mongoose";

import { getMongoUri } from "../config/env.js";
import { PaperLibraryModel } from "./models/PaperLibrary.js";
import { ResearchProjectModel } from "./models/ResearchProject.js";

let connected = false;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMongoError(error: unknown, uri: string): string {
	const message = error instanceof Error ? error.message : String(error);
	const looksLocal =
		uri.includes("127.0.0.1") || uri.includes("localhost") || uri.includes("0.0.0.0");
	if (looksLocal && /ECONNREFUSED/i.test(message)) {
		return [
			`MongoDB connection failed: ${message}`,
			"The URI points at localhost, which is wrong inside Coolify/Docker.",
			"Set MONGODB_URI to your Coolify MongoDB service URL",
			"(Connection → MongoDB resource hostname, not 127.0.0.1).",
		].join(" ");
	}
	return `MongoDB connection failed: ${message}`;
}

export async function connectMongo(options?: { retries?: number; delayMs?: number }): Promise<void> {
	if (connected) return;

	const retries = options?.retries ?? (process.env.NODE_ENV === "production" ? 12 : 1);
	const delayMs = options?.delayMs ?? 2500;
	const uri = getMongoUri();

	let lastError: unknown;
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			await mongoose.connect(uri, {
				serverSelectionTimeoutMS: 5000,
			});
			connected = true;
			await ensureResearchProjectIndexes();
			await ensurePaperLibraryIndexes();
			if (attempt > 1) {
				console.log(`MongoDB connected after ${attempt} attempts.`);
			}
			return;
		} catch (error) {
			lastError = error;
			await mongoose.disconnect().catch(() => undefined);
			if (attempt < retries) {
				console.warn(
					`MongoDB not ready (attempt ${attempt}/${retries}): ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				await sleep(delayMs);
			}
		}
	}

	throw new Error(formatMongoError(lastError, uri));
}

/** Drop legacy unique userId index so users can own multiple research folders. */
async function ensureResearchProjectIndexes(): Promise<void> {
	try {
		const indexes = await ResearchProjectModel.collection.indexes();
		for (const idx of indexes) {
			const key = idx.key as Record<string, number> | undefined;
			if (!key) continue;
			const keys = Object.keys(key);
			if (keys.length === 1 && keys[0] === "userId" && idx.unique) {
				await ResearchProjectModel.collection.dropIndex(idx.name as string);
			}
		}
		await ResearchProjectModel.syncIndexes();
	} catch {
		/* ignore — empty local DBs without the collection/index are fine */
	}
}

async function ensurePaperLibraryIndexes(): Promise<void> {
	try {
		await PaperLibraryModel.syncIndexes();
	} catch {
		/* ignore — empty local DBs without the collection/index are fine */
	}
}

export async function disconnectMongo(): Promise<void> {
	if (!connected) return;
	await mongoose.disconnect();
	connected = false;
}
