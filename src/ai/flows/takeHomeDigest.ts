import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { buildTakeHomeDigestPrompt, type TakeHomeDigestPromptInput } from '@/ai/prompts/takeHomeDigest'
import { TakeHomeDigestOutSchema, type TakeHomeDigestOut } from '@/ai/schemas'
import { verifyQuotes } from '@/lib/research/quotes'

/** Summarising one page is transcription-shaped work, as the process map's digest is. */
const THINKING_BUDGET = 256

/**
 * One write-up in — what it says about this company's take-home out, with every quote checked
 * against the text it claims to come from.
 *
 * The whole digest comes back, empty fields and all. Whether a digest is worth keeping is the
 * run's decision and not this flow's: `researchTakeHome` returns `null` to `readGuides` when
 * `takeaways` is empty, which leaves the source unread and frees its slot for the next page. A
 * flow that returned `null` itself would be making the same call in two places, and the caller
 * would still have to make it — `readGuides` is the only thing that knows what a `null` costs.
 */
export async function runTakeHomeDigest(
  input: TakeHomeDigestPromptInput,
  generate?: GenerateCall,
): Promise<TakeHomeDigestOut> {
  const { system, parts } = buildTakeHomeDigestPrompt(input)
  const out = await generateStructured(
    { parts, system, schema: TakeHomeDigestOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
  // The prompt asks for verbatim; this is where the asking stops and the property begins.
  return { ...out, quotes: verifyQuotes(out.quotes, input.text) }
}
