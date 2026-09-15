import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { buildJobInterpretPrompt, summarizeFacts } from '@/ai/prompts/jobInterpret'
import { JobInterpretOutSchema, type JobInterpretOut } from '@/ai/schemas'
import type { Fact } from '@/lib/types'

/**
 * Gate judgment is the one place in this flow where reasoning earns its tokens: the model
 * has to weigh each stated requirement against the candidate's facts and decide met and
 * posture, then whether the unmet ones add up to a skip. It is at MEDIUM because the gate posture
 * came out wrong in 3 of 3 no-thinking samples and right in 2 of 2 at MEDIUM, on one posting
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

export interface JobInterpretInput {
  jdText: string
  /** Today's date, `YYYY-MM-DD` — what a gate's numeric minimum is measured up to. */
  today: string
  facts: Fact[]
}

/** One posting plus the candidate's facts in, the parsed posting (gates and all) out. */
export async function runJobInterpret(
  input: JobInterpretInput,
  generate?: GenerateCall,
): Promise<JobInterpretOut> {
  const { system, parts } = buildJobInterpretPrompt({
    jdText: input.jdText,
    today: input.today,
    factsSummary: summarizeFacts(input.facts),
  })
  return generateStructured(
    { parts, system, schema: JobInterpretOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
}
