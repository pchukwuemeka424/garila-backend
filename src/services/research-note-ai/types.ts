/**
 * The single internal AI interface the whole app calls.
 *
 * No feature code (drafting, chat) ever talks to a provider directly — it builds
 * a normalized ChatRequest and calls a provider through this interface. Swapping
 * Anthropic ↔ OpenAI ↔ Gemini ↔ Grok ↔ a custom endpoint changes only which
 * adapter is selected in the registry, never the callers.
 */

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  /** System / instruction prompt (kept separate — some providers require it split out). */
  system?: string
  messages: ChatMessage[]
  /** Provider-specific model id, e.g. "claude-opus-4-8", "gpt-4.1", "gemini-2.5-pro". */
  model: string
  maxTokens?: number
  /** Only forwarded by providers that accept it (never sent to Anthropic 4.7+/Sonnet 5). */
  temperature?: number
  /** Enable the provider's live web-search tool (currently the Anthropic adapter). */
  webSearch?: boolean
}

export interface ChatResult {
  text: string
  model?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  finishReason?: string
}

/** Everything an adapter needs to authenticate and address a provider for one call. */
export interface AdapterContext {
  apiKey: string
  /** Base URL for OpenAI-compatible / custom providers (ignored by Anthropic/Gemini). */
  baseUrl?: string
}

export interface AIProvider {
  id: string
  generate(req: ChatRequest, ctx: AdapterContext): Promise<ChatResult>
}

/** Raised by adapters on a provider error, carrying an HTTP-ish status for the proxy. */
export class ProviderError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}
