import { normalizeWs } from '@/lib/research/quotes'
import type { SnippetCheck } from '@/lib/resume/types'
import type { Fact } from '@/lib/types'

/**
 * For every fact in the profile, whether its `sourceSnippet` can be located in the stored resume
 * text under whitespace normalisation. A code check, no model (spec §5.4).
 *
 * This closes a hole the repo already had: `profileIngest`'s prompt demands a verbatim
 * `sourceSnippet` and nothing checks one, because until this feature the source document was
 * never stored. `normalizeWs` is the same normalisation the quote guard uses
 * (src/lib/research/quotes.ts:8), so a snippet that survives one survives the other.
 *
 * Reported, never auto-corrected: a fact may legitimately come from a story the person told
 * rather than from this document, so the honest output is a list, not a changeset. A fact whose
 * snippet is blank is unlocated rather than trivially found — an empty needle is in every
 * haystack — which is what keeps `located + missing.length === total`, the arithmetic behind the
 * one line on the page.
 */
export function snippetCheck(facts: Fact[], text: string): Omit<SnippetCheck, 'reviewedFrom'> {
  const haystack = normalizeWs(text)
  const missing: string[] = []
  let located = 0

  for (const fact of facts) {
    const needle = normalizeWs(fact.sourceSnippet)
    if (needle !== '' && haystack.includes(needle)) located += 1
    else missing.push(fact.sourceSnippet)
  }

  return { located, total: facts.length, missing }
}
