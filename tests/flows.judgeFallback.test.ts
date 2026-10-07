import { describe, it, expect, vi } from 'vitest'
import { FlowOutputError } from '@/ai/genkit'
import { JUDGE_FALLBACK_MODEL, judgeWithGemini } from '@/ai/flows/judgeFallback'
import { bulletNouls } from '@/ai/nouls'
import { JUDGE_FALLBACK_GAPS_SYSTEM, JUDGE_FALLBACK_SYSTEM } from '@/ai/prompts/judgeFallback'

const state = 'Line from the resume: Cut reconciliation from 4 hours to 18 minutes.'
const questions = bulletNouls()
const answers = { result: 'yes', action: 'yes', scale: 'no', 'self-description': 'yes' }

describe('judgeWithGemini', () => {
  it('thinks at LOW, sends no temperature, and returns one enum per id', async () => {
    const generate = vi.fn().mockResolvedValue({ output: answers })
    await expect(judgeWithGemini(state, questions, generate)).resolves.toEqual(answers)
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
    expect(generate.mock.calls[0][0].config).not.toHaveProperty('temperature')
    expect(generate.mock.calls[0][0].config.thinkingConfig.thinkingBudget).toBeUndefined()
  })

  it('names the model the judgement will be stamped with', () => {
    expect(JUDGE_FALLBACK_MODEL).toBe('gemini-3.8-flash')
  })

  it('refuses an answer that is not one of the two words', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { ...answers, scale: 'maybe' } })
    await expect(judgeWithGemini(state, questions, generate)).rejects.toBeInstanceOf(FlowOutputError)
  })

  it('refuses an answer that skipped a question id', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { result: 'yes', action: 'yes', scale: 'no' } })
    await expect(judgeWithGemini(state, questions, generate)).rejects.toBeInstanceOf(FlowOutputError)
  })

  it('drops a key it was never asked for rather than passing it on', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { ...answers, invented: 'yes' } })
    await expect(judgeWithGemini(state, questions, generate)).resolves.toEqual(answers)
  })

  it('sends the Diagnose prompt by default, and the one it is handed otherwise', async () => {
    // amended 2026-09-24, R34: Gaps (D6, D7b) passes JUDGE_FALLBACK_GAPS_SYSTEM.
    const generate = vi.fn().mockResolvedValue({ output: answers })
    await judgeWithGemini(state, questions, generate)
    expect(generate.mock.calls[0][0].system).toBe(JUDGE_FALLBACK_SYSTEM)
    await judgeWithGemini(state, questions, generate, JUDGE_FALLBACK_GAPS_SYSTEM)
    expect(generate.mock.calls[1][0].system).toBe(JUDGE_FALLBACK_GAPS_SYSTEM)
  })
})
