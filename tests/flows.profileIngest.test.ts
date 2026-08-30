import { describe, it, expect, vi } from 'vitest'
import { runProfileIngest } from '@/ai/flows/profileIngest'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { ProfileIngestOutSchema } from '@/ai/schemas'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real retry — everything except the network.

const out = {
  facts: [
    {
      id: 'f1',
      claim: 'Tom Candidate cut p99 checkout latency to 210ms',
      sourceSnippet: 'Cut p99 checkout latency from 840ms to 210ms',
      tags: ['backend', 'performance'],
    },
  ],
  standardAnswers: { work_authorization: 'UNKNOWN' },
  gaps: ['no end date for the Fenwick role'],
}

interface SentRequest {
  system?: string
  prompt: unknown[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}

describe('runProfileIngest', () => {
  it('returns the extracted profile', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runProfileIngest({ pastedText: 'resume' }, generate)).resolves.toEqual(out)
  })

  it('spends 512 thinking tokens — the one flow that reads a whole document', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runProfileIngest({ pastedText: 'resume' }, generate)

    const req = generate.mock.calls[0][0] as unknown as SentRequest
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 512 } })
    expect(req.output).toEqual({ schema: ProfileIngestOutSchema })
    expect(req.system).toContain('You extract')
    expect(req.prompt).toEqual([{ text: expect.stringContaining('resume') }])
  })

  it('rejects a fact the model gave no source for, rather than storing it', async () => {
    const unsourced = { ...out, facts: [{ ...out.facts[0], sourceSnippet: undefined }] }
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: unsourced }))
    await expect(runProfileIngest({ pastedText: 'resume' }, generate)).rejects.toBeInstanceOf(
      FlowOutputError,
    )
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('does not call the model at all when there is nothing to read', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runProfileIngest({}, generate)).rejects.toThrow(/pdfBase64 or pastedText/)
    expect(generate).not.toHaveBeenCalled()
  })
})
