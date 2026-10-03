import type { AppContext } from "./app-context.js";
import { ChatService } from "../services/chat.service.js";

/** Per-user chat sessions so concurrent clients cannot share abort/status/history. */
export class ChatSessionRegistry {
	private readonly byUser = new Map<string, ChatService>();

	constructor(private readonly ctx: AppContext) {}

	forUser(userId: string): ChatService {
		let chat = this.byUser.get(userId);
		if (!chat) {
			chat = new ChatService(this.ctx);
			this.byUser.set(userId, chat);
		}
		return chat;
	}

	async abortAll(): Promise<void> {
		await Promise.all([...this.byUser.values()].map((chat) => chat.abort()));
	}
}
