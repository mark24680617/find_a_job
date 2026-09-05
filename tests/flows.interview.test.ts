import { describe, it, expect, vi } from 'vitest'
import { runInterviewInterpret } from '@/ai/flows/interviewInterpret'
import { runPrepBrief } from '@/ai/flows/prepBrief'
import { type GenerateCall } from '@/ai/genkit'
import { InterviewInterpretOutSchema, PrepBriefOutSchema } from '@/ai/schemas'
import type { ReportedQuestion, StagePlacement } from '@/lib/practice'
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

// What the model returns and what the flow returns are no longer the same shape: every prepared
// question comes back with a sourceId, `null` when the model wrote the question itself, and the
// flow hands on the stored shape — a citation that checked out, or no sourceId at all.
const briefOut = {
  likelyTopics: ['Why this role, and the ledger rewrite'],
  questionsToPrepare: [
    { q: 'Walk me through your background', angle: 'f1 — the payments service', sourceId: null },
  ],
  questionsToAsk: ['Who owns reconciliation today?'],
  factsToRehearse: ['Owns a payments service at 99.95% success'],
  redFlags: ['Three years against a stated five-year minimum — say so plainly.'],
}

const briefStored = {
  ...briefOut,
  questionsToPrepare: [{ q: 'Walk me through your background', angle: 'f1 — the payments service' }],
}

const briefWith = (question: { q: string; angle: string; sourceId: string | null }) => ({
  ...briefOut,
  questionsToPrepare: [question],
})

const placement: StagePlacement = {
  stage: {
    order: 2,
    name: 'Coding round',
    kind: 'technical',
    format: 'video',
    duration: '60 minutes',
    whatItProbes: 'Whether you can write working code with someone watching.',
    tips: ['Say your assumptions out loud.'],
    sourceIds: ['s1'],
    confidence: 'community',
  },
  of: 4,
}

const reported: ReportedQuestion[] = [
  {
    sourceId: 's1',
    host: 'reddit.com',
    url: 'https://www.reddit.com/r/cscareerquestions/comments/a',
    text: 'How do you keep a ledger consistent under retries?',
    firstHand: true,
    stale: false,
    year: '2025',
  },
]

describe('runPrepBrief', () => {
  it('returns the brief in the shape the record stores', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    await expect(
      runPrepBrief({ roundType: 'recruiter-screen', parsed, facts }, generate),
    ).resolves.toEqual(briefStored)
  })

  it('spends 1024 thinking tokens at temperature 0 — five sections, each a judgment', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    await runPrepBrief({ roundType: 'recruiter-screen', parsed, facts }, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 1024 } })
    expect(req.output).toEqual({ schema: PrepBriefOutSchema })
    expect(req.system).toContain('You write an interview prep brief for one round')
  })

  it('sends the round type, the compact posting and a snippet-free fact summary', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
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
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    await expect(
      runPrepBrief({ roundType: 'onsite', parsed, facts: [] }, generate),
    ).resolves.toEqual(briefStored)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('sends the mapped stage and the questions people report when the loop has been researched', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    await runPrepBrief({ roundType: 'technical', parsed, facts, stage: placement, reported }, generate)

    const text = textOf(sent(generate))
    expect(text).toContain('Stage 2 of 4: Coding round · video · 60 minutes')
    expect(text).toContain('What it probes: Whether you can write working code with someone watching.')
    expect(text).toContain('- Say your assumptions out loud.')
    expect(text).toContain('s1 [first-hand; 2025]: How do you keep a ledger consistent under retries?')
  })

  it('sends neither part when the loop has not been researched', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    await runPrepBrief({ roundType: 'technical', parsed, facts }, generate)

    const text = textOf(sent(generate))
    expect(text).not.toContain('The stage this round is:')
    expect(text).not.toContain('Questions people report being asked at this company:')
  })

  it('says so when the map turned up no reported question at all', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    await runPrepBrief({ roundType: 'technical', parsed, facts, reported: [] }, generate)

    expect(textOf(sent(generate))).toContain(
      'Questions people report being asked at this company:\n(none)',
    )
  })

  it('keeps a citation whose question is one that source reported, word for word', async () => {
    const cited = {
      q: 'How do you keep a ledger consistent under retries?',
      angle: 'f1 — the payments service',
      sourceId: 's1',
    }
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefWith(cited) }))
    const out = await runPrepBrief({ roundType: 'technical', parsed, facts, reported }, generate)

    expect(out.questionsToPrepare).toEqual([{ q: cited.q, angle: cited.angle, sourceId: 's1' }])
  })

  // Dropped, not retried: the question is still worth preparing, and a citation nobody can check
  // is the one thing the screen may not show.
  it('drops a citation naming a source we never handed over, and keeps the question', async () => {
    const generate = vi.fn<GenerateCall>(() =>
      Promise.resolve({
        output: briefWith({
          q: 'How do you keep a ledger consistent under retries?',
          angle: 'f1 — the payments service',
          sourceId: 's9',
        }),
      }),
    )
    const out = await runPrepBrief({ roundType: 'technical', parsed, facts, reported }, generate)

    expect(out.questionsToPrepare[0].q).toBe('How do you keep a ledger consistent under retries?')
    expect(out.questionsToPrepare[0].sourceId).toBeUndefined()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('stores no sourceId at all for a question the model wrote itself', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    const out = await runPrepBrief({ roundType: 'technical', parsed, facts, reported }, generate)

    expect(out.questionsToPrepare[0].sourceId).toBeUndefined()
    expect(JSON.stringify(out)).not.toContain('sourceId')
  })

  it('leaves basis to the route — the flow never sees which map it was handed', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: briefOut }))
    const out = await runPrepBrief({ roundType: 'technical', parsed, facts, stage: placement, reported }, generate)

    expect('basis' in out).toBe(false)
  })
})
