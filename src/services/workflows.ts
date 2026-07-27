import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export type WorkflowSpec = {
	name: string;
	description: string;
	args: string;
	command: string;
};

function parseFrontmatter(text: string): Record<string, string> {
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return {};

	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key) frontmatter[key] = value;
	}
	return frontmatter;
}

export function listWorkflows(backendRoot: string): WorkflowSpec[] {
	const dir = resolve(backendRoot, "prompts");
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const raw = readFileSync(resolve(dir, file), "utf8");
			const fm = parseFrontmatter(raw);
			const name = file.replace(/\.md$/, "");
			return { name, fm };
		})
		.filter(({ fm }) => fm.topLevelCli === "true")
		.map(({ name, fm }) => ({
			name,
			description: fm.description ?? "",
			args: fm.args ?? "",
			command: `/${name}`,
		}));
}

export function loadWorkflowSystemPrompt(backendRoot: string, workflow: string, topic?: string): string {
	const path = resolve(backendRoot, "prompts", `${workflow.replace(/^\//, "")}.md`);
	const text = readFileSync(path, "utf8");
	const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
	const trimmedTopic = topic?.trim() ?? "";
	const bodyWithTopic = trimmedTopic ? body.replaceAll("$@", trimmedTopic) : body;
	const topicLine = trimmedTopic ? `\n\nTopic: ${trimmedTopic}` : "";
	return `${bodyWithTopic}${topicLine}`;
}
