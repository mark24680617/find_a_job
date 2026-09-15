import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { buildProcessDigestPrompt, type ProcessDigestPromptInput } from '@/ai/prompts/processDigest'
import { ProcessDigestOutSchema } from '@/ai/schemas'
import { verifyQuotes } from '@/lib/research/quotes'

/**
 * Summarising one page is transcription-shaped work. It is set to LOW because the 2026-09-14
 * evaluation found no measurable gain from thinking here
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'LOW'

export interface ProcessDigest {
  takeaways: string[]
  questionsReported: string[]
  quotes: string[]
  publishedAt?: string
  /** Whether the write-up is somebody's own account rather than a prep site's summary. */
  firstHand: boolean
}

/** One write-up in — what to take from it out, with every quote checked against the text. */
export async function runProcessDigest(input: ProcessDigestPromptInput, generate?: GenerateCall): Promise<ProcessDigest> {
  const { system, parts } = buildProcessDigestPrompt(input)
  const out = await generateStructured(
    { parts, system, schema: ProcessDigestOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
  return {
    takeaways: out.takeaways,
    questionsReported: out.questionsReported,
    // The prompt asks for verbatim; this is where the asking stops and the property begins.
    quotes: verifyQuotes(out.quotes, input.text),
    firstHand: out.firstHand,
    ...(out.publishedAt ? { publishedAt: out.publishedAt } : {}),
  }
}
