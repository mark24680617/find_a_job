import { describe, it, expect, vi } from 'vitest'
import { runFeedbackDistill } from '@/ai/flows/feedbackDistill'
import { type GenerateCall } from '@/ai/genkit'
import { FeedbackDistillOutSchema } from '@/ai/schemas'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real budget — everything except the network.

const out = {
  rules: [{ rule: 'cuts openers, starts with the fact', evidence: 'I am excited to → I own' }],
}

interface SentRequest {
  system?: string
  prompt: ({ text?: string } | { media?: { url: string; contentType: string } })[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}

const sent = (generate: { mock: { calls: unknown[][] } }) =>
  generate.mock.calls[0][0] as unknown as SentRequest

const input = {
  draft: 'I am excited to say I own a fast payments service.',
  final: 'I own a payments service handling 12,000 requests a day.',
  existingRules: [] as string[],
}

describe('runFeedbackDistill', () => {
  it('returns the distilled rules', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runFeedbackDistill(input, generate)).resolves.toEqual(out)
  })

  it('spends 256 thinking tokens at temperature 0, and binds the schema', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runFeedbackDistill(input, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 256 } })
    expect(req.output).toEqual({ schema: FeedbackDistillOutSchema })
    expect(req.system).toContain('Compare the AI draft with the human')
  })

  it('sends the draft and the final edit as text parts', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runFeedbackDistill(input, generate)

    const texts = sent(generate)
      .prompt.map((p) => ('text' in p ? p.text : ''))
      .join('\n')
    expect(texts).toContain(input.draft)
    expect(texts).toContain(input.final)
  })
})
