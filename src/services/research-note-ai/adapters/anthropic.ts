import type { AIProvider, AdapterContext, ChatRequest, ChatResult } from '../types.js'
import { ProviderError } from '../types.js'

/**
 * Anthropic (Claude) Messages API adapter — raw HTTP so the proxy stays free of
 * vendor SDKs and provider-neutral. Claude's API differs from the OpenAI shape:
 * `system` is a top-level field (not a message), and current models
 * (Opus 4.7+/4.8, Sonnet 5) reject temperature/top_p — so we never send them.
 *
 * Docs: POST /v1/messages, headers x-api-key + anthropic-version: 2023-06-01.
 */
export const anthropicAdapter: AIProvider = {
  id: 'anthropic',
  async generate(req: ChatRequest, ctx: AdapterContext): Promise<ChatResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ctx.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        ...(req.system ? { system: req.system } : {}),
        // Live web search runs server-side inside this single request; the final
        // message comes back with text blocks that carry citations.
        ...(req.webSearch
          ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] }
          : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const detail = await safeError(res)
      throw new ProviderError(`Anthropic error: ${detail}`, res.status)
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string; citations?: Array<{ url?: string; title?: string }> }>
      stop_reason?: string
      model?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const blocks = json.content ?? []
    let text = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('')

    // Surface web-search citations as a Markdown "Sources" list.
    if (req.webSearch) {
      const seen = new Set<string>()
      const sources: string[] = []
      for (const b of blocks) {
        for (const c of b.citations ?? []) {
          if (c.url && !seen.has(c.url)) {
            seen.add(c.url)
            sources.push(`- [${c.title || c.url}](${c.url})`)
          }
        }
      }
      if (sources.length) text += `\n\n**Sources**\n${sources.join('\n')}`
    }

    return {
      text,
      model: json.model,
      finishReason: json.stop_reason,
      usage: {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
      },
    }
  },
}

async function safeError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    return j.error?.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}
