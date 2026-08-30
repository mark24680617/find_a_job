import { describe, it, expect, vi } from 'vitest'
import { runAnswerDraft } from '@/ai/flows/answerDraft'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { AnswerDraftOutSchema, type AnswerDraftOut } from '@/ai/schemas'
import type { Fact, ParsedJob, Question } from '@/lib/types'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real budget — everything except the network. What is under test is what happens AFTER the
// model answers: a limit is arithmetic the model is bad at, and a citation pointing at a fact
// that does not exist (or at words the answer does not contain) is the exact failure this
// product exists to prevent. Neither can be enforced by a schema, so both are checked here.

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: '', tags: ['payments'] },
  { id: 'f2', claim: 'Cut p99 checkout latency from 840ms to 210ms', sourceSnippet: '', tags: ['performance'] },
]

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['remote, UK hours'],
  gates: [],
  themes: ['payments'],
  scope: 'per-application',
  advisory: '',
}

const question = (constraints: Question['constraints']): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints,
  askHuman: [],
  status: 'pending',
})

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

const input = (constraints: Question['constraints'] = { limit: 10, unit: 'words', type: 'long-text', required: true }) => ({
  question: question(constraints),
  parsed,
  jdText: 'Own the ledger and settlement services. Go and PostgreSQL. Minimum 5 years.',
  facts,
  standardAnswers: {},
  voiceRules: [],
  humanAnswers: [],
  clarifyAnswers: [],
})

const draft = (over: Partial<AnswerDraftOut> = {}): AnswerDraftOut => ({
  text: words(5),
  citations: [],
  askHuman: [],
  ...over,
})

const returning = (...outputs: AnswerDraftOut[]) => {
  const generate = vi.fn<GenerateCall>()
  for (const output of outputs) generate.mockImplementationOnce(() => Promise.resolve({ output }))
  // Anything past the scripted answers would be a call this flow is not allowed to make.
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

/** The text appended to the retry — what the model is told it got wrong. */
const correction = (generate: ReturnType<typeof returning>) => {
  const prompt = sent(generate, 1).prompt
  return prompt[prompt.length - 1].text ?? ''
}

/** Just the rejection reasons, without the rejected attempt quoted above them. */
const reasons = (generate: ReturnType<typeof returning>) =>
  correction(generate).split('Why it was rejected:')[1] ?? ''

describe('runAnswerDraft — the request', () => {
  it('spends 1024 thinking tokens on the schema, at the default temperature', async () => {
    const generate = returning(draft())
    await runAnswerDraft(input(), generate)

    const req = sent(generate, 0)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 1024 } })
    expect(req.output).toEqual({ schema: AnswerDraftOutSchema })
    expect(req.system).toContain('You draft one job-application answer')
  })
})

describe('runAnswerDraft — the correction', () => {
  const long: Question['constraints'] = { type: 'long-text', required: true }
  const text = 'I cut p99 checkout latency from 840ms to 210ms on a service doing 12,000 requests a day.'

  it('shows the model the answer it is being asked to repair', async () => {
    // Without it the model is repairing text it cannot see: nothing in the original prompt
    // says what it wrote, and "that span is not in your answer" has no referent.
    const bad = draft({ text, citations: [{ claimSpan: 'cut latency by 75%', factId: 'f2' }] })
    const generate = returning(bad, draft({ text, citations: [] }))
    await runAnswerDraft(input(long), generate)

    const sentBack = correction(generate)
    expect(sentBack).toContain(text)
    expect(sentBack).toContain('f2 -> "cut latency by 75%"')
  })

  it('says so plainly when the rejected attempt cited nothing', async () => {
    const generate = returning(draft({ text: words(14), citations: [] }), draft({ text: words(9) }))
    await runAnswerDraft(input(), generate)
    expect(correction(generate)).toContain('(none)')
  })

  it('asks for the whole structured output, not just the answer text', async () => {
    // "Return only the answer" reads as the text field on a structured-output call: a retry
    // that dropped its citations would then pass every check by having nothing left to
    // check, and ship an uncited draft — the invariant failing through its own correction.
    const generate = returning(draft({ text: words(14) }), draft({ text: words(9) }))
    await runAnswerDraft(input(), generate)

    expect(correction(generate)).toContain('citations')
    expect(correction(generate)).not.toContain('only the answer')
    // And the retry is still bound to the full schema, not a narrowed one.
    expect(sent(generate, 1).output).toEqual({ schema: AnswerDraftOutSchema })
  })
})

describe('runAnswerDraft — the limit guard', () => {
  it('returns a first draft that is inside the limit, without a second call', async () => {
    const out = draft({ text: words(10) })
    const generate = returning(out)
    await expect(runAnswerDraft(input(), generate)).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('regenerates once when the draft is over, and returns the corrected one', async () => {
    const over = draft({ text: words(14) })
    const within = draft({ text: words(9) })
    const generate = returning(over, within)

    await expect(runAnswerDraft(input(), generate)).resolves.toEqual(within)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('tells the model the exact count and the limit it missed', async () => {
    const generate = returning(draft({ text: words(14) }), draft({ text: words(9) }))
    await runAnswerDraft(input(), generate)

    const text = correction(generate)
    expect(text).toContain('14')
    expect(text).toContain('10')
    expect(text).toMatch(/words/)
    // The original prompt is still in front of it; only the correction is appended.
    expect(sent(generate, 1).prompt.slice(0, -1)).toEqual(sent(generate, 0).prompt)
  })

  it('throws rather than returning an over-limit answer, and does not try a third time', async () => {
    const generate = returning(draft({ text: words(14) }), draft({ text: words(12) }))
    const promise = runAnswerDraft(input(), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    // The counts are in the message: the UI shows it verbatim, and "over limit" alone
    // tells the person nothing about how far over it is.
    await expect(promise).rejects.toThrow(/over the limit: 12 words against a limit of 10/)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('counts characters when the limit is in characters', async () => {
    const constraints: Question['constraints'] = { limit: 20, unit: 'chars', type: 'short-text', required: true }
    // Three words, thirty characters: inside any word limit, over this one.
    const generate = returning(draft({ text: 'aaaaaaaaaa bbbbbbbbbb cccc' }), draft({ text: 'aaaa bbbb' }))

    await expect(runAnswerDraft(input(constraints), generate)).resolves.toMatchObject({ text: 'aaaa bbbb' })
    expect(correction(generate)).toContain('26 chars')
  })

  it('lets an unlimited answer through however long it runs', async () => {
    const out = draft({ text: words(400) })
    const generate = returning(out)
    const constraints: Question['constraints'] = { type: 'long-text', required: true }
    await expect(runAnswerDraft(input(constraints), generate)).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('cannot count half a constraint, so it does not pretend to', async () => {
    const out = draft({ text: words(400) })
    for (const constraints of [
      { limit: 10, type: 'long-text', required: true } as Question['constraints'],
      { unit: 'words', type: 'long-text', required: true } as Question['constraints'],
    ]) {
      const generate = returning(out)
      await expect(runAnswerDraft(input(constraints), generate)).resolves.toEqual(out)
      expect(generate).toHaveBeenCalledTimes(1)
    }
  })
})

describe('runAnswerDraft — the citation guard', () => {
  const long: Question['constraints'] = { type: 'long-text', required: true }
  const text = 'I cut p99 checkout latency from 840ms to 210ms on a service doing 12,000 requests a day.'

  it('accepts citations whose spans are in the text and whose ids are real facts', async () => {
    const out = draft({
      text,
      citations: [
        { claimSpan: 'cut p99 checkout latency from 840ms to 210ms', factId: 'f2' },
        { claimSpan: '12,000 requests a day', factId: 'f1' },
      ],
    })
    const generate = returning(out)
    await expect(runAnswerDraft(input(long), generate)).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('rejects a claimSpan that is not a verbatim substring of the answer', async () => {
    // A span the UI cannot find is a citation the reader can never check — the underline
    // silently disappears and an uncited claim reads as a cited one.
    const bad = draft({ text, citations: [{ claimSpan: 'cut latency by 75%', factId: 'f2' }] })
    const good = draft({ text, citations: [{ claimSpan: 'from 840ms to 210ms', factId: 'f2' }] })
    const generate = returning(bad, good)

    await expect(runAnswerDraft(input(long), generate)).resolves.toEqual(good)
    expect(correction(generate)).toContain('cut latency by 75%')
  })

  it('rejects a citation that spans nothing at all', async () => {
    // The empty string is a substring of every text, so a plain `includes` waves this
    // through: a citation attached to no words, which the UI renders as no underline and
    // the reader therefore never sees. It has to be caught here or it is caught nowhere.
    for (const claimSpan of ['', '   ', '\n']) {
      const bad = draft({ text, citations: [{ claimSpan, factId: 'f2' }] })
      const generate = returning(bad, bad)
      const promise = runAnswerDraft(input(long), generate)
      await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
      await expect(promise).rejects.toThrow(/empty span/)
    }
  })

  it('rejects a factId no provided fact carries', async () => {
    // `f9` passes the schema — it is shaped like a fact id. Only the fact list knows it
    // names nothing, and the fact list is not something a schema can see.
    const bad = draft({ text, citations: [{ claimSpan: 'from 840ms to 210ms', factId: 'f9' }] })
    const good = draft({ text, citations: [{ claimSpan: 'from 840ms to 210ms', factId: 'f2' }] })
    const generate = returning(bad, good)

    await expect(runAnswerDraft(input(long), generate)).resolves.toEqual(good)
    expect(correction(generate)).toContain('f9')
  })

  it('throws when the citations are still broken after the correction', async () => {
    const bad = draft({ text, citations: [{ claimSpan: 'invented span', factId: 'f9' }] })
    const generate = returning(bad, bad)
    const promise = runAnswerDraft(input(long), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow(/invented span/)
    await expect(promise).rejects.toThrow(/f9/)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('says each problem once, however many citations repeat it', async () => {
    const bad = draft({
      text,
      citations: [
        { claimSpan: 'from 840ms to 210ms', factId: 'f9' },
        { claimSpan: 'on a service', factId: 'f9' },
      ],
    })
    const generate = returning(bad, draft({ text, citations: [] }))
    await runAnswerDraft(input(long), generate)
    expect(reasons(generate).match(/f9/g)).toHaveLength(1)
  })

  it('reports every problem at once, so the retry fixes them together', async () => {
    const bad = draft({
      text: words(14),
      citations: [{ claimSpan: 'nowhere in the text', factId: 'f9' }],
    })
    const generate = returning(bad, draft({ text: words(9) }))
    await runAnswerDraft(input(), generate)

    const correctionText = correction(generate)
    expect(correctionText).toContain('over the limit')
    expect(correctionText).toContain('nowhere in the text')
    expect(correctionText).toContain('f9')
  })

  it('has nothing to check when the draft cites nothing — that is askHuman territory', async () => {
    const out = draft({
      text,
      citations: [],
      askHuman: [{ question: 'Why this company?', why: 'no fact covers motivation' }],
    })
    const generate = returning(out)
    await expect(runAnswerDraft(input(long), generate)).resolves.toEqual(out)
  })

  it('checks the ids against the facts it was given, not against a shape', async () => {
    const out = draft({ text, citations: [{ claimSpan: 'from 840ms to 210ms', factId: 'f2' }] })
    const generate = returning(out, out)
    // Same draft, same citation — but this profile has no f2.
    const promise = runAnswerDraft({ ...input(long), facts: [facts[0]] }, generate)
    await expect(promise).rejects.toThrow(/f2/)
  })
})
