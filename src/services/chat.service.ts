import { randomUUID } from "node:crypto";
import { Types } from "mongoose";

import { getOpenRouterModel } from "../config/env.js";
import { MessageModel } from "../db/models/Message.js";
import { SessionModel } from "../db/models/Session.js";
import { UserModel } from "../db/models/User.js";
import type { AppContext } from "../lib/app-context.js";
import {
	getScopeProfile,
	literatureBankFetchLimit,
	parseScopeFromPrompt,
} from "../lib/research-scope-profiles.js";
import {
	buildLiteratureSearchQuery,
	buildPaperSearchContext,
	parseDisciplineFromPrompt,
	shouldUseAlphaXiv,
	type AlphaXivPaper,
	type RetrievalProtocol,
} from "./alphaxiv.service.js";
import { alignCitationsAndFactCheck } from "./citation-align.service.js";
import { parseCitationStyleLabel } from "../lib/citation-bank.js";
import { evaluatePolicy } from "./admin-policy.service.js";
import type { TokenUsage } from "../types/token-usage.js";
import { streamOpenRouterChat, type ChatTurn } from "./llm.service.js";
import { formatResearchPaperReferences } from "./research-paper-format.service.js";
import { saveResearchPaper } from "./research.service.js";
import {
	assertStudentHasTokenBalance,
	deductStudentTokens,
} from "./student-token.service.js";
import { loadWorkflowSystemPrompt } from "./workflows.js";

export type ChatState = "idle" | "starting" | "running" | "error";

type Subscriber = (payload: Record<string, unknown>) => void;

export class ChatService {
	private sessionId: Types.ObjectId | null = null;
	private state: ChatState = "idle";
	private lastError: string | null = null;
	private abortController: AbortController | null = null;
	private lastSavedResearchId: string | null = null;
	private literatureBank: AlphaXivPaper[] = [];
	private literatureProtocol: RetrievalProtocol | undefined;
	private readonly subscribers = new Set<Subscriber>();

	constructor(private readonly ctx: AppContext) {}

	getLastSavedResearchId(): string | null {
		return this.lastSavedResearchId;
	}

	subscribe(listener: Subscriber): () => void {
		this.subscribers.add(listener);
		return () => this.subscribers.delete(listener);
	}

	private emit(payload: Record<string, unknown>): void {
		for (const listener of this.subscribers) {
			listener(payload);
		}
	}

	private setState(next: ChatState, error?: string): void {
		this.state = next;
		this.lastError = error ?? null;
		if (this.sessionId) {
			void SessionModel.findByIdAndUpdate(this.sessionId, {
				state: next,
				error: this.lastError,
			}).catch(() => undefined);
		}
		this.emit({ type: "status", state: next, error: this.lastError });
	}

	getStatus() {
		return {
			state: this.state,
			error: this.lastError,
			model: process.env.FEYNMAN_MODEL ?? `openrouter/${getOpenRouterModel()}`,
			workingDir: this.ctx.workingDir,
			sessionId: this.sessionId?.toString() ?? null,
		};
	}

	async resetSession(options?: {
		workflow?: string;
		topic?: string;
		prompt?: string;
		userId?: string;
	}): Promise<void> {
		await this.abort();
		this.lastSavedResearchId = null;
		this.literatureBank = [];
		this.literatureProtocol = undefined;
		this.setState("starting");

		const workflow = options?.workflow?.replace(/^\//, "");
		const topic = options?.topic?.trim();
		let systemPrompt =
			"You are GARIL AI, a research-first AI assistant. Be thorough, cite sources when possible, and write durable artifacts under outputs/, papers/, and notes/ when asked to research.";

		if (workflow) {
			try {
				systemPrompt = loadWorkflowSystemPrompt(this.ctx.backendRoot, workflow, topic);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.setState("error", message);
				throw error;
			}
		} else if (options?.prompt?.trim()) {
			systemPrompt = options.prompt.trim();
		}

		const session = await SessionModel.create({
			...(options?.userId ? { userId: new Types.ObjectId(options.userId) } : {}),
			workflow,
			topic,
			systemPrompt,
			model: getOpenRouterModel(),
			state: "idle",
		});

		this.sessionId = session._id;
		await MessageModel.create({
			sessionId: session._id,
			role: "system",
			content: systemPrompt,
		});

		if (options?.prompt?.trim()) {
			await this.sendMessage(options.prompt, options.userId);
			return;
		}

		this.setState("idle");
	}

	private async loadHistory(): Promise<ChatTurn[]> {
		if (!this.sessionId) return [];
		const rows = await MessageModel.find({ sessionId: this.sessionId }).sort({ createdAt: 1 }).lean();
		return rows.map((row) => ({
			role: row.role as ChatTurn["role"],
			content: row.content,
		}));
	}

	private async enrichHistoryWithAlphaXiv(
		history: ChatTurn[],
		options: { workflow?: string | null; topic?: string | null; userMessage: string },
	): Promise<ChatTurn[]> {
		if (!shouldUseAlphaXiv(options.workflow)) return history;

		const userMessages = history.filter((turn) => turn.role === "user");
		if (userMessages.length !== 1) return history;

		const query = buildLiteratureSearchQuery({
			topic: options.topic?.trim() || options.userMessage.trim(),
			discipline: parseDisciplineFromPrompt(options.userMessage),
		});
		if (!query) return history;

		this.emit({
			type: "agent_event",
			event: { type: "tool_execution_start", toolName: "alphaxiv_search" },
		});

		try {
			const isChatPaper =
				(options.workflow ?? "").replace(/^\//, "") === "chat-paper";
			const scope =
				parseScopeFromPrompt(options.userMessage) ||
				parseScopeFromPrompt(
					history.find((turn) => turn.role === "user")?.content ?? "",
				) ||
				"journal";
			const profile = getScopeProfile(scope);
			const healthHint = [
				options.userMessage,
				options.topic,
				history.find((turn) => turn.role === "user")?.content ?? "",
			]
				.filter(Boolean)
				.join("\n");
			const result = await buildPaperSearchContext(query, {
				signal: this.abortController?.signal,
				scope,
				minDistinctCites: profile.minDistinctCites,
				healthHint,
				citationStyle: parseCitationStyleLabel(options.userMessage),
				...(isChatPaper ? { limit: literatureBankFetchLimit(scope) } : {}),
			});

			this.emit({
				type: "agent_event",
				event: { type: "tool_execution_end", toolName: "alphaxiv_search", isError: false },
			});

			if (!result) return history;

			this.literatureBank = result.papers;
			this.literatureProtocol = result.protocol;

			const retrievalLabel =
				result.source === "library"
					? "Paper library RAG retrieval"
					: result.source === "hybrid"
						? "Paper library + live literature retrieval"
						: result.source === "tavily"
							? "Tavily literature retrieval"
							: result.source === "arxiv"
								? "arXiv literature retrieval"
								: result.source === "openalex"
									? "OpenAlex literature retrieval"
									: result.source === "pubmed"
										? "PubMed literature retrieval"
										: result.source === "doaj"
											? "DOAJ literature retrieval"
											: result.source === "europepmc"
												? "Europe PMC literature retrieval"
												: result.source === "alphaxiv-mcp"
													? "AlphaXiv MCP literature retrieval"
													: "AlphaXiv literature retrieval";
			const contextBlock = `[${retrievalLabel}]\n\n${result.context}`;
			const systemIndex = history.findIndex((turn) => turn.role === "system");
			if (systemIndex < 0) return history;

			const updatedSystem = `${history[systemIndex]!.content}\n\n${contextBlock}`;
			await MessageModel.findOneAndUpdate(
				{ sessionId: this.sessionId!, role: "system" },
				{ content: updatedSystem },
			);

			const nextHistory = [...history];
			nextHistory[systemIndex] = { role: "system", content: updatedSystem };
			return nextHistory;
		} catch (error) {
			this.emit({
				type: "agent_event",
				event: {
					type: "tool_execution_end",
					toolName: "alphaxiv_search",
					isError: true,
				},
			});

			const message = error instanceof Error ? error.message : String(error);
			const contextBlock = `[Literature retrieval failed: ${message}. Do not invent authors, years, titles, or DOIs. Omit literature claims that cannot be grounded in user-supplied evidence.]`;
			const systemIndex = history.findIndex((turn) => turn.role === "system");
			if (systemIndex < 0) return history;

			const updatedSystem = `${history[systemIndex]!.content}\n\n${contextBlock}`;
			await MessageModel.findOneAndUpdate(
				{ sessionId: this.sessionId!, role: "system" },
				{ content: updatedSystem },
			);

			const nextHistory = [...history];
			nextHistory[systemIndex] = { role: "system", content: updatedSystem };
			return nextHistory;
		}
	}

	async sendMessage(message: string, userId?: string): Promise<string> {
		const trimmed = message.trim();
		if (!trimmed) throw new Error("Message cannot be empty.");
		if (!this.sessionId) await this.resetSession({ userId });

		if (userId) {
			await assertStudentHasTokenBalance(userId);
			const user = await UserModel.findById(userId).select("role faculty").lean();
			if (user) {
				const session = await SessionModel.findById(this.sessionId).lean();
				const workflow = session?.workflow ?? "chat";
				const policyResult = await evaluatePolicy({
					scope: "feature",
					target: workflow,
					role: user.role ?? "lecturer",
					faculty: (user as Record<string, unknown>).faculty as string | null,
				});
				if (policyResult.effect === "blocked") {
					this.emit({ type: "error", error: `Access denied: ${policyResult.reason}` });
					throw new Error(`Policy blocked: ${policyResult.reason}`);
				}
				if (policyResult.effect === "restricted") {
					this.emit({
						type: "system_message",
						content: `Notice: ${policyResult.reason}. This interaction is logged for governance review.`,
					});
				}
			}
			if (this.sessionId) {
				void SessionModel.updateOne(
					{
						_id: this.sessionId,
						$or: [{ userId: { $exists: false } }, { userId: null }],
					},
					{ userId: new Types.ObjectId(userId) },
				).catch(() => undefined);
			}
		}

		const requestId = randomUUID();
		this.abortController = new AbortController();
		this.setState("running");
		this.emit({ type: "user_message", id: requestId, content: trimmed });

		await MessageModel.create({
			sessionId: this.sessionId!,
			role: "user",
			content: trimmed,
		});

		const history = await this.loadHistory();
		const session = await SessionModel.findById(this.sessionId).lean();
		const llmHistory = await this.enrichHistoryWithAlphaXiv(history, {
			workflow: session?.workflow,
			topic: session?.topic,
			userMessage: trimmed,
		});

		this.emit({
			type: "agent_event",
			event: { type: "agent_start" },
		});

		let assistantText = "";
		try {
			const scopeFromHistory =
				parseScopeFromPrompt(trimmed) ||
				parseScopeFromPrompt(
					history.find((turn) => turn.role === "user")?.content ?? "",
				) ||
				"journal";
			const profile = getScopeProfile(scopeFromHistory);
			const maxTokens =
				session?.workflow === "chat-paper" ? profile.maxTokens : undefined;
			const { text, usage } = await streamOpenRouterChat(llmHistory, {
				signal: this.abortController.signal,
				maxTokens,
				onDelta: (delta) => {
					this.emit({
						type: "agent_event",
						event: {
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta },
						},
					});
				},
			});
			assistantText = text;

			if (session?.workflow === "chat-paper") {
				assistantText = formatResearchPaperReferences(assistantText);
				assistantText = await alignCitationsAndFactCheck(
					assistantText,
					this.literatureBank,
					trimmed,
					{
						signal: this.abortController?.signal,
						protocol: this.literatureProtocol,
						topic: session?.topic ?? trimmed,
					},
				);
			}

			await MessageModel.create({
				sessionId: this.sessionId!,
				role: "assistant",
				content: assistantText,
			});

			await this.persistResearchIfPaper(assistantText, trimmed, usage, userId);

			this.emit({
				type: "agent_event",
				event: {
					type: "message_end",
					message: { content: assistantText },
				},
			});
			if (usage) {
				this.emit({
					type: "agent_event",
					event: { type: "token_usage", usage },
				});
			}

			if (userId && usage?.totalTokens) {
				const quota = await deductStudentTokens(userId, usage.totalTokens);
				if (quota) {
					this.emit({ type: "student_token_quota", quota });
				}
			}

			this.emit({
				type: "agent_event",
				event: { type: "agent_end" },
			});
			this.setState("idle");
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				this.setState("idle");
				return requestId;
			}
			const msg = error instanceof Error ? error.message : String(error);
			this.setState("error", msg);
			throw error;
		} finally {
			this.abortController = null;
		}

		return requestId;
	}

	private async persistResearchIfPaper(
		assistantText: string,
		userMessage: string,
		usage?: TokenUsage,
		userId?: string,
	): Promise<void> {
		if (!this.sessionId || assistantText.trim().length < 400) return;

		const session = await SessionModel.findById(this.sessionId).lean();
		if (session?.workflow !== "chat-paper") return;

		const topic = session.topic?.trim() || userMessage.trim();
		if (!topic) return;

		try {
			const saved = await saveResearchPaper({
				userId: userId ?? null,
				sessionId: this.sessionId.toString(),
				topic,
				content: assistantText,
				workflow: "chat-paper",
				tokenUsage: usage,
			});
			this.lastSavedResearchId = saved.id;
		} catch {
			/* persistence must not break chat */
		}
	}

	async abort(): Promise<void> {
		this.abortController?.abort();
		this.abortController = null;
		this.setState("idle");
	}

	async getSessionMessages(sessionId: string) {
		return MessageModel.find({ sessionId }).sort({ createdAt: 1 }).lean();
	}
}
