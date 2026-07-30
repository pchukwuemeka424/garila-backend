import { getOpenRouterApiKey, getOpenRouterModel } from "../config/env.js";
import { parseOpenRouterUsage, type TokenUsage } from "../types/token-usage.js";

export type ChatRole = "system" | "user" | "assistant";

export type ChatTurn = {
	role: ChatRole;
	content: string;
};

export type { TokenUsage };

export type StreamChatResult = {
	text: string;
	usage?: TokenUsage;
};

type StreamHandlers = {
	onDelta: (delta: string) => void;
	signal?: AbortSignal;
	maxTokens?: number;
};

function parseSseLine(line: string): { delta?: string; done?: boolean; usage?: TokenUsage } {
	if (!line.startsWith("data: ")) return {};
	const payload = line.slice(6).trim();
	if (payload === "[DONE]") return { done: true };
	try {
		const parsed = JSON.parse(payload) as {
			choices?: Array<{ delta?: { content?: string } }>;
			usage?: unknown;
		};
		const delta = parsed.choices?.[0]?.delta?.content;
		const usage = parseOpenRouterUsage(parsed.usage);
		if (typeof delta === "string") return { delta, usage };
		if (usage) return { usage };
		return {};
	} catch {
		return {};
	}
}

export async function streamOpenRouterChat(
	messages: ChatTurn[],
	handlers: StreamHandlers,
): Promise<StreamChatResult> {
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${getOpenRouterApiKey()}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "http://localhost:3141",
			"X-Title": "GARIL AI",
		},
		body: JSON.stringify({
			model: getOpenRouterModel(),
			messages,
			stream: true,
			...(handlers.maxTokens ? { max_tokens: handlers.maxTokens } : {}),
		}),
		signal: handlers.signal,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`OpenRouter error ${response.status}: ${body.slice(0, 500)}`);
	}

	if (!response.body) {
		throw new Error("OpenRouter returned an empty response body.");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let fullText = "";
	let usage: TokenUsage | undefined;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const { delta, done: streamDone, usage: lineUsage } = parseSseLine(line);
			if (lineUsage) usage = lineUsage;
			if (delta) {
				fullText += delta;
				handlers.onDelta(delta);
			}
			if (streamDone) {
				return { text: fullText, usage };
			}
		}
	}

	return { text: fullText, usage };
}

export type CompleteChatResult = {
	text: string;
	usage?: TokenUsage;
};

export async function completeOpenRouterChat(
	messages: ChatTurn[],
	options?: { signal?: AbortSignal; maxTokens?: number; model?: string },
): Promise<CompleteChatResult> {
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${getOpenRouterApiKey()}`,
			"Content-Type": "application/json",
			"HTTP-Referer": "http://localhost:3141",
			"X-Title": "GARIL AI",
		},
		body: JSON.stringify({
			model: options?.model ?? getOpenRouterModel(),
			messages,
			stream: false,
			...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
		}),
		signal: options?.signal,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`OpenRouter error ${response.status}: ${body.slice(0, 500)}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		usage?: unknown;
	};

	const content = payload.choices?.[0]?.message?.content?.trim();
	if (!content) {
		throw new Error("OpenRouter returned an empty completion.");
	}

	return { text: content, usage: parseOpenRouterUsage(payload.usage) };
}
