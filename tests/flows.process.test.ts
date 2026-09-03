import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runProcessDigest } from '@/ai/flows/processDigest'
import { runProcessGather } from '@/ai/flows/processGather'
import { runProcessSynthesize } from '@/ai/flows/processSynthesize'
import { FlowOutputError } from '@/ai/genkit'

const custom = JSON.parse(readFileSync('tests/fixtures/grounding-response.json', 'utf8')) as unknown

describe('runProcessGather', () => {
  it('splits the text into notes and passes the metadata through', async () => {
    const generate = vi.fn().mockResolvedValue({ output: null, text: 'One.\n\n2. Two.\n- Three.\n', custom })
    const res = await runProcessGather({ company: 'M', role: 'R', family: 'software engineering', query: 'q' }, generate)
    expect(res.notes).toEqual(['One.', 'Two.', 'Three.'])
    expect(res.chunks).toHaveLength(2)
    expect(res.supports).toHaveLength(2)
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 512 })
  })
  // A leading year is the observation, not a list marker the model added.
  it('strips a list number but leaves a year that opens a sentence', async () => {
    const generate = vi.fn().mockResolvedValue({ output: null, text: '2024. The loop changed.\n2. Two.\n', custom })
    const res = await runProcessGather({ company: 'M', role: 'R', family: 'software engineering', query: 'q' }, generate)
    expect(res.notes).toEqual(['2024. The loop changed.', 'Two.'])
  })
})

describe('runProcessDigest', () => {
  const text = 'The onsite was four rounds. Two coding, one system design, one behavioral.'
  it('keeps only the quotes the text actually contains', async () => {
    const generate = vi.fn().mockResolvedValue({
      output: { takeaways: ['Four rounds onsite'], questionsReported: [], quotes: ['Two coding, one system design', 'Five rounds total'], publishedAt: null, firstHand: true },
    })
    const res = await runProcessDigest({ company: 'M', title: 't', text }, generate)
    expect(res.quotes).toEqual(['Two coding, one system design'])
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 256 })
  })
  it('turns a null publishedAt into undefined', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { takeaways: ['x'], questionsReported: [], quotes: [], publishedAt: null, firstHand: false } })
    const res = await runProcessDigest({ company: 'M', title: 't', text }, generate)
    expect(res.publishedAt).toBeUndefined()
  })
})

describe('runProcessSynthesize', () => {
  const input = {
    jobSummary: 'Company: M', jdExcerpt: '', family: 'software engineering' as const, grounded: true,
    notes: [{ sourceIds: ['s1'], text: 'Recruiter screen first.' }], digests: [], sourceIds: ['s1'],
  }
  const good = {
    stages: [{ order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', duration: '30 min', whatItProbes: 'fit', tips: ['be brief'], sourceIds: ['s1'], confidence: 'community' }],
    takeHome: { present: 'unknown', description: '', timeBudget: null, tips: [], sourceIds: [] },
    timeline: null, askRecruiter: ['Is there a take-home?'], caveats: ['One source.'],
  }
  it('returns the map with nullable fields mapped to optional', async () => {
    const generate = vi.fn().mockResolvedValue({ output: good })
    const map = await runProcessSynthesize(input, generate)
    expect(map.stages[0].duration).toBe('30 min')
    expect(map.timeline).toBeUndefined()
    expect(map.takeHome.timeBudget).toBeUndefined()
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 2048 })
  })
  it('sends a guard rejection back once, then accepts the corrected map', async () => {
    const bad = { ...good, stages: [{ ...good.stages[0], sourceIds: ['s9'] }] }
    const generate = vi.fn().mockResolvedValueOnce({ output: bad }).mockResolvedValueOnce({ output: good })
    const map = await runProcessSynthesize(input, generate)
    expect(map.stages[0].sourceIds).toEqual(['s1'])
    expect(generate).toHaveBeenCalledTimes(2)
    const retryParts = generate.mock.calls[1][0].prompt as { text: string }[]
    expect(retryParts.at(-1)?.text).toContain('s9')
  })
  it('fails after a second guard rejection', async () => {
    const bad = { ...good, stages: [{ ...good.stages[0], sourceIds: ['s9'] }] }
    const generate = vi.fn().mockResolvedValue({ output: bad })
    await expect(runProcessSynthesize(input, generate)).rejects.toBeInstanceOf(FlowOutputError)
  })
})
