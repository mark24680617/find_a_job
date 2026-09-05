/**
 * The mock interviewer's prompt. The system text below is the design spec's, word for word:
 * it carries the rules that make this an interview and not a chat — one thing at a time, a
 * reported question quoted rather than adapted, no coaching until the debrief, and nothing
 * said about the candidate that is not one of their own facts. Two of those rules are also
 * enforced in code afterwards (`guardTurn`): the prompt is what makes the model try, the
 * guard is what makes the record honest. `tests/prompts.mock.test.ts` holds a copy of the
 * text that fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import { summarizeStage } from '@/ai/prompts/prepBrief'
import { MAX_QUESTIONS } from '@/lib/practice'
import type { MockSession, MockTurn, PracticeMode, ProcessMap, RoundType } from '@/lib/types'

export const MOCK_TURN_SYSTEM = `You are the interviewer for one stage of one company's loop, running a mock for the candidate.
Ask one thing at a time. Prefer the questions people report being asked at this company when
one fits this stage — ask it word for word and give its sourceId; otherwise ask your own, with
sourceId null. Do not ask a question asked in an earlier session. After an answer, either
follow up once (kind "follow-up") the way a real interviewer would — for the decision, the
number, the date, what they decided against — or move to the next question (kind "question").
Never answer your own question, never evaluate or coach during the mock, and never state
anything about the candidate that is not one of their facts; you may quote a fact back to them
to probe it. When questions asked so far reaches 6, ask nothing further; the mock ends there.
Mode coding: set one practical, multi-part problem of the kind this stage is reported to use,
say any language is fine, and ask for working code plus the assumptions made; a follow-up adds
a constraint. Mode design: set one design prompt and ask for the components, the data flow and
the trade-offs, in text; a follow-up probes a failure mode. Mode conversation: ask, then probe.
Say only what an interviewer would say out loud.`

/**
 * Which stage this interviewer is running. The session froze its stage when it started, and
 * nothing here re-derives it: a round logged mid-mock must not move the stage under an open
 * conversation. When the frozen stage no longer resolves, the interviewer is told exactly why
 * rather than handed whatever stage sits at that order now — an interviewer that quietly
 * switched stage halfway through would be worse than one told it has none. The four lines are
 * the spec's; each states a different fact about the loop, and the round type is always there
 * so the interviewer still knows what kind of conversation this is.
 */
export function describeStage(
  roundType: RoundType,
  session: Pick<MockSession, 'stageOrder' | 'researchedAt'>,
  map: ProcessMap | undefined,
): string {
  const recorded = session.researchedAt
  const matches = recorded !== undefined && map !== undefined && map.researchedAt === recorded
  if (matches && map && session.stageOrder !== undefined) {
    const stage = map.stages.find((s) => s.order === session.stageOrder)
    if (stage) return summarizeStage({ stage, of: map.stages.length })
  }
  const head = `Round type: ${roundType} — `
  if (recorded !== undefined) {
    // A recorded map that still matches but names no stage we can find says the same thing as
    // no stageOrder at all: this round is not on the loop the session started against.
    return head + (matches ? 'not placed on the reported loop' : 'the loop was re-researched during this mock')
  }
  return head + (map ? 'the loop was researched during this mock' : 'the loop has not been researched')
}

const LABEL: Record<NonNullable<MockTurn['kind']>, string> = {
  question: 'Interviewer (question)',
  'follow-up': 'Interviewer (follow-up)',
  closing: 'Interviewer (closing)',
}

/**
 * The conversation so far, as both flows read it. The interviewer's kind is on the label
 * because everything downstream depends on it: the next turn is a follow-up or a new
 * question, and the debrief groups what was said under the question it answered. In coding
 * mode the candidate's turn is fenced — their answer is a program, and unfenced its blank
 * lines and indentation read as the end of the turn rather than part of it.
 *
 * Four backticks, not three: coding mode is exactly the mode people paste code in, and code
 * pasted out of a README, a chat or a markdown comment carries a three-backtick fence of its
 * own. Nothing escapes it, so a three-backtick fence here would end their turn on that line,
 * and where the candidate's words stop is what tells the interviewer — and the debrief, which
 * reads this same text — whose sentence is whose.
 */
export function transcriptText(transcript: MockTurn[], mode: PracticeMode): string {
  if (transcript.length === 0) return '(none yet — this is the first question)'
  return transcript
    .map((t) => {
      if (t.role === 'model') return `${LABEL[t.kind ?? 'question']}: ${t.text}`
      return mode === 'coding' ? `Candidate:\n\`\`\`\`\n${t.text}\n\`\`\`\`` : `Candidate: ${t.text}`
    })
    .join('\n')
}

/**
 * An empty section says it is empty. A blank one reads as a heading the model may fill in
 * itself, which is how an interviewer ends up citing a source list nobody handed it.
 */
export function orNone(s: string): string {
  return s.trim() === '' ? '(none)' : s
}

export interface MockTurnPromptInput {
  jobSummary: string
  stageSummary: string
  reportedSummary: string
  factsSummary: string
  mode: PracticeMode
  questionsAsked: number
  previousQuestions: string[]
  transcript: MockTurn[]
}

/**
 * The standing context first — the company, the stage, what people were asked there, who the
 * candidate is — then the three things that change every turn: the mode, how far into the six
 * questions this is, and what has already been said. The transcript goes last because it is
 * what the model is answering; the count is separate from it because the closing rule is
 * counted in code, and a model asked to count its own questions gets it wrong.
 */
export function buildMockTurnPrompt(input: MockTurnPromptInput): { system: string; parts: Part[] } {
  const parts: Part[] = [
    { text: `The job:\n${input.jobSummary}` },
    { text: `The stage:\n${input.stageSummary}` },
    { text: `Questions people report being asked at this company:\n${orNone(input.reportedSummary)}` },
    { text: `Candidate facts:\n${orNone(input.factsSummary)}` },
    { text: `Mode: ${input.mode}` },
    { text: `Questions asked so far: ${input.questionsAsked} of ${MAX_QUESTIONS}` },
    { text: `Asked in earlier sessions:\n${orNone(input.previousQuestions.join('\n'))}` },
    { text: `Transcript:\n${transcriptText(input.transcript, input.mode)}` },
  ]
  return { system: MOCK_TURN_SYSTEM, parts }
}
