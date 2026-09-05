import { describe, it, expect, vi } from 'vitest'
import { runMockDebrief, type MockDebriefInput } from '@/ai/flows/mockDebrief'
import { runMockTurn, type MockTurnInput } from '@/ai/flows/mockTurn'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { MockDebriefOutSchema, MockTurnOutSchema } from '@/ai/schemas'
import type { ReportedQuestion } from '@/lib/practice'
import type { Fact, MockTurn, ParsedJob } from '@/lib/types'

// The Genkit call is injected, so these exercise the real prompts, the real schemas, the real
// budgets and the real guards — everything except the network. What is being pinned is that a
// citation the reported list cannot vouch for, a quote the candidate did not write, a
// rehearsal line that is not one of their facts, and code read outside a coding round never
// leave the flow, whatever the model returned.

interface SentRequest {
  system?: string
  prompt: { text?: string }[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}

const sent = (generate: { mock: { calls: unknown[][] } }) => generate.mock.calls[0][0] as SentRequest

const textOf = (req: SentRequest) => req.prompt.map((p) => p.text ?? '').join('\n')

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['Owns the ledger write path'],
  gates: [{ requirement: '5 years of Go', met: 'no', posture: 'explicit', note: 'Minimum 5 years' }],
  themes: ['payments'],
  scope: 'per-application',
  advisory: 'Apply only with a referral.',
}

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service at 99.95% success', sourceSnippet: 'Payments team', tags: ['payments'] },
]

const reported: ReportedQuestion[] = [
  {
    sourceId: 's1',
    host: 'reddit.com',
    url: 'https://www.reddit.com/r/x/1',
    text: 'Walk me through the ledger rewrite',
    firstHand: true,
    stale: false,
    year: '2026',
  },
]

const AT = '2026-09-03T10:00:00.000Z'

const answered: MockTurn[] = [
  { role: 'model', text: 'Walk me through the ledger rewrite.', kind: 'question', at: AT },
  { role: 'user', text: 'I led it over two quarters.\nWe cut reconciliation time by half.', at: AT },
]

const afterFollowUp: MockTurn[] = [
  ...answered,
  { role: 'model', text: 'What did you decide against?', kind: 'follow-up', at: AT },
  { role: 'user', text: 'A dual-write.', at: AT },
]

const turnInput: MockTurnInput = {
  parsed,
  stageSummary: 'Stage 2 of 3: Coding round · video · 60 min',
  reported,
  facts,
  mode: 'conversation',
  questionsAsked: 2,
  previousQuestions: ['How do you test?'],
  transcript: answered,
}

const aQuestion = { say: 'Tell me about a system you owned end to end.', sourceId: null, kind: 'question' as const }

describe('runMockTurn', () => {
  it('spends 512 thinking tokens at temperature 0 against the turn schema', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: aQuestion }))
    await runMockTurn(turnInput, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 512 } })
    expect(req.output).toEqual({ schema: MockTurnOutSchema })
    expect(req.system).toContain("You are the interviewer for one stage of one company's loop")
  })

  it('sends the stage, the reported questions, the count and a snippet-free fact summary', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: aQuestion }))
    await runMockTurn(turnInput, generate)

    const text = textOf(sent(generate))
    expect(text).toContain('Stage 2 of 3: Coding round')
    expect(text).toContain('Walk me through the ledger rewrite')
    expect(text).toContain('Questions asked so far: 2 of 6')
    expect(text).toContain('f1: Owns a payments service at 99.95% success')
    // Provenance snippets stay in the vault; the interviewer sees the claims.
    expect(text).not.toContain('Payments team')
  })

  it('keeps a citation whose reported question is in the turn, wrapped across lines', async () => {
    const generate = vi.fn<GenerateCall>(() =>
      Promise.resolve({
        output: { say: 'One people report from this round:\nWalk me through the\nledger rewrite.', sourceId: 's1', kind: 'question' },
      }),
    )
    const out = await runMockTurn(turnInput, generate)
    expect(out.sourceId).toBe('s1')
  })

  it('drops a sourceId the turn does not actually quote, and keeps the question', async () => {
    const generate = vi.fn<GenerateCall>(() =>
      Promise.resolve({ output: { say: 'Tell me about the ledger rewrite.', sourceId: 's1', kind: 'question' } }),
    )
    const out = await runMockTurn(turnInput, generate)
    expect(out.sourceId).toBeNull()
    expect(out.say).toBe('Tell me about the ledger rewrite.')
  })

  it('turns a second consecutive follow-up into a question, so the six-question count moves', async () => {
    const generate = vi.fn<GenerateCall>(() =>
      Promise.resolve({ output: { say: 'And what did that cost you?', sourceId: null, kind: 'follow-up' } }),
    )
    const out = await runMockTurn({ ...turnInput, transcript: afterFollowUp }, generate)
    expect(out.kind).toBe('question')
  })

  it('fails after a second miss rather than storing a turn the schema refused', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: { say: '', sourceId: null, kind: 'question' } }))
    await expect(runMockTurn(turnInput, generate)).rejects.toBeInstanceOf(FlowOutputError)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

const debriefInput: MockDebriefInput = {
  parsed,
  stageSummary: 'Stage 2 of 3: Coding round · video · 60 min',
  mode: 'conversation',
  facts,
  transcript: answered,
}

const debriefOut = {
  overall: 'A clear answer, short on numbers.',
  answers: [
    {
      question: 'Walk me through the ledger rewrite.',
      landed: ['You named the decision you made.'],
      vague: ['No dates for either quarter.'],
      unsupported: [
        { said: 'We cut reconciliation time by half.', why: 'No fact records that result.' },
        { said: 'I ran the whole migration alone.', why: 'Nothing supports sole ownership.' },
      ],
    },
  ],
  code: { strengths: ['Clear names.'], gaps: ['No empty-input case.'] },
  rehearse: ['Owns a payments service at 99.95% success', 'Ten years of Go'],
}

describe('runMockDebrief', () => {
  it('spends 1024 thinking tokens at temperature 0 against the debrief schema', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: debriefOut }))
    await runMockDebrief(debriefInput, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 1024 } })
    expect(req.output).toEqual({ schema: MockDebriefOutSchema })
    expect(req.system).toContain('You debrief a mock interview for the candidate who just gave it')
    expect(textOf(req)).toContain('Candidate: I led it over two quarters.')
  })

  it('drops a sentence the candidate never wrote, a rehearsal line that is not a fact, and code outside coding', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: debriefOut }))
    const out = await runMockDebrief(debriefInput, generate)

    expect(out.answers).toHaveLength(1)
    expect(out.answers[0].unsupported).toEqual([
      { said: 'We cut reconciliation time by half.', why: 'No fact records that result.' },
    ])
    expect(out.rehearse).toEqual(['Owns a payments service at 99.95% success'])
    expect(out.code).toBeNull()
  })

  it('keeps the code notes in a coding round', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: debriefOut }))
    const out = await runMockDebrief({ ...debriefInput, mode: 'coding' }, generate)
    expect(out.code).toEqual({ strengths: ['Clear names.'], gaps: ['No empty-input case.'] })
  })

  it('fails after a second miss rather than returning half a debrief', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: { overall: 'x' } }))
    await expect(runMockDebrief(debriefInput, generate)).rejects.toBeInstanceOf(FlowOutputError)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
