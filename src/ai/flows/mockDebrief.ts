import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { summarizeFacts } from '@/ai/prompts/jobInterpret'
import { buildMockDebriefPrompt } from '@/ai/prompts/mockDebrief'
import { summarizeJob } from '@/ai/prompts/prepBrief'
import { MockDebriefOutSchema, type MockDebriefOut } from '@/ai/schemas'
import { guardDebrief } from '@/lib/mockGuard'
import type { Fact, MockTurn, ParsedJob, PracticeMode } from '@/lib/types'

/**
 * Reading a whole conversation back, deciding what landed against what this stage probes, and
 * checking every sentence the candidate said about themselves against their fact bank is several
 * judgments over the same inputs. Even so, it is set to LOW because the 2026-09-14 evaluation
 * found no measurable gain from thinking here
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'LOW'

export interface MockDebriefInput {
  parsed: ParsedJob
  stageSummary: string
  mode: PracticeMode
  facts: Fact[]
  transcript: MockTurn[]
}

/** The finished conversation in — what landed, what was vague, and what nothing supports out. */
export async function runMockDebrief(
  input: MockDebriefInput,
  generate?: GenerateCall,
): Promise<MockDebriefOut> {
  const { system, parts } = buildMockDebriefPrompt({
    jobSummary: summarizeJob(input.parsed),
    stageSummary: input.stageSummary,
    mode: input.mode,
    factsSummary: summarizeFacts(input.facts),
    transcript: input.transcript,
  })
  const out = await generateStructured(
    { parts, system, schema: MockDebriefOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
  // Every amber sentence on the screen is offered to the candidate as their own words, and a
  // rehearsal line is offered as their own fact. Neither is worth a retry — a dropped quote
  // costs one line of feedback — but neither may be shown unchecked, so the guard runs here,
  // before the route ever sees a debrief it could store.
  return guardDebrief(out, input.transcript, input.facts, input.mode)
}
