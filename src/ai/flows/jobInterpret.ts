import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { buildJobInterpretPrompt, summarizeFacts } from '@/ai/prompts/jobInterpret'
import { JobInterpretOutSchema, type JobInterpretOut } from '@/ai/schemas'
import type { Fact } from '@/lib/types'

/**
 * Gate judgment is the one place in this flow where reasoning earns its tokens: the model
 * has to weigh each stated requirement against the candidate's facts and decide met and
 * posture, then whether the unmet ones add up to a skip. So this flow opts into a thinking
 * budget where profileIngest spends 512 and the lighter flows spend none.
 */
const THINKING_BUDGET = 1024

export interface JobInterpretInput {
  jdText: string
  facts: Fact[]
}

/** One posting plus the candidate's facts in, the parsed posting (gates and all) out. */
export async function runJobInterpret(
  input: JobInterpretInput,
  generate?: GenerateCall,
): Promise<JobInterpretOut> {
  const { system, parts } = buildJobInterpretPrompt({
    jdText: input.jdText,
    factsSummary: summarizeFacts(input.facts),
  })
  return generateStructured(
    { parts, system, schema: JobInterpretOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
}
