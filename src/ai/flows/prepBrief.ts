import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { summarizeFacts } from '@/ai/prompts/jobInterpret'
import { buildPrepBriefPrompt, summarizeJob } from '@/ai/prompts/prepBrief'
import { PrepBriefOutSchema, type PrepBriefOut } from '@/ai/schemas'
import type { Fact, ParsedJob, RoundType } from '@/lib/types'

/**
 * Five sections, each of which has to be weighed against the same three inputs: which of the
 * candidate's clusters answers which likely question, which unmet gate is going to surface in
 * THIS round rather than another one, which claims are load-bearing enough to rehearse. That
 * is the same shape of work jobInterpret's gate judgment does, and it gets the same budget.
 */
const THINKING_BUDGET = 1024

export interface PrepBriefInput {
  roundType: RoundType
  parsed: ParsedJob
  facts: Fact[]
}

/** One round of one posting, plus the candidate's facts, in — the prep brief out. */
export async function runPrepBrief(
  input: PrepBriefInput,
  generate?: GenerateCall,
): Promise<PrepBriefOut> {
  const { system, parts } = buildPrepBriefPrompt({
    roundType: input.roundType,
    jobSummary: summarizeJob(input.parsed),
    // The same one-line-per-fact summary the gate judgment reads: an angle is chosen against
    // the claim, and the provenance snippet behind it is the profile editor's business.
    factsSummary: summarizeFacts(input.facts),
  })
  return generateStructured(
    { parts, system, schema: PrepBriefOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
}
