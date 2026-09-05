import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { summarizeFacts } from '@/ai/prompts/jobInterpret'
import {
  buildPrepBriefPrompt,
  summarizeJob,
  summarizeReported,
  summarizeStage,
} from '@/ai/prompts/prepBrief'
import { PrepBriefOutSchema } from '@/ai/schemas'
import { citeReported, type ReportedQuestion, type StagePlacement } from '@/lib/practice'
import type { Fact, ParsedJob, PrepBrief, RoundType } from '@/lib/types'

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
  /** The stage this round maps to — present only when there is a map and the round is on it. */
  stage?: StagePlacement
  /**
   * Every question every guide reported, whenever a map exists — mapped or not. A round that
   * is not on the reported loop is still at this company, and what people were asked there is
   * the best material a brief can have.
   */
  reported?: ReportedQuestion[]
}

/**
 * One round of one posting, plus the candidate's facts, in — the prep brief out. With the map,
 * the brief also sees the stage this round is and the questions people report being asked, and
 * may lead with those, copied word for word and cited.
 */
export async function runPrepBrief(
  input: PrepBriefInput,
  generate?: GenerateCall,
): Promise<Omit<PrepBrief, 'basis'>> {
  const { system, parts } = buildPrepBriefPrompt({
    roundType: input.roundType,
    jobSummary: summarizeJob(input.parsed),
    // The same one-line-per-fact summary the gate judgment reads: an angle is chosen against
    // the claim, and the provenance snippet behind it is the profile editor's business.
    factsSummary: summarizeFacts(input.facts),
    stageSummary: input.stage ? summarizeStage(input.stage) : undefined,
    // An empty list still goes in, as `(none)`: "the research found no reported question" is a
    // fact about this company, and a model told nothing infers it may invent something.
    reportedSummary: input.reported ? summarizeReported(input.reported) : undefined,
  })
  const out = await generateStructured(
    { parts, system, schema: PrepBriefOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
  // Asked for in the prompt, enforced here, exactly as the rehearsal-line filter is: a sourceId
  // the model returned is a claim that a named guide asked this question in these words, and it
  // becomes a link on the round page. So it is checked against the list we handed over, and a
  // citation that does not check out is dropped while the question stays — the question is still
  // worth preparing. `null` leaves as absent, which is what the record stores.
  return { ...out, questionsToPrepare: citeReported(out.questionsToPrepare, input.reported ?? []) }
}
