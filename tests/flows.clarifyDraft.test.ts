import { describe, it, expect, vi } from 'vitest'
import { runClarifyDraft } from '@/ai/flows/clarifyDraft'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { ClarifyDraftOutSchema, type ClarifyDraftOut } from '@/ai/schemas'
import type { Fact, Question } from '@/lib/types'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real budget — everything except the network. What is under test is what happens AFTER the
// model answers: a `recommended` that names no real option is a default the UI cannot honour,
// and it is a relationship between two fields, not a shape, so the schema cannot catch it.

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: '', tags: ['payments'] },
  { id: 'f2', claim: 'Led the migration of 14 services from RabbitMQ to Kafka', sourceSnippet: '', tags: ['infra'] },
]

const question: Question = {
  q: 'Why do you want to work here? Write a short cover letter.',
  constraints: { limit: 200, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
}

const input = () => ({
  question,
  jdText: 'Own the payments platform. Deep reliability work. Minimum 5 years backend.',
  facts,
  standardAnswers: {},
  clarifyAnswers: [],
})

const q = (over: Partial<ClarifyDraftOut['questions'][number]> = {}): ClarifyDraftOut['questions'][number] => ({
  id: 'c1',
  question: 'Which experience should lead?',
  why: 'The role rewards payments depth.',
  options: [
    { label: 'The payments service', value: 'payments' },
    { label: 'The Kafka migration', value: 'kafka' },
  ],
  recommended: 'payments',
  allowMultiple: false,
  allowOther: false,
  ...over,
})

const out = (...questions: ClarifyDraftOut['questions']): ClarifyDraftOut => ({ questions })

const returning = (...outputs: ClarifyDraftOut[]) => {
  const generate = vi.fn<GenerateCall>()
  for (const output of outputs) generate.mockImplementationOnce(() => Promise.resolve({ output }))
  generate.mockImplementation(() => Promise.reject(new Error('unexpected extra model call')))
  return generate
}

interface SentRequest {
  system?: string
  prompt: { text?: string }[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}
const sent = (generate: ReturnType<typeof returning>, n: number) =>
  generate.mock.calls[n][0] as unknown as SentRequest

const correction = (generate: ReturnType<typeof returning>) => {
  const prompt = sent(generate, 1).prompt
  return prompt[prompt.length - 1].text ?? ''
}

/** Just the rejection reasons, without the rejected round echoed above them. */
const reasons = (generate: ReturnType<typeof returning>) =>
  correction(generate).split('Why they were rejected:')[1] ?? ''

describe('runClarifyDraft — the request', () => {
  it('spends 1024 thinking tokens on the schema, at the default temperature', async () => {
    const generate = returning(out(q()))
    await runClarifyDraft(input(), generate)

    const req = sent(generate, 0)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 1024 } })
    expect(req.output).toEqual({ schema: ClarifyDraftOutSchema })
    expect(req.system).toContain('You set up one job-application answer before it is written')
  })
})

describe('runClarifyDraft — the recommended-option guard', () => {
  it('returns a first round whose recommendations are real options, without a second call', async () => {
    const first = out(q(), q({ id: 'c2', recommended: 'kafka' }))
    const generate = returning(first)
    await expect(runClarifyDraft(input(), generate)).resolves.toEqual(first)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('accepts an empty round — the facts already settle the answer', async () => {
    const empty = out()
    const generate = returning(empty)
    await expect(runClarifyDraft(input(), generate)).resolves.toEqual(empty)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('regenerates once when a recommendation names no option, and returns the corrected round', async () => {
    const bad = out(q({ recommended: 'not-an-option' }))
    const good = out(q())
    const generate = returning(bad, good)

    await expect(runClarifyDraft(input(), generate)).resolves.toEqual(good)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('tells the model which question and which non-option, and keeps the original prompt in front of it', async () => {
    const bad = out(q({ id: 'c2', recommended: 'ghost' }))
    const generate = returning(bad, out(q({ id: 'c2' })))
    await runClarifyDraft(input(), generate)

    const text = correction(generate)
    expect(text).toContain('c2')
    expect(text).toContain('ghost')
    // Only the correction is appended; the original prompt is still there.
    expect(sent(generate, 1).prompt.slice(0, -1)).toEqual(sent(generate, 0).prompt)
    expect(sent(generate, 1).output).toEqual({ schema: ClarifyDraftOutSchema })
  })

  it('throws rather than returning a round with a phantom recommendation, and does not try a third time', async () => {
    const bad = out(q({ recommended: 'ghost' }))
    const generate = returning(bad, bad)
    const promise = runClarifyDraft(input(), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow(/ghost/)
    await expect(promise).rejects.toThrow(/c1/)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('reports every bad question in one correction, each named once in the reasons', async () => {
    const bad = out(q({ recommended: 'ghost' }), q({ id: 'c2', recommended: 'phantom' }))
    const generate = returning(bad, out(q(), q({ id: 'c2', recommended: 'kafka' })))
    await runClarifyDraft(input(), generate)

    const r = reasons(generate)
    expect(r.match(/c1/g)).toHaveLength(1)
    expect(r.match(/c2/g)).toHaveLength(1)
    expect(r).toContain('ghost')
    expect(r).toContain('phantom')
  })
})

describe('runClarifyDraft — the unique-id guard', () => {
  it('accepts a round whose ids are all distinct, without a second call', async () => {
    const first = out(q(), q({ id: 'c2', recommended: 'kafka' }))
    const generate = returning(first)
    await expect(runClarifyDraft(input(), generate)).resolves.toEqual(first)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('regenerates once when two questions share an id, then returns the corrected round', async () => {
    // Two c1s collide in the draft route's merge-by-id — one answer would overwrite the other.
    const bad = out(q(), q({ id: 'c1', question: 'A second question that reused c1', recommended: 'kafka' }))
    const good = out(q(), q({ id: 'c2', recommended: 'kafka' }))
    const generate = returning(bad, good)

    await expect(runClarifyDraft(input(), generate)).resolves.toEqual(good)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(reasons(generate)).toContain('appears more than once')
  })

  it('throws rather than returning a round with a duplicate id, and does not try a third time', async () => {
    const bad = out(q(), q({ id: 'c1', recommended: 'kafka' }))
    const generate = returning(bad, bad)
    const promise = runClarifyDraft(input(), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow(/c1 appears more than once/)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
