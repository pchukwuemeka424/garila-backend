import type { AIProvider, AdapterContext, ChatRequest, ChatResult } from '../types.js'
import { ProviderError } from '../types.js'

/**
 * Google Gemini (Generative Language API) adapter.
 *
 * Distinct shape: messages are `contents` with `parts`, roles are `user`/`model`
 * (not `assistant`), the system prompt is `systemInstruction`, and the key is a
 * `?key=` query param. Endpoint: /v1beta/models/{model}:generateContent.
 */
export const geminiAdapter: AIProvider = {
  id: 'gemini',
  async generate(req: ChatRequest, ctx: AdapterContext): Promise<ChatResult> {
    const base = (ctx.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
    const url = `${base}/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(ctx.apiKey)}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(req.system
          ? { systemInstruction: { parts: [{ text: req.system }] } }
          : {}),
        contents: req.messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 4096,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      }),
    })

    if (!res.ok) {
      const detail = await safeError(res)
      throw new ProviderError(`Gemini error: ${detail}`, res.status)
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        finishReason?: string
      }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const cand = json.candidates?.[0]
    const text = (cand?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')

    return {
      text,
      model: req.model,
      finishReason: cand?.finishReason,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
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
