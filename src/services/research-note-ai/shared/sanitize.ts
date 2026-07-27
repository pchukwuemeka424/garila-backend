/**
 * Header-value hygiene for secrets.
 *
 * API keys, JWTs and Supabase anon/publishable keys are ASCII. When one is
 * pasted with stray non-ASCII characters — a MASKED key copied as bullets (•),
 * a non-breaking space, a zero-width char, smart quotes, or a trailing newline —
 * assigning it to an HTTP request header throws:
 *
 *   "Failed to read the 'headers' property from 'RequestInit':
 *    String contains non ISO-8859-1 code point."
 *
 * …and the whole request dies before it leaves the browser (or the function).
 * We defensively strip anything that can't appear in a header token. This turns
 * a fatal crash into a normal, recoverable auth error. It does NOT touch user
 * input like passwords — only machine credentials (keys) headed for a header.
 */

/** Keep only printable-ASCII token characters (0x21–0x7E); drop spaces, control
 *  chars, NBSP, zero-width chars, bullets, smart quotes, and all non-ASCII. */
export function cleanHeaderToken(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/[^\x21-\x7e]+/g, '')
}

/** Trim surrounding whitespace/newlines from a URL (it feeds fetch's URL). */
export function cleanUrl(value: string | null | undefined): string {
  return (value ?? '').trim()
}
