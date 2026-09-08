import { generateStructured, type GenerateCall } from '@/ai/genkit'
import {
  buildLetterheadFillPrompt,
  type LetterheadFillPromptInput,
} from '@/ai/prompts/letterheadFill'
import { LetterheadFillOutSchema, type LetterheadFillOut } from '@/ai/schemas'
import { LETTERHEAD_FIELD_MAX } from '@/lib/letter/letterhead'
import { normalizeWs, QUOTE_CAP } from '@/lib/research/quotes'
import type { Fact, Letterhead } from '@/lib/types'

/**
 * Nothing, as the transcription gets nothing. Five fields are copied out of two documents that
 * either state them or do not; thinking tokens spent here buy a plausible address.
 */
const THINKING_BUDGET = 0

export type LetterheadFillInput = LetterheadFillPromptInput

/** Only the fields the flow verified. A field it could not source is absent, never blank. */
export type FilledLetterhead = Partial<
  Pick<Letterhead, 'phone' | 'location' | 'recipient' | 'recipientTitle' | 'companyAddress'>
>

/** The three fields that may only come from the posting, and the two only from the facts. */
const FROM_POSTING = ['recipient', 'recipientTitle', 'companyAddress'] as const

/**
 * The words a field's quote is checked against. Two corpora rather than one, because the whole of
 * rule 2 is which document a value came from: a company's city quoted onto the candidate's
 * location is a real span of a real document, and only a per-field haystack catches it.
 */
const factsCorpus = (facts: Fact[]) =>
  normalizeWs(facts.map((f) => `${f.claim}\n${f.sourceSnippet}`).join('\n'))

/**
 * One field, kept or dropped. Dropped is the ordinary outcome and costs nothing: a blank line is
 * one the PDF omits and one the person can type, where a wrong one is a letter addressed to
 * somebody who does not work there.
 *
 * The line breaks are the reason `readLetterhead`'s own folding is not enough here. It turns a
 * newline in a single-line field into a space, which is right for something a person typed and
 * wrong for something a model returned: a location that came back as two lines is a value the
 * model was unsure how to shape, and folding it would store that uncertainty as a fact. The
 * address block is the one field the layout prints line by line, so it is the one field a newline
 * belongs in.
 */
function verified(
  fill: LetterheadFillOut[keyof LetterheadFillOut],
  corpus: string,
  multiline: boolean,
): string | null {
  if (!fill) return null
  const quote = normalizeWs(fill.quote)
  if (quote === '' || quote.length > QUOTE_CAP) return null
  if (!corpus.includes(quote)) return null
  const text = fill.text.trim()
  if (text === '') return null
  if (!multiline && text.includes('\n')) return null
  // Cut by code point, as `readLetterhead` cuts: a slice that lands inside a surrogate pair
  // leaves half a character in a field the person can neither read nor delete.
  return Array.from(text).slice(0, LETTERHEAD_FIELD_MAX).join('')
}

/**
 * The facts and the posting in, the letterhead fields the two documents actually state out.
 *
 * One call and no correction round, which is the difference between this and every other guarded
 * flow here. A rejected sentence in a guide is worth arguing about because the guide is the
 * product; a rejected letterhead field is worth a blank, because blank is what the panel already
 * shows and what the person was going to type anyway. So the guard drops rather than corrects,
 * and the caller learns which fields came back rather than being told what went wrong.
 */
export async function runLetterheadFill(
  input: LetterheadFillInput,
  generate?: GenerateCall,
): Promise<FilledLetterhead> {
  const { system, parts } = buildLetterheadFillPrompt(input)
  const out = await generateStructured(
    { parts, system, schema: LetterheadFillOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )

  const facts = factsCorpus(input.facts)
  const posting = normalizeWs(input.jdText)
  const filled: FilledLetterhead = {}
  for (const key of Object.keys(out) as (keyof LetterheadFillOut)[]) {
    const fromPosting = (FROM_POSTING as readonly string[]).includes(key)
    const text = verified(out[key], fromPosting ? posting : facts, key === 'companyAddress')
    if (text !== null) filled[key] = text
  }
  return filled
}
