import type { AIProvider, AdapterContext, ChatRequest, ChatResult } from '../types.js'
import { ProviderError } from '../types.js'

/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * One adapter covers OpenAI, xAI (Grok), Groq, OpenRouter, Mistral, and any
 * self-hosted / future OpenAI-compatible endpoint — they all speak
 * `POST {baseUrl}/chat/completions` with a Bearer key. The concrete base URL and
 * model come from the provider registry or a user's custom-provider config.
 */
export const openaiCompatAdapter: AIProvider = {
  id: 'openai-compat',
  async generate(req: ChatRequest, ctx: AdapterContext): Promise<ChatResult> {
    const baseUrl = (ctx.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')

    // OpenAI-style: system is just the first message.
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ctx.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        messages,
        max_tokens: req.maxTokens ?? 4096,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await safeError(res)
      throw new ProviderError(`Provider error: ${detail}`, res.status)
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
      model?: string
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const choice = json.choices?.[0]

    return {
      text: choice?.message?.content ?? '',
      model: json.model,
      finishReason: choice?.finish_reason,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      },
    }
  },
}

async function safeError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } | string }
    if (typeof j.error === 'string') return j.error
    return j.error?.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}
