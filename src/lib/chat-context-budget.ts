/** Conservative token estimate for OpenAI-style tokenizers (academic prose + JSON). */
export function estimateTokens(text: string): number {
	const chars = text?.length ?? 0;
	if (!chars) return 0;
	return Math.ceil(chars / 3.5);
}

export function estimateMessagesTokens(messages: Array<{ content: string }>): number {
	// Per-message framing overhead.
	return messages.reduce((sum, turn) => sum + estimateTokens(turn.content) + 6, 8);
}

const MODEL_CONTEXT_LIMIT = 128_000;
const SAFETY_MARGIN = 2_500;

/** Sections we can shrink first when the paper prompt is too large. */
const TRIM_SECTIONS: Array<{ heading: RegExp; keepChars: number }> = [
	{
		heading: /\*\*Canonical tables\s*\/\s*figure list\*\*/i,
		keepChars: 6_000,
	},
	{
		heading: /\*\*Selected research library\*\*/i,
		keepChars: 28_000,
	},
	{
		heading: /\*\*Approved research outline\*\*/i,
		keepChars: 10_000,
	},
];

function nextSectionIndex(content: string, from: number): number {
	const rest = content.slice(from);
	const match = rest.search(/\n\*\*[^*\n]{3,80}\*\*\s*\n/);
	return match >= 0 ? from + match : content.length;
}

function shrinkSection(content: string, heading: RegExp, keepChars: number): string {
	const match = heading.exec(content);
	if (!match || match.index == null) return content;
	const start = match.index;
	const bodyStart = start + match[0].length;
	const end = nextSectionIndex(content, bodyStart);
	const body = content.slice(bodyStart, end).trim();
	if (body.length <= keepChars) return content;
	const clipped = `${body.slice(0, keepChars).trimEnd()}\n\n[Truncated to fit the model context window.]`;
	return `${content.slice(0, bodyStart)}\n\n${clipped}\n${content.slice(end)}`;
}

function shrinkUserContent(content: string, targetChars: number): string {
	let next = content;
	for (const section of TRIM_SECTIONS) {
		if (next.length <= targetChars) break;
		next = shrinkSection(next, section.heading, section.keepChars);
	}
	if (next.length > targetChars) {
		next = `${next.slice(0, Math.max(4_000, targetChars)).trimEnd()}\n\n[Prompt truncated to fit the model context window.]`;
	}
	return next;
}

/**
 * Ensure messages + completion reservation fit a 128k model window.
 * Shrinks the largest user turn first; may also reduce maxTokens.
 */
export function fitChatToModelContext(
	messages: Array<{ role: string; content: string }>,
	requestedMaxTokens: number | undefined,
): { messages: Array<{ role: string; content: string }>; maxTokens?: number } {
	const requested = Math.max(1_024, requestedMaxTokens ?? 8_000);
	let maxTokens = Math.min(requested, 16_000);
	let next = messages.map((turn) => ({ ...turn }));

	const budgetForMessages = () => MODEL_CONTEXT_LIMIT - maxTokens - SAFETY_MARGIN;

	for (let pass = 0; pass < 6; pass += 1) {
		const used = estimateMessagesTokens(next);
		const budget = budgetForMessages();
		if (used <= budget) {
			return { messages: next, maxTokens: requestedMaxTokens ? maxTokens : undefined };
		}

		const overflowTokens = used - budget;
		const overflowChars = Math.ceil(overflowTokens * 3.5) + 2_000;
		const userIndex = (() => {
			for (let i = next.length - 1; i >= 0; i -= 1) {
				if (next[i]?.role === "user") return i;
			}
			return -1;
		})();

		if (userIndex >= 0) {
			const user = next[userIndex]!;
			const targetChars = Math.max(8_000, user.content.length - overflowChars);
			const shrunk = shrinkUserContent(user.content, targetChars);
			if (shrunk.length < user.content.length) {
				next[userIndex] = { ...user, content: shrunk };
				continue;
			}
		}

		// Still over: steal from completion budget.
		maxTokens = Math.max(2_048, maxTokens - Math.ceil(overflowTokens * 0.6));
	}

	// Last resort hard clip on the user message.
	const userIndex = next.map((t) => t.role).lastIndexOf("user");
	if (userIndex >= 0) {
		const budgetChars = Math.floor(budgetForMessages() * 3.2);
		const systemChars = next
			.filter((t) => t.role === "system")
			.reduce((sum, t) => sum + t.content.length, 0);
		const allow = Math.max(6_000, budgetChars - systemChars - 1_000);
		const user = next[userIndex]!;
		if (user.content.length > allow) {
			next[userIndex] = {
				...user,
				content: `${user.content.slice(0, allow).trimEnd()}\n\n[Prompt truncated to fit the model context window.]`,
			};
		}
	}

	return { messages: next, maxTokens };
}
