import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type OutputEntry = {
	path: string;
	name: string;
	kind: "file" | "directory";
	size?: number;
	modified?: string;
};

function walkOutputs(root: string, dir: string, base: string): OutputEntry[] {
	const entries: OutputEntry[] = [];
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return entries;
	}

	for (const name of names) {
		if (name.startsWith(".")) continue;
		const full = join(dir, name);
		const rel = relative(base, full);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			entries.push({ path: rel, name, kind: "directory", modified: stat.mtime.toISOString() });
			entries.push(...walkOutputs(root, full, base));
		} else {
			entries.push({
				path: rel,
				name,
				kind: "file",
				size: stat.size,
				modified: stat.mtime.toISOString(),
			});
		}
	}
	return entries;
}

export function listOutputs(workingDir: string): OutputEntry[] {
	const outputsRoot = resolve(workingDir, "outputs");
	const papersRoot = resolve(workingDir, "papers");
	const notesRoot = resolve(workingDir, "notes");

	const all: OutputEntry[] = [];
	for (const [label, root] of [
		["outputs", outputsRoot],
		["papers", papersRoot],
		["notes", notesRoot],
	] as const) {
		try {
			statSync(root);
		} catch {
			continue;
		}
		const items = walkOutputs(root, root, root).map((entry) => ({
			...entry,
			path: `${label}/${entry.path}`,
		}));
		all.push(...items);
	}

	return all.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
}

export function readOutputFile(workingDir: string, relativePath: string): { content: string; path: string } {
	const normalized = relativePath.replace(/^\/+/, "");
	if (normalized.includes("..")) {
		throw new Error("Invalid path.");
	}

	const allowedRoots = ["outputs", "papers", "notes"].map((segment) => resolve(workingDir, segment));
	const fullPath = resolve(workingDir, normalized);
	const allowed = allowedRoots.some((root) => fullPath === root || fullPath.startsWith(`${root}/`));
	if (!allowed) {
		throw new Error("Path is outside allowed artifact directories.");
	}

	const stat = statSync(fullPath);
	if (!stat.isFile()) {
		throw new Error("Not a file.");
	}
	if (stat.size > 2_000_000) {
		throw new Error("File is too large to display (max 2MB).");
	}

	return {
		path: normalized,
		content: readFileSync(fullPath, "utf8"),
	};
}
