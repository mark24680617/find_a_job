import { describe, it, expect, vi } from 'vitest'
import { runJobInterpret } from '@/ai/flows/jobInterpret'
import { type GenerateCall } from '@/ai/genkit'
import { JobInterpretOutSchema } from '@/ai/schemas'
import type { Fact } from '@/lib/types'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real thinking level — everything except the network.

const facts: Fact[] = [
  { id: 'f1', claim: 'Three years backend on payments', sourceSnippet: 'Backend engineer', tags: ['backend'] },
  { id: 'f2', claim: 'Ships Go in production', sourceSnippet: 'Written in Go', tags: ['go'] },
]

const out = {
  company: 'TRM Labs',
  role: 'Staff Backend Engineer',
  roleFacts: ['Payments platform', 'Remote, US'],
  gates: [
    { requirement: '8 years of production Go', met: 'no' as const, posture: 'explicit' as const, note: 'Minimum 8 years' },
  ],
  themes: ['backend', 'payments', 'go'],
  scope: 'per-application' as const,
  advisory: 'The 8-year minimum is explicit and you have three; skip unless a referral can vouch for the gap.',
}

interface SentRequest {
  system?: string
  prompt: { text?: string }[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingLevel: string } }
}

describe('runJobInterpret', () => {
  it('returns the parsed posting', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runJobInterpret({ jdText: 'a posting', today: '2026-09-14', facts }, generate)).resolves.toEqual(out)
  })

  it('thinks at MEDIUM, at temperature 0, against the posting schema', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runJobInterpret({ jdText: 'a posting', today: '2026-09-14', facts }, generate)

    const req = generate.mock.calls[0][0] as unknown as SentRequest
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: 'MEDIUM' } })
    expect(req.output).toEqual({ schema: JobInterpretOutSchema })
    expect(req.system).toContain('You interpret one job posting')
  })

  it('sends the posting, today’s date and a snippet-free fact summary', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runJobInterpret({ jdText: 'Staff Backend Engineer, 8 years Go', today: '2031-02-03', facts }, generate)

    const prompt = (generate.mock.calls[0][0] as unknown as SentRequest).prompt
    const text = prompt.map((p) => p.text ?? '').join('\n')
    expect(text).toContain('Staff Backend Engineer, 8 years Go')
    expect(text).toContain('f1: Three years backend on payments')
    expect(text).toContain('f2: Ships Go in production')
    expect(text).toContain("Today's date: 2031-02-03.")
    // Provenance snippets stay in the vault; the gate judgment never sees them.
    expect(text).not.toContain('Written in Go')
  })

  it('interprets a posting for a candidate with no facts yet', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runJobInterpret({ jdText: 'a posting', today: '2026-09-14', facts: [] }, generate)).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
