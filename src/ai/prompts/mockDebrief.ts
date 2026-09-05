/**
 * The debrief prompt: the whole conversation in, what landed, what stayed vague, and every
 * sentence the candidate said about themselves that their facts do not support out. The
 * system text is the design spec's, word for word — the `said` field is a quotation and the
 * text says so twice, because that quote is what the screen shows in amber and what a person
 * may send into their fact bank. `guardDebrief` drops anything that is not verbatim
 * afterwards, and `tests/prompts.mock.test.ts` fails the build if this text drifts.
 */
import type { Part } from '@/ai/genkit'
import { orNone, transcriptText } from '@/ai/prompts/mockTurn'
import type { MockTurn, PracticeMode } from '@/lib/types'

export const MOCK_DEBRIEF_SYSTEM = `You debrief a mock interview for the candidate who just gave it. Write for them, plainly.
overall: two or three sentences on how the round went, tied to what this stage probes.
answers: one entry per question the candidate answered — a turn labelled question that a
candidate turn follows — in order; a question left unanswered when the mock ended is not an
entry; what was said in answer to a follow-up belongs to the entry of the question it
followed. landed: what in the answer would have worked for this interviewer, specific to what
they said. vague: where the answer stayed general — a claim without a number, a date, a
decision, or a result — and what would have made it concrete. unsupported: every sentence in
which the candidate stated something about their own experience, skills or results that is not
among their facts. Quote the sentence exactly as they wrote it in \`said\`, and in \`why\` say what
fact would need to exist for it to be citable. The facts may be empty; then every such sentence
is unsupported. Do not decide whether it is true — only they know.
code, in mode coding only: strengths and gaps of the code as written — structure, edge cases,
naming, whether the stated assumptions hold. You read it; you did not run it. Say nothing
about whether it runs. Otherwise null.
rehearse: the candidate's facts, quoted verbatim, that this round most needs them to have on
the tip of their tongue.
Nothing here is written for the candidate to recite. It does not script lies.`

export interface MockDebriefPromptInput {
  jobSummary: string
  stageSummary: string
  mode: PracticeMode
  factsSummary: string
  transcript: MockTurn[]
}

/**
 * The same order the interviewer read, minus the reported questions and the counters — the
 * mock is over, and what people elsewhere were asked has no bearing on how this candidate
 * answered. The facts come immediately before the transcript because the hardest section is
 * the one that compares the two, and an empty bank is stated rather than left blank: the
 * spec's rule is that every self-claim is then unsupported, which the model can only apply if
 * it can see the bank is empty.
 */
export function buildMockDebriefPrompt(input: MockDebriefPromptInput): { system: string; parts: Part[] } {
  const parts: Part[] = [
    { text: `The job:\n${input.jobSummary}` },
    { text: `The stage:\n${input.stageSummary}` },
    { text: `Mode: ${input.mode}` },
    { text: `Candidate facts:\n${orNone(input.factsSummary)}` },
    { text: `Transcript:\n${transcriptText(input.transcript, input.mode)}` },
  ]
  return { system: MOCK_DEBRIEF_SYSTEM, parts }
}
