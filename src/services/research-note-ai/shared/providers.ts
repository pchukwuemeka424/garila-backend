/**
 * Provider registry — the single source of truth for the built-in AI providers,
 * shared by the client (Settings UI: dropdowns, key fields) and the server proxy
 * (adapter + key resolution). Add a provider here once and it appears everywhere.
 *
 * `kind` selects the server adapter. OpenAI, xAI (and Groq/OpenRouter/Mistral)
 * all use the shared `openai-compat` adapter — only base URL + model differ.
 */

export type AdapterKind = 'anthropic' | 'openai-compat' | 'gemini' | 'mock'

export interface ProviderDescriptor {
  id: string
  label: string
  kind: AdapterKind
  /** Default API base URL for openai-compat / gemini adapters. */
  defaultBaseUrl?: string
  /** Suggested model ids (the UI also allows a free-text model). */
  models: string[]
  /** Server-side env var the proxy reads for the developer/self-host key. */
  envVar?: string
  /** False for the offline mock (no key needed). */
  requiresKey: boolean
  /** Whether the user can edit the base URL (custom / OpenAI-compatible endpoints). */
  editableBaseUrl?: boolean
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter (GARIL default)',
    kind: 'openai-compat',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-5.1', 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-4'],
    envVar: 'OPENROUTER_API_KEY',
    requiresKey: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    envVar: 'ANTHROPIC_API_KEY',
    requiresKey: true,
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    kind: 'openai-compat',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
    envVar: 'OPENAI_API_KEY',
    requiresKey: true,
  },
  {
    id: 'gemini',
    label: 'Google (Gemini)',
    kind: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    envVar: 'GEMINI_API_KEY',
    requiresKey: true,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai-compat',
    defaultBaseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3'],
    envVar: 'XAI_API_KEY',
    requiresKey: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai-compat',
    defaultBaseUrl: '',
    models: [],
    requiresKey: true,
    editableBaseUrl: true,
  },
  {
    id: 'mock',
    label: 'Mock (offline demo — no key)',
    kind: 'mock',
    models: ['mock'],
    requiresKey: false,
  },
]

export const DEFAULT_PROVIDER_ID = 'openrouter'

export function getProvider(id: string): ProviderDescriptor | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export function defaultModelFor(id: string): string {
  return getProvider(id)?.models[0] ?? ''
}
