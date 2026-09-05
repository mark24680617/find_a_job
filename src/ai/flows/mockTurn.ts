import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { summarizeFacts } from '@/ai/prompts/jobInterpret'
import { buildMockTurnPrompt } from '@/ai/prompts/mockTurn'
import { summarizeJob, summarizeReported } from '@/ai/prompts/prepBrief'
import { MockTurnOutSchema, type MockTurnOut } from '@/ai/schemas'
import { guardTurn } from '@/lib/mockGuard'
import type { ReportedQuestion } from '@/lib/practice'
import type { Fact, MockTurn, ParsedJob, PracticeMode } from '@/lib/types'

/**
 * One turn is a small decision — read the last answer, follow up or move on, say one thing —
 * made up to eleven times in a session. That is interviewInterpret's kind of local reading,
 * doubled for the one judgment that is not local: whether a question people report from this
 * company actually fits this stage, or would be an adapted near-miss the guard then drops.
 */
const THINKING_BUDGET = 512

export interface MockTurnInput {
  parsed: ParsedJob
  /** Written by the route with `describeStage` — frozen at `start`, never re-derived here. */
  stageSummary: string
  reported: ReportedQuestion[]
  facts: Fact[]
  mode: PracticeMode
  questionsAsked: number
  previousQuestions: string[]
  transcript: MockTurn[]
}

/** The stage, the transcript and the candidate's facts in — the next thing the interviewer says out. */
export async function runMockTurn(input: MockTurnInput, generate?: GenerateCall): Promise<MockTurnOut> {
  const { system, parts } = buildMockTurnPrompt({
    jobSummary: summarizeJob(input.parsed),
    stageSummary: input.stageSummary,
    reportedSummary: summarizeReported(input.reported),
    // The claims only, as everywhere else: the provenance snippet behind a fact belongs to
    // the profile editor, and an interviewer quoting it would be reading a resume aloud.
    factsSummary: summarizeFacts(input.facts),
    mode: input.mode,
    questionsAsked: input.questionsAsked,
    previousQuestions: input.previousQuestions,
    transcript: input.transcript,
  })
  const out = await generateStructured(
    { parts, system, schema: MockTurnOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
  // The prompt asks for a verbatim citation and one follow-up at a time; this is where the
  // asking stops and the property begins. The last model turn is what a second consecutive
  // follow-up is measured against — without it the six-question count could stall forever.
  const previousModelTurn = [...input.transcript].reverse().find((t) => t.role === 'model')
  return guardTurn(out, input.reported, previousModelTurn)
}
