export type TokenUsage = {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
};

export function parseOpenRouterUsage(raw: unknown): TokenUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const usage = raw as Record<string, unknown>;
	const prompt = usage.prompt_tokens;
	const completion = usage.completion_tokens;
	const total = usage.total_tokens;
	if (typeof prompt !== "number" || !Number.isFinite(prompt)) return undefined;
	const completionTokens = typeof completion === "number" && Number.isFinite(completion) ? completion : 0;
	const totalTokens =
		typeof total === "number" && Number.isFinite(total) ? total : prompt + completionTokens;
	return { promptTokens: prompt, completionTokens, totalTokens };
}
