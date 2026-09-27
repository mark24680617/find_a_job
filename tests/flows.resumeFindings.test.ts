import { describe, it, expect, vi } from 'vitest'
import { FlowOutputError } from '@/ai/genkit'
import { runResumeFindings, type ResumeFindingsInput } from '@/ai/flows/resumeFindings'

// The `answerDraft` disposition: correct once, then refuse. Chosen deliberately, because the
// rejected thing here is the product — a finding the reader cannot check against their own page
// is worse than no finding, since it reads as verified.

const RESUME = [
  'Experience',
  'Backend Engineer, Marram Systems — Jan 2020 to Dec 2021',
  'Responsible for the ledger.',
  'References available on request',
].join('\n')

const input = (over: Partial<ResumeFindingsInput> = {}): ResumeFindingsInput => ({
  resumeText: RESUME,
  failures: [{ checkId: 'font-size', source: 'Our judgement, not vendor-documented.', lines: ['References available on request'] }],
  failedBullets: [{ id: 'b1', text: 'Responsible for the ledger.', failed: ['result'] }],
  today: '2026-09-21',
  ...over,
})

const finding = (over: Record<string, unknown> = {}) => ({
  checkId: 'font-size',
  quote: 'References available on request',
  explanation: 'That line is set smaller than the rest of the page.',
  fix: 'Set it at the same size as the body text, or take the line out.',
  askHuman: null,
  ...over,
})

describe('runResumeFindings', () => {
  it('thinks at MEDIUM with temperature 0 sent explicitly', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { findings: [finding()] } })
    await runResumeFindings(input(), generate)
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' })
    expect(generate.mock.calls[0][0].config.temperature).toBe(0)
  })

  it('makes no call at all when nothing failed', async () => {
    const generate = vi.fn()
    await expect(runResumeFindings(input({ failures: [], failedBullets: [] }), generate)).resolves.toEqual({ findings: [] })
    expect(generate).not.toHaveBeenCalled()
  })

  it('corrects a quote that is not in the resume once, then takes the corrected answer', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ output: { findings: [finding({ quote: 'References available upon request' })] } })
      .mockResolvedValueOnce({ output: { findings: [finding()] } })
    const out = await runResumeFindings(input(), generate)
    expect(out.findings[0].quote).toBe('References available on request')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('refuses after one correction, and names positions rather than quoting the resume', async () => {
    const bad = { output: { findings: [finding({ quote: 'References available upon request' })] } }
    const generate = vi.fn().mockResolvedValue(bad)
    const error = await runResumeFindings(input(), generate).catch((e) => e)
    expect(error).toBeInstanceOf(FlowOutputError)
    expect((error as Error).message).toMatch(/finding 0/)
    expect((error as Error).message).not.toMatch(/References available/)
  })

  it('refuses a checkId that was never handed over', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { findings: [finding({ checkId: 'one-page' })] } })
    const error = await runResumeFindings(input(), generate).catch((e) => e)
    expect(error).toBeInstanceOf(FlowOutputError)
    expect((error as Error).message).toMatch(/one-page/)
  })

  it('accepts a finding against a judgement the quoted line failed', async () => {
    const out = { findings: [finding({ checkId: 'bullet-result', quote: 'Responsible for the ledger.' })] }
    const generate = vi.fn().mockResolvedValue({ output: out })
    await expect(runResumeFindings(input(), generate)).resolves.toEqual(out)
  })

  it('refuses a bullet finding for a judgement the line passed, or quoting outside the failed line', async () => {
    // amended 2026-09-24, R24: b1 failed `result` only.
    for (const over of [
      { checkId: 'bullet-scale', quote: 'Responsible for the ledger.' },
      { checkId: 'bullet-result', quote: 'References available on request' },
    ]) {
      const generate = vi.fn().mockResolvedValue({ output: { findings: [finding(over)] } })
      await expect(runResumeFindings(input(), generate)).rejects.toBeInstanceOf(FlowOutputError)
    }
  })

  it('refuses a banned claim in the explanation or in the fix', async () => {
    const claims = [
      { explanation: '75% of resumes are auto-rejected before a human sees them.' },
      { fix: 'Your resume must be one page.' },
      { fix: 'Always use .docx instead.' },
      { explanation: 'The ATS will reject you on this.' },
    ]
    for (const over of claims) {
      const generate = vi.fn().mockResolvedValue({ output: { findings: [finding(over)] } })
      await expect(runResumeFindings(input(), generate)).rejects.toBeInstanceOf(FlowOutputError)
    }
  })

  it('refuses a doctrine phrase in the fix it proposes', async () => {
    const generate = vi.fn().mockResolvedValue({
      output: { findings: [finding({ fix: 'Say you are a results-driven team player.' })] },
    })
    await expect(runResumeFindings(input(), generate)).rejects.toBeInstanceOf(FlowOutputError)
  })

  it('accepts a self-description finding that names the phrase its own quote contains', async () => {
    const resume = `${RESUME}\nResults-driven team player.`
    const out = {
      findings: [
        finding({
          checkId: 'self-description',
          quote: 'Results-driven team player.',
          explanation: 'The summary calls you results-driven, with no event behind it.',
          fix: 'Name one result in its place.',
        }),
      ],
    }
    const generate = vi.fn().mockResolvedValue({ output: out })
    await expect(
      runResumeFindings(
        input({
          resumeText: resume,
          failures: [{ checkId: 'self-description', source: 'Our judgement, not vendor-documented.', lines: ['Results-driven team player.'] }],
        }),
        generate,
      ),
    ).resolves.toEqual(out)
  })

  it('refuses a quote that is only whitespace, after one correction', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { findings: [finding({ quote: '   ' })] } })
    await expect(runResumeFindings(input(), generate)).rejects.toBeInstanceOf(FlowOutputError)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('keeps an askHuman rather than writing around what only the candidate knows', async () => {
    const out = {
      findings: [finding({ askHuman: { question: 'How many regions did this cover?', why: 'The line states no scale, and only you know it.' } })],
    }
    const generate = vi.fn().mockResolvedValue({ output: out })
    await expect(runResumeFindings(input(), generate)).resolves.toEqual(out)
  })
})
