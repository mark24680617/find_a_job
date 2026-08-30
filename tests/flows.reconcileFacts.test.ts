import { describe, it, expect, vi } from 'vitest'
import { runReconcileFacts } from '@/ai/flows/reconcileFacts'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { ReconcileOutSchema, type ReconcileOut } from '@/ai/schemas'
import type { Fact, FactAdd } from '@/lib/types'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the real
// budget — everything except the network. What is under test is what happens AFTER the model
// answers: the two relationships between fields that a shape check cannot see, and which one
// this flow deliberately leaves to the route.

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns the payments service', sourceSnippet: 'Owns payments', tags: ['backend'] },
  { id: 'f2', claim: 'Led a migration to Kafka', sourceSnippet: 'Led migration', tags: ['infra'] },
]

const extracted: FactAdd[] = [
  {
    claim: 'Owns the payments service handling 12,000 requests/day',
    sourceSnippet: '12,000 requests/day',
    tags: ['backend'],
  },
]

const input = () => ({ facts, extracted })

const q = (over: Partial<ReconcileOut['questions'][number]> = {}): ReconcileOut['questions'][number] => ({
  id: 'c1',
  question: 'Is that the same payments service?',
  why: 'One is an update, the other is a second service.',
  options: [
    { label: 'The same service — merge the number in', value: 'merge' },
    { label: 'A different service — add it', value: 'add' },
  ],
  recommended: 'merge',
  allowMultiple: false,
  allowOther: false,
  ...over,
})

const out = (over: Partial<ReconcileOut> = {}): ReconcileOut => ({
  adds: [],
  updates: [{ id: 'f1', claim: 'Owns the payments service handling 12,000 requests/day', tags: ['backend'] }],
  skips: [],
  questions: [],
  ...over,
})

const returning = (...outputs: ReconcileOut[]) => {
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

describe('runReconcileFacts — the request', () => {
  it('spends 1024 thinking tokens on the schema, at the default temperature', async () => {
    const generate = returning(out())
    await runReconcileFacts(input(), generate)

    const req = sent(generate, 0)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 1024 } })
    expect(req.output).toEqual({ schema: ReconcileOutSchema })
    expect(req.system).toContain('You reconcile one fresh extraction against a profile')
  })

  it('carries refinement guidance into the prompt', async () => {
    const generate = returning(out())
    await runReconcileFacts({ ...input(), guidance: 'f2 is a different migration' }, generate)
    const body = sent(generate, 0).prompt.map((p) => p.text ?? '').join('\n')
    expect(body).toContain('f2 is a different migration')
  })
})

describe('runReconcileFacts — the changeset', () => {
  it('returns a changeset with no questions in one call', async () => {
    const first = out()
    const generate = returning(first)
    await expect(runReconcileFacts(input(), generate)).resolves.toEqual(first)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('accepts an empty changeset — the document said nothing new', async () => {
    const nothing = out({ updates: [], skips: [{ id: 'f1', reason: 'already stated' }] })
    const generate = returning(nothing)
    await expect(runReconcileFacts(input(), generate)).resolves.toEqual(nothing)
  })

  it('does not check an update id against the bank — that is the apply route’s job', async () => {
    // The bank is read again at apply time and may have moved on, so the only check worth
    // making is against the live one. A flow guard here would be a second, staler answer.
    const ghost = out({ updates: [{ id: 'f99', claim: 'Owns something', tags: [] }] })
    const generate = returning(ghost)
    await expect(runReconcileFacts(input(), generate)).resolves.toEqual(ghost)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

describe('runReconcileFacts — the recommended-option guard', () => {
  it('returns a round whose recommendations are real options, without a second call', async () => {
    const first = out({ questions: [q(), q({ id: 'c2', recommended: 'add' })] })
    const generate = returning(first)
    await expect(runReconcileFacts(input(), generate)).resolves.toEqual(first)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('regenerates once when a recommendation names no option, and returns the corrected round', async () => {
    const bad = out({ questions: [q({ recommended: 'not-an-option' })] })
    const good = out({ questions: [q()] })
    const generate = returning(bad, good)

    await expect(runReconcileFacts(input(), generate)).resolves.toEqual(good)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('names the question and the phantom, and keeps the original prompt in front of the model', async () => {
    const bad = out({ questions: [q({ id: 'c2', recommended: 'ghost' })] })
    const generate = returning(bad, out({ questions: [q({ id: 'c2' })] }))
    await runReconcileFacts(input(), generate)

    const text = correction(generate)
    expect(text).toContain('c2')
    expect(text).toContain('ghost')
    expect(sent(generate, 1).prompt.slice(0, -1)).toEqual(sent(generate, 0).prompt)
    expect(sent(generate, 1).output).toEqual({ schema: ReconcileOutSchema })
  })

  it('demands the whole changeset back, not just the questions', async () => {
    // A retry that returned four good questions and dropped the changeset would otherwise pass.
    const bad = out({ questions: [q({ recommended: 'ghost' })] })
    const generate = returning(bad, out({ questions: [q()] }))
    await runReconcileFacts(input(), generate)
    expect(correction(generate)).toContain('the whole')
    expect(correction(generate)).toContain('changeset as well as the questions')
  })

  it('throws rather than returning a phantom recommendation, and does not try a third time', async () => {
    const bad = out({ questions: [q({ recommended: 'ghost' })] })
    const generate = returning(bad, bad)
    const promise = runReconcileFacts(input(), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow(/ghost/)
    await expect(promise).rejects.toThrow(/c1/)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('reports every bad question in one correction, each named once in the reasons', async () => {
    const bad = out({
      questions: [q({ recommended: 'ghost' }), q({ id: 'c2', recommended: 'phantom' })],
    })
    const generate = returning(bad, out({ questions: [q(), q({ id: 'c2', recommended: 'add' })] }))
    await runReconcileFacts(input(), generate)

    const r = reasons(generate)
    expect(r.match(/c1/g)).toHaveLength(1)
    expect(r.match(/c2/g)).toHaveLength(1)
    expect(r).toContain('ghost')
    expect(r).toContain('phantom')
  })
})

describe('runReconcileFacts — the unique-id guard', () => {
  it('regenerates once when two questions share an id, then returns the corrected round', async () => {
    // Two c1s collide in the panel's selection map — one answer would overwrite the other.
    const bad = out({ questions: [q(), q({ id: 'c1', question: 'A second question on c1' })] })
    const good = out({ questions: [q(), q({ id: 'c2', recommended: 'add' })] })
    const generate = returning(bad, good)

    await expect(runReconcileFacts(input(), generate)).resolves.toEqual(good)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(reasons(generate)).toContain('appears more than once')
  })

  it('throws rather than returning a duplicate id, and does not try a third time', async () => {
    const bad = out({ questions: [q(), q({ id: 'c1' })] })
    const generate = returning(bad, bad)
    const promise = runReconcileFacts(input(), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow(/c1 appears more than once/)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
