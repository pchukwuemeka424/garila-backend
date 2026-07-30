import {
	getOpenRouterApiKey,
	getOpenRouterFastModel,
	getOpenRouterModel,
} from "../config/env.js";
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
	/** Override primary model (defaults to getOpenRouterModel). */
	model?: string;
	/** When true (default), retry transient failures and fall back to the fast model once. */
	resilient?: boolean;
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

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

/** Transient OpenRouter / network failures that are worth retrying. */
export function isTransientLlmError(error: unknown): boolean {
	if (isAbortError(error)) return false;
	const message = error instanceof Error ? error.message : String(error);
	if (/OpenRouter error (429|500|502|503|504)\b/i.test(message)) return true;
	if (/fetch failed|network|ECONNRESET|ETIMEDOUT|socket|timeout/i.test(message)) return true;
	return false;
}

function isBillingOrQuotaLlmError(message: string): boolean {
	return (
		/OpenRouter error 402\b/i.test(message) ||
		/insufficient credits/i.test(message) ||
		/Payment Required/i.test(message) ||
		/OpenRouter error 401\b/i.test(message) ||
		/OpenRouter error 403\b/i.test(message) ||
		/user not found\.?\s*please check your credits/i.test(message) ||
		/max_tokens.*remaining balance/i.test(message)
	);
}

/** Map provider/raw LLM failures to messages safe to show end users. */
export function friendlyLlmError(error: unknown): Error {
	if (isAbortError(error)) {
		return error instanceof Error ? error : new Error(String(error));
	}
	const message = error instanceof Error ? error.message : String(error);
	if (isBillingOrQuotaLlmError(message)) {
		return new Error("AI generation is temporarily unavailable. Please try again later.");
	}
	if (isTransientLlmError(error)) {
		return new Error("The AI model is busy or temporarily unavailable. Please try again.");
	}
	if (/OpenRouter error\b/i.test(message) || /openrouter\.ai/i.test(message)) {
		return new Error("AI generation failed. Please try again.");
	}
	return error instanceof Error ? error : new Error(String(error));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
			return;
		}
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function streamOpenRouterChatOnce(
	messages: ChatTurn[],
	handlers: StreamHandlers,
	model: string,
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
			model,
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

/**
 * Stream a chat completion. With resilient mode (default), retries transient
 * failures twice with backoff, then once with the configured fast model.
 */
export async function streamOpenRouterChat(
	messages: ChatTurn[],
	handlers: StreamHandlers,
): Promise<StreamChatResult> {
	const resilient = handlers.resilient !== false;
	const primary = handlers.model ?? getOpenRouterModel();
	const fallback = getOpenRouterFastModel();
	const models = resilient && fallback !== primary ? [primary, primary, primary, fallback] : [primary];

	let lastError: unknown;
	for (let attempt = 0; attempt < models.length; attempt++) {
		const model = models[attempt]!;
		try {
			return await streamOpenRouterChatOnce(messages, handlers, model);
		} catch (error) {
			lastError = error;
			if (isAbortError(error)) throw error;
			if (!resilient) throw friendlyLlmError(error);
			if (!isTransientLlmError(error)) throw friendlyLlmError(error);
			if (attempt >= models.length - 1) break;
			const delayMs = 800 * 2 ** attempt;
			await sleep(delayMs, handlers.signal);
		}
	}

	throw friendlyLlmError(lastError);
}

export type CompleteChatResult = {
	text: string;
	usage?: TokenUsage;
};

export async function completeOpenRouterChat(
	messages: ChatTurn[],
	options?: { signal?: AbortSignal; maxTokens?: number; model?: string; resilient?: boolean },
): Promise<CompleteChatResult> {
	const resilient = options?.resilient !== false;
	const primary = options?.model ?? getOpenRouterModel();
	const fallback = getOpenRouterFastModel();
	const models = resilient && fallback !== primary ? [primary, primary, primary, fallback] : [primary];

	let lastError: unknown;
	for (let attempt = 0; attempt < models.length; attempt++) {
		const model = models[attempt]!;
		try {
			const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${getOpenRouterApiKey()}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "http://localhost:3141",
					"X-Title": "GARIL AI",
				},
				body: JSON.stringify({
					model,
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
		} catch (error) {
			lastError = error;
			if (isAbortError(error)) throw error;
			if (!resilient) throw friendlyLlmError(error);
			if (!isTransientLlmError(error)) throw friendlyLlmError(error);
			if (attempt >= models.length - 1) break;
			await sleep(800 * 2 ** attempt, options?.signal);
		}
	}

	throw friendlyLlmError(lastError);
}
