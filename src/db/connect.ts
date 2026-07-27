import mongoose from "mongoose";

import { getMongoUri } from "../config/env.js";
import { PaperLibraryModel } from "./models/PaperLibrary.js";
import { ResearchProjectModel } from "./models/ResearchProject.js";

let connected = false;

export async function connectMongo(): Promise<void> {
	if (connected) return;
	await mongoose.connect(getMongoUri());
	connected = true;
	await ensureResearchProjectIndexes();
	await ensurePaperLibraryIndexes();
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
