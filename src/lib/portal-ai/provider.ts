import { completeOpenRouterChat } from "../../services/llm.service.js";
import { getOpenRouterFastModel } from "../../config/env.js";

export type ChatMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};

export interface IAIProvider {
	complete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string>;
	embed(texts: string[]): Promise<number[][]>;
}

export class DeterministicAIProvider implements IAIProvider {
	async complete() {
		return JSON.stringify({
			executiveSummary: "Deterministic provider response",
			sections: [],
		});
	}
	async embed(texts: string[]) {
		return texts.map(() => Array.from({ length: 8 }, (_, i) => i * 0.01));
	}
}

export class OpenRouterProvider implements IAIProvider {
	async complete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string> {
		const result = await completeOpenRouterChat(messages, {
			model: getOpenRouterFastModel(),
			maxTokens: options?.json ? 4000 : 2500,
		});
		return result.text;
	}

	async embed(texts: string[]): Promise<number[][]> {
		return texts.map(() => Array.from({ length: 8 }, (_, i) => i * 0.01));
	}
}

export function createAIProvider(): IAIProvider {
	try {
		return new OpenRouterProvider();
	} catch {
		return new DeterministicAIProvider();
	}
}

export function hasLiveAiProvider(): boolean {
	return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}
