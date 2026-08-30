import { describe, it, expect, vi } from 'vitest'
import { runInterviewInterpret } from '@/ai/flows/interviewInterpret'
import { runPrepBrief } from '@/ai/flows/prepBrief'
import { type GenerateCall } from '@/ai/genkit'
import { InterviewInterpretOutSchema, PrepBriefOutSchema } from '@/ai/schemas'
import type { Fact, ParsedJob } from '@/lib/types'

// The Genkit call is injected, so these exercise the real prompts, the real schemas and the
// real budgets — everything except the network.

interface SentRequest {
  system?: string
  prompt: { text?: string }[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}

const sent = (generate: { mock: { calls: unknown[][] } }) =>
  generate.mock.calls[0][0] as SentRequest

const textOf = (req: SentRequest) => req.prompt.map((p) => p.text ?? '').join('\n')

const NOTICE = `30-minute call with our recruiter Ana Reyes next Thursday 2pm PT.`

const interpreted = {
  roundType: 'recruiter-screen' as const,
  datetime: null,
  people: ['Ana Reyes — Recruiting'],
  askHuman: [{ question: 'Which Thursday does the notice mean?', why: 'No date is stated.' }],
}

describe('runInterviewInterpret', () => {
  it('returns the typed round', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: interpreted }))
    await expect(runInterviewInterpret({ noticeText: NOTICE }, generate)).resolves.toEqual(interpreted)
  })

  it('spends 256 thinking tokens at temperature 0 — one short document, read once', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: interpreted }))
    await runInterviewInterpret({ noticeText: NOTICE }, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 256 } })
    expect(req.output).toEqual({ schema: InterviewInterpretOutSchema })
    expect(req.system).toContain('You interpret an interview notice')
  })

  it('sends the notice itself', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: interpreted }))
    await runInterviewInterpret({ noticeText: NOTICE }, generate)
    expect(textOf(sent(generate))).toContain(NOTICE)
  })

  it('keeps a null datetime — an unstated time is stated as unknown, never guessed', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: interpreted }))
    const out = await runInterviewInterpret({ noticeText: NOTICE }, generate)
    expect(out.datetime).toBeNull()
  })
})

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['Owns the ledger write path'],
  gates: [
    { requirement: '5 years of Go', met: 'no', posture: 'explicit', note: 'Minimum 5 years' },
  ],
  themes: ['payments'],
  scope: 'per-application',
  advisory: 'Apply only with a referral.',
}

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service at 99.95% success', sourceSnippet: 'Payments team', tags: ['payments'] },
]

const brief = {
  likelyTopics: ['Why this role, and the ledger rewrite'],
  questionsToPrepare: [{ q: 'Walk me through your background', angle: 'f1 — the payments service' }],
  questionsToAsk: ['Who owns reconciliation today?'],
  factsToRehearse: ['Owns a payments service at 99.95% success'],
  redFlags: ['Three years against a stated five-year minimum — say so plainly.'],
}

describe('runPrepBrief', () => {
  it('returns the brief', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: brief }))
    await expect(
      runPrepBrief({ roundType: 'recruiter-screen', parsed, facts }, generate),
    ).resolves.toEqual(brief)
  })

  it('spends 1024 thinking tokens at temperature 0 — five sections, each a judgment', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: brief }))
    await runPrepBrief({ roundType: 'recruiter-screen', parsed, facts }, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 1024 } })
    expect(req.output).toEqual({ schema: PrepBriefOutSchema })
    expect(req.system).toContain('You write an interview prep brief for one round')
  })

  it('sends the round type, the compact posting and a snippet-free fact summary', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: brief }))
    await runPrepBrief({ roundType: 'technical', parsed, facts }, generate)

    const text = textOf(sent(generate))
    expect(text).toContain('Round type: technical')
    expect(text).toContain('Marram Systems')
    expect(text).toContain('Owns the ledger write path')
    expect(text).toContain('[met=no, explicit] 5 years of Go')
    expect(text).toContain('Themes: payments')
    expect(text).toContain('f1: Owns a payments service at 99.95% success')
    // Provenance snippets stay in the vault; the brief is written from the claims.
    expect(text).not.toContain('Payments team')
  })

  it('writes a brief for a candidate with no facts yet', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: brief }))
    await expect(
      runPrepBrief({ roundType: 'onsite', parsed, facts: [] }, generate),
    ).resolves.toEqual(brief)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
