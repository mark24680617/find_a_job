/**
 * A quote is the one thing a digest may carry in somebody else's words, so it is checked
 * against the text it claims to come from: whitespace-normalised on both sides, verbatim
 * otherwise. What does not match is dropped, not corrected — a "quote" the model composed is
 * the exact thing this product exists not to show.
 */

export function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

const QUOTE_CAP = 240

export function verifyQuotes(quotes: string[], text: string): string[] {
  const haystack = normalizeWs(text)
  const kept: string[] = []
  for (const raw of quotes) {
    const q = normalizeWs(raw)
    if (q === '' || q.length > QUOTE_CAP) continue
    if (!haystack.includes(q)) continue
    if (!kept.includes(q)) kept.push(q)
  }
  return kept
}

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000

/**
 * Old, and known to be old. Undated is not stale — it is a different fact, and the screen
 * states it as one ("date not stated"). Almost nothing on the open web carries a date, so
 * counting undated as stale put "may be out of date" on twelve guides out of thirteen,
 * including the two first-hand accounts that were the best evidence in the run. A warning
 * that fires on everything is read as decoration.
 */
export function isStale(publishedAt: string | undefined, researchedAt: string): boolean {
  const at = Date.parse(publishedAt ?? '')
  if (Number.isNaN(at)) return false
  return Date.parse(researchedAt) - at > TWO_YEARS_MS
}
