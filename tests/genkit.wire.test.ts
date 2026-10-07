import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'genkit'
import { generateGrounded, generateStructured } from '@/ai/genkit'

// The other genkit tests stop at the GenerateCall seam. This one lets the plugin build the
// request, with fetch stubbed so nothing goes out, and pins what reaches Gemini: the thinking
// level, the schema, the search tool, and no sampling parameter or thinking budget. The plugin
// forwards config verbatim, and Google says its next models will reject either of those with a 400.

/** The two fields of the request body this file reads. */
interface SentBody {
  generationConfig: Record<string, unknown>
  tools?: unknown
}

/** Answers every request with one candidate carrying `text`, and records each body sent. */
function stubGemini(text: string) {
  const bodies: SentBody[] = []
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as SentBody)
    return new Response(
      JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  return { fetchMock, bodies }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('what reaches Gemini', () => {
  it('from generateStructured: the thinking level and the schema, and nothing else', async () => {
    const { fetchMock, bodies } = stubGemini('{"word":"OK"}')
    await generateStructured({ parts: [{ text: 'Say OK.' }], schema: z.object({ word: z.string() }), thinkingLevel: 'MEDIUM' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.keys(bodies[0].generationConfig).sort()).toEqual(['responseJsonSchema', 'responseMimeType', 'thinkingConfig'])
    expect(bodies[0].generationConfig.thinkingConfig).toStrictEqual({ thinkingLevel: 'MEDIUM' })
    expect(bodies[0].generationConfig.responseJsonSchema).toMatchObject({ type: 'object', properties: { word: { type: 'string' } } })
    expect(bodies[0].generationConfig.responseMimeType).toBe('application/json')
    expect(bodies[0].tools).toBeUndefined()
  })

  it('from generateGrounded: the thinking level alone, with the search tool beside it', async () => {
    const { fetchMock, bodies } = stubGemini('one line')
    await generateGrounded({ parts: [{ text: 'Name one step.' }], thinkingLevel: 'LOW' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies[0].generationConfig).toStrictEqual({ thinkingConfig: { thinkingLevel: 'LOW' } })
    expect(bodies[0].tools).toEqual([{ googleSearch: {} }])
  })
})
