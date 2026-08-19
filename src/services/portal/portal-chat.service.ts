import { NotFoundError, ForbiddenError } from "../../lib/portal-errors.js";
import { createAIProvider, hasLiveAiProvider } from "../../lib/portal-ai/provider.js";
import { projectRepository } from "./portal-project.repo.js";
import { chapterRepository } from "./portal-chapter.repo.js";
import { aiReviewRepository } from "./portal-ai.repo.js";

function stripHtml(html: string) {
	return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function scoreSnippet(query: string, text: string) {
	const terms = query
		.toLowerCase()
		.split(/\W+/)
		.filter((t) => t.length > 2);
	if (terms.length === 0) return 0;
	const hay = text.toLowerCase();
	return terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
}

export const aiChatService = {
	async chat(tenantId: string, projectId: string, studentId: string, message: string) {
		const project = await projectRepository.findById(tenantId, projectId);
		if (!project) throw new NotFoundError("Project not found");
		if (String(project.studentId) !== studentId) {
			throw new ForbiddenError("You can only chat about your own projects");
		}

		const pages = [...(project.pages || [])].sort(
			(a, b) => (a.order ?? 0) - (b.order ?? 0),
		);
		const chapters = await chapterRepository.listByProject(tenantId, projectId);
		const reviews = await aiReviewRepository.listByProject(tenantId, projectId);

		type Chunk = { source: string; text: string; score: number };
		const chunks: Chunk[] = [];

		for (const page of pages) {
			const text = stripHtml(String(page.content || ""));
			if (!text) continue;
			chunks.push({
				source: `Page: ${page.title}`,
				text: text.slice(0, 1200),
				score: scoreSnippet(message, text),
			});
		}

		for (const chapter of chapters) {
			const text = stripHtml(String(chapter.content || ""));
			if (!text) continue;
			chunks.push({
				source: chapter.title,
				text: text.slice(0, 1200),
				score: scoreSnippet(message, text),
			});
		}

		const top = chunks
			.filter((c) => c.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 3);
		const used = top.length > 0 ? top : chunks.slice(0, 2);
		const context = used
			.map((c, i) => `(${i + 1}) ${c.source}: ${c.text.slice(0, 500)}`)
			.join("\n\n");

		if (hasLiveAiProvider() && used.length > 0) {
			try {
				const provider = createAIProvider();
				const reply = await provider.complete([
					{
						role: "system",
						content:
							"You are a research writing assistant. Answer only from the student's project excerpts. Be concise.",
					},
					{
						role: "user",
						content: `Project: ${project.title}\n\nExcerpts:\n${context}\n\nQuestion: ${message}`,
					},
				]);
				return {
					reply,
					citations: used.map((c) => ({
						source: c.source,
						excerpt: c.text.slice(0, 400),
					})),
					model: "openrouter",
				};
			} catch {
				/* fall through to local answer */
			}
		}

		const lower = message.toLowerCase();
		let answer: string;
		if (/progress|status|how far/i.test(lower)) {
			answer = `Your project “${project.title}” is at ${project.progressPercent ?? 0}% progress with ${pages.length} page(s) and ${chapters.length} chapter(s). Topic status: ${project.topicStatus || "draft"}.`;
		} else if (/feedback|review|ai/i.test(lower) && reviews.length > 0) {
			const latest = reviews[0];
			const summary =
				(latest.report as { executiveSummary?: string } | undefined)?.executiveSummary ||
				"A review is available in your feedback inbox.";
			answer = `Latest AI review (${latest.status}): ${summary}`;
		} else if (used.length === 0) {
			answer =
				"I don’t have document content for this project yet. Add pages or import a document, then ask again.";
		} else {
			answer = `Based on your project documents:\n\n${context}\n\nSuggestion: refine the sections above for clarity and citations.`;
		}

		return {
			reply: answer,
			citations: used.map((c) => ({ source: c.source, excerpt: c.text.slice(0, 400) })),
			model: "grounded-local",
		};
	},
};
