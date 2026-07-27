import type { AIProvider } from './types.js'
import type { AdapterKind } from './shared/providers.js'
import { anthropicAdapter } from './adapters/anthropic.js'
import { openaiCompatAdapter } from './adapters/openaiCompat.js'
import { geminiAdapter } from './adapters/gemini.js'
import { mockAdapter } from './adapters/mock.js'

/** Maps a provider descriptor's `kind` to the adapter that implements it. */
const ADAPTERS: Record<AdapterKind, AIProvider> = {
  anthropic: anthropicAdapter,
  'openai-compat': openaiCompatAdapter,
  gemini: geminiAdapter,
  mock: mockAdapter,
}

export function adapterForKind(kind: AdapterKind): AIProvider {
  return ADAPTERS[kind]
}
