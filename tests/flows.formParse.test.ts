import { describe, it, expect, vi } from 'vitest'
import { runFormParse } from '@/ai/flows/formParse'
import { type GenerateCall } from '@/ai/genkit'
import { FormParseOutSchema } from '@/ai/schemas'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real budget — everything except the network.

const out = {
  questions: [
    {
      q: 'Why do you want to work at TRM Labs?',
      constraints: { limit: 500, unit: 'chars' as const, type: 'long-text' as const, required: true },
    },
    {
      q: 'Where are you based?',
      constraints: { type: 'short-text' as const, required: false },
    },
  ],
  scope: 'per-application' as const,
  scopeEvidence: 'Application for Account Director',
}

interface SentRequest {
  system?: string
  prompt: ({ text?: string } | { media?: { url: string; contentType: string } })[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}

const sent = (generate: { mock: { calls: unknown[][] } }) =>
  generate.mock.calls[0][0] as unknown as SentRequest

describe('runFormParse', () => {
  it('returns the extracted questions and the form scope', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runFormParse({ text: 'Question 1', images: [] }, generate)).resolves.toEqual(out)
  })

  it('spends 256 thinking tokens — reading a control type is judgment, not reasoning', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runFormParse({ text: 'Question 1', images: [] }, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 256 } })
    expect(req.output).toEqual({ schema: FormParseOutSchema })
    expect(req.system).toContain('You read a job-application form')
  })

  it('sends screenshots as media parts and the pasted text alongside them', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runFormParse(
      { text: 'Question 1', images: [{ base64: 'c2hvdA==', mime: 'image/png' }] },
      generate,
    )

    expect(sent(generate).prompt).toEqual([
      { media: { url: 'data:image/png;base64,c2hvdA==', contentType: 'image/png' } },
      { text: 'Pasted form text:\nQuestion 1' },
    ])
  })

  it('parses a form given as screenshots alone', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(
      runFormParse({ images: [{ base64: 'c2hvdA==', mime: 'image/webp' }] }, generate),
    ).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty form rather than calling the model', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runFormParse({ images: [] }, generate)).rejects.toThrow(/formParse needs/)
    expect(generate).not.toHaveBeenCalled()
  })
})
