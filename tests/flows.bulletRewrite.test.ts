import { describe, it, expect, vi } from 'vitest'
import { runBulletRewrite, type BulletRewriteInput } from '@/ai/flows/bulletRewrite'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { BulletRewriteOutSchema, type BulletRewriteOut } from '@/ai/schemas'
import type { AnsweredAsk, Fact } from '@/lib/types'

const rewrite = (over: Partial<BulletRewriteOut['rewrites'][number]> = {}) => ({
  bulletId: 'b7',
  text: 'Ran the payments service at 12,000 requests a day.',
  citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }],
  askHuman: [],
  skipped: null,
  ...over,
})

describe('BulletRewriteOutSchema', () => {
  it('takes the spec shape and gives the nulls back unchanged', () => {
    const parsed = BulletRewriteOutSchema.parse({ rewrites: [rewrite()] })
    expect(parsed.rewrites[0].citations[0].resumeSpan).toBeNull()
    expect(parsed.rewrites[0].skipped).toBeNull()
  })

  it('refuses a bulletId that is not one the resume could have allocated', () => {
    for (const bulletId of ['bullet-7', 'b', '7', 'B7']) {
      expect(BulletRewriteOutSchema.safeParse({ rewrites: [rewrite({ bulletId })] }).success).toBe(false)
    }
    expect(BulletRewriteOutSchema.safeParse({ rewrites: [rewrite({ bulletId: 'b7' })] }).success).toBe(true)
  })

  it('takes the three ask shapes and null, and nothing else', () => {
    const asked = (shape: unknown) =>
      BulletRewriteOutSchema.safeParse({
        rewrites: [{ ...rewrite(), askHuman: [{ question: 'How many?', why: 'The bullet has no Y.', shape }] }],
      }).success
    for (const shape of ['range', 'frequency', 'scale', null]) expect(asked(shape)).toBe(true)
    for (const shape of ['percentage', '', 'count']) expect(asked(shape)).toBe(false)
  })

  it('refuses an empty rewrite, an empty span and a skip with no reason', () => {
    expect(BulletRewriteOutSchema.safeParse({ rewrites: [rewrite({ text: '' })] }).success).toBe(false)
    expect(
      BulletRewriteOutSchema.safeParse({
        rewrites: [rewrite({ citations: [{ claimSpan: '', factId: 'f1', resumeSpan: null }] })],
      }).success,
    ).toBe(false)
    expect(
      BulletRewriteOutSchema.safeParse({ rewrites: [rewrite({ skipped: { reason: '' } })] }).success,
    ).toBe(false)
  })
})

const RESUME_TEXT = [
  'Tom Candidate — Backend Engineer',
  'Fenwick Labs — Senior Backend Engineer — March 2024 to Present',
  'Responsible for the payments service.',
  'Worked on checkout latency.',
  'Marram Systems — Backend Engineer — June 2021 to February 2024',
  'Helped with the Kafka migration, 40 topics.',
].join('\n')

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns the payments service handling 12,000 requests a day', sourceSnippet: 'Responsible for the payments service.', tags: ['payments'] },
  { id: 'f2', claim: 'Cut p99 checkout latency from 840ms to 210ms', sourceSnippet: 'Worked on checkout latency.', tags: ['performance'] },
]

const asks: AnsweredAsk[] = [
  { askId: 'a1', question: 'How many people reviewed the migration?', answer: '3 of us reviewed it.', answeredAt: '2026-09-20T09:00:00.000Z' },
]

const ONE = { id: 'b1', text: 'Responsible for the payments service.', entryLine: 'Senior Backend Engineer — Fenwick Labs' }

const input = (over: Partial<BulletRewriteInput> = {}): BulletRewriteInput => ({
  resumeText: RESUME_TEXT, bullets: [ONE], facts, voiceRules: [], asks, today: '2026-09-21', ...over,
})

// E2's `rewrite()` defaults to b7; these tests hand the flow b1, so the id is overridden here
// rather than at every call site — a rewrite naming a bullet the flow was not given is its own
// test, below, and should not be every test by accident.
const out = (over: Partial<BulletRewriteOut['rewrites'][number]> = {}): BulletRewriteOut => ({
  rewrites: [rewrite({ bulletId: 'b1', ...over })],
})

const returning = (...outputs: BulletRewriteOut[]) => {
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
  config: { thinkingConfig: { thinkingLevel: string } }
}
const sent = (g: ReturnType<typeof returning>, n: number) => g.mock.calls[n][0] as unknown as SentRequest
const correction = (g: ReturnType<typeof returning>) => sent(g, 1).prompt.at(-1)?.text ?? ''

const refusal = async (o: BulletRewriteOut, i = input()) => {
  const generate = returning(o, o)
  await expect(runBulletRewrite(i, generate)).rejects.toThrow(FlowOutputError)
  expect(generate).toHaveBeenCalledTimes(2)
  return generate
}

const message = async (o: BulletRewriteOut, i = input()) => {
  const generate = returning(o, o)
  const error = await runBulletRewrite(i, generate).then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(FlowOutputError)
  expect(generate).toHaveBeenCalledTimes(2)
  return (error as FlowOutputError).message
}

describe('runBulletRewrite — the request', () => {
  it('thinks at MEDIUM and sends no sampling parameter', async () => {
    const generate = returning(out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }] }))
    await runBulletRewrite(input(), generate)
    expect(sent(generate, 0).config).toEqual({ thinkingConfig: { thinkingLevel: 'MEDIUM' } })
    expect(sent(generate, 0).system).toContain('You rewrite resume bullets')
  })

  it('accepts a clean proposal on the first call and asks for nothing more', async () => {
    const clean = out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }] })
    const generate = returning(clean)
    await expect(runBulletRewrite(input(), generate)).resolves.toEqual(clean)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

describe('runBulletRewrite — the citation guards', () => {
  it('corrects a claimSpan that is not in the bullet once, and takes the second answer', async () => {
    const bad = out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the ledger', factId: 'f1', resumeSpan: null }] })
    const good = out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }] })
    const generate = returning(bad, good)
    await expect(runBulletRewrite(input(), generate)).resolves.toEqual(good)
    expect(correction(generate)).toContain('b1 citation 1 does not appear verbatim in the rewritten bullet')
  })

  it('refuses a factId the bank does not hold', async () => {
    expect(await message(out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the payments service', factId: 'f9', resumeSpan: null }] })))
      .toContain('b1 citation 1 names a fact that is not one of the facts provided')
  })

  it('refuses a citation that names neither a fact nor a resume span', async () => {
    expect(await message(out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the payments service', factId: null, resumeSpan: null }] })))
      .toContain('b1 citation 1 carries neither a factId nor a resumeSpan')
  })

  it('refuses a resumeSpan that is not in the stored resume', async () => {
    expect(await message(out({ text: 'Ran the payments service.', citations: [{ claimSpan: 'the payments service', factId: null, resumeSpan: 'invented span' }] })))
      .toContain('b1 citation 1 cites a resume span that does not appear verbatim in the stored resume')
  })

  // (amended 2026-09-24, R40) whitespace only: the schema's min(1) refuses '' before this guard
  // runs, so '' would test the schema, not the guard.
  it('refuses a whitespace-only claimSpan, which marks nothing', async () => {
    expect(await message(out({ text: 'Ran the payments service.', citations: [{ claimSpan: '   ', factId: 'f1', resumeSpan: null }] })))
      .toContain('b1 citation 1 carries an empty span')
  })
})

describe('runBulletRewrite — the Y rule', () => {
  it('takes a number that is in a cited fact, in the resume, or in an answered ask', async () => {
    const cases: BulletRewriteOut[] = [
      out({ text: 'Ran the payments service at 12,000 requests a day.', citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }] }),
      out({ text: 'Moved 40 Kafka topics.', citations: [{ claimSpan: 'Kafka topics', factId: null, resumeSpan: 'Kafka migration, 40 topics' }] }),
      out({ text: 'Reviewed with 3 engineers.', citations: [{ claimSpan: 'Reviewed', factId: null, resumeSpan: 'Responsible for the payments service.' }] }),
    ]
    for (const clean of cases) {
      await expect(runBulletRewrite(input(), returning(clean))).resolves.toEqual(clean)
    }
  })

  it('refuses a number that is in none of the three, and never repeats the number back', async () => {
    const m = await message(out({ text: 'Ran the payments service at 18,000 requests a day.', citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }] }))
    expect(m).toContain('b1 states a number that is in neither the resume, a fact it cites, nor an answer the candidate gave')
    expect(m).not.toContain('18,000')
  })

  // (amended 2026-09-24, R41) 84, not 40: the resume's own "40 topics" line sources a 40, so a 40
  // would pass for the wrong reason. The resume keeps that line — the Y-rule test above needs it.
  it('does not let 840 source an 84 — a number is a token, not a substring', async () => {
    expect(await message(out({ text: 'Cut latency on 84 endpoints.', citations: [{ claimSpan: 'latency', factId: 'f2', resumeSpan: null }] })))
      .toContain('b1 states a number that is in neither the resume')
  })

  it('reads a sentence-final full stop off a number rather than failing it', async () => {
    const clean = out({ text: 'Served 12,000 requests a day, up from 12,000.', citations: [{ claimSpan: 'Served', factId: 'f1', resumeSpan: null }] })
    await expect(runBulletRewrite(input(), returning(clean))).resolves.toEqual(clean)
  })
})

describe('runBulletRewrite — the register, the skips and the ids', () => {
  it('refuses a banned phrase and names it — the word is ours, not the resume’s', async () => {
    expect(await message(out({ text: 'Spearheaded the payments service.', citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }] })))
      .toContain('b1 uses "spearhead", which this product does not write')
  })

  it('takes a skip with its reason and guards nothing else about it', async () => {
    const skip = out({ text: ONE.text, citations: [], askHuman: [], skipped: { reason: 'The line already carries a result and a scale.' } })
    await expect(runBulletRewrite(input(), returning(skip))).resolves.toEqual(skip)
  })

  it('refuses a skip that changed the bullet', async () => {
    expect(await message(out({ text: 'Ran the payments service.', citations: [], skipped: { reason: 'No change needed.' } })))
      .toContain('b1 is marked skipped but its text was changed')
  })

  it('refuses a bullet it was never handed, and a bullet handed back twice or not at all', async () => {
    expect(await message(out({ bulletId: 'b9' }))).toContain('rewrite 1 names b9, which is not one of the bullets to rewrite')
    expect(await message({ rewrites: [] })).toContain('b1 must appear exactly once in the rewrites, and appeared 0 times')
  })

  it('never puts a span of the resume or of the bullet into a problem string', async () => {
    const m = await message(out({ text: 'Spearheaded the payments service at 18,000 requests a day.', citations: [{ claimSpan: 'the ledger', factId: 'Fenwick Labs payroll', resumeSpan: 'invented span' }] }))
    expect(m).toContain('b1 citation 1 names a fact that is not one of the facts provided')
    for (const leak of ['the ledger', 'invented span', '18,000', 'Spearheaded the payments', 'Fenwick Labs payroll']) {
      expect(m).not.toContain(leak)
    }
  })

  it('carries the rejected rewrites back in the correction, so the model can see what it wrote', async () => {
    const bad = out({ text: 'Ran the ledger.', citations: [{ claimSpan: 'the ledger', factId: 'f9', resumeSpan: null }] })
    const generate = await refusal(bad)
    expect(correction(generate)).toContain('- b1: Ran the ledger.')
    expect(correction(generate)).toContain('Why they were rejected:')
  })
})
