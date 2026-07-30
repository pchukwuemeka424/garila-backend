import { getOpenRouterModel } from "../../config/env.js";
import { completeOpenRouterChat, type ChatTurn } from "../llm.service.js";
import type { ChatMessage } from "./types.js";

/**
 * Research Note AI — uses the same OpenRouter stack as the rest of GARIL AI
 * (`llm.service` + `OPENROUTER_API_KEY` / `FEYNMAN_MODEL`). No BYO keys or
 * per-user provider config.
 */
interface GenerateBody {
	system?: string;
	messages?: ChatMessage[];
	maxTokens?: number;
	temperature?: number;
}

export async function handleGenerate(request: Request): Promise<Response> {
	if (request.method !== "POST") {
		return json({ error: "Method not allowed" }, 405);
	}

	let body: GenerateBody;
	try {
		body = (await request.json()) as GenerateBody;
	} catch {
		return json({ error: "Invalid JSON body" }, 400);
	}

	if (!body.messages?.length) {
		return json({ error: "Missing messages" }, 400);
	}

	const messages: ChatTurn[] = [];
	if (body.system?.trim()) {
		messages.push({ role: "system", content: body.system.trim() });
	}
	for (const msg of body.messages) {
		if (msg.role !== "user" && msg.role !== "assistant") continue;
		const content = typeof msg.content === "string" ? msg.content : "";
		if (!content.trim()) continue;
		messages.push({ role: msg.role, content });
	}
	if (!messages.some((m) => m.role === "user")) {
		return json({ error: "Missing user message" }, 400);
	}

	try {
		const result = await completeOpenRouterChat(messages, {
			maxTokens: body.maxTokens,
		});
		return json(
			{
				text: result.text,
				provider: "openrouter",
				model: getOpenRouterModel(),
			},
			200,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : "Generation failed";
		const status = /OPENROUTER_API_KEY/i.test(message) ? 503 : 502;
		return json({ error: message }, status);
	}
}

function json(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}
