import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { generateGrounded } from '@/ai/genkit'

// The grounded call is the one place the model is allowed to read the web. What is pinned:
// the built-in tool is asked for, no schema is imposed (Gemini's grounding and JSON mode do
// not mix reliably), and the sources come out of the response's metadata, not its prose.

const custom = JSON.parse(readFileSync('tests/fixtures/grounding-response.json', 'utf8')) as unknown

describe('generateGrounded', () => {
  it('asks for Google Search, sends no output schema, and reads the metadata', async () => {
    const generate = vi.fn().mockResolvedValue({ output: null, text: 'line one\nline two', custom })
    const res = await generateGrounded({ parts: [{ text: 'q' }], system: 'sys', thinkingBudget: 512 }, generate)
    const opts = generate.mock.calls[0][0]
    expect(opts.config.tools).toEqual([{ googleSearch: {} }])
    expect(opts.config.temperature).toBe(0)
    expect(opts.config.thinkingConfig).toEqual({ thinkingBudget: 512 })
    expect(opts.output).toBeUndefined()
    expect(res.text).toBe('line one\nline two')
    expect(res.chunks).toEqual([
      { title: 'reddit.com', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA' },
      { title: 'Marram Systems Careers', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB' },
    ])
    expect(res.supports).toEqual([
      { text: 'The loop opens with a 30-minute recruiter screen.', chunkIndices: [1] },
      { text: 'A take-home follows, usually three days.', chunkIndices: [0, 1] },
    ])
  })
  // A support cites a chunk by its position in the list, so a chunk we cannot use still has
  // to occupy its slot. Drop it and every later index slides down one, and the map would
  // attribute a stage to whichever source happened to follow the one that actually said it.
  it('holds the slot of a chunk it cannot read, so a support still names the right source', async () => {
    const gappy = {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: 'https://example.com/first', title: 'First' } },
              { retrievedContext: { uri: 'https://example.com/not-web', title: 'Not a web chunk' } },
              { web: { uri: 'https://example.com/third', title: 'Third' } },
            ],
            groundingSupports: [
              { segment: { text: 'This rests on the third chunk.' }, groundingChunkIndices: [2] },
            ],
          },
        },
      ],
    }
    const generate = vi.fn().mockResolvedValue({ output: null, text: 'This rests on the third chunk.', custom: gappy })
    const res = await generateGrounded({ parts: [{ text: 'q' }] }, generate)
    expect(res.chunks).toHaveLength(3)
    expect(res.chunks[1].uri).toBe('')
    expect(res.supports[0].chunkIndices).toEqual([2])
    expect(res.chunks[res.supports[0].chunkIndices[0]].uri).toBe('https://example.com/third')
  })
  it('returns empty metadata when the response carries none', async () => {
    const generate = vi.fn().mockResolvedValue({ output: null, text: 'nothing', custom: {} })
    const res = await generateGrounded({ parts: [{ text: 'q' }] }, generate)
    expect(res).toEqual({ text: 'nothing', chunks: [], supports: [] })
  })
  it('lets a transport error through untouched — the caller decides', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('429 quota'))
    await expect(generateGrounded({ parts: [{ text: 'q' }] }, generate)).rejects.toThrow('429 quota')
  })
})
