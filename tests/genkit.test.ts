import { describe, it, expect, vi, type Mock } from 'vitest'
import { z } from 'genkit'
import { FlowOutputError, generateStructured, type GenerateCall, type Part } from '@/ai/genkit'

// The Genkit call is injected so nothing here touches the network or needs an API key.
// What is under test is everything around that call: request construction, the single
// retry that feeds the validation error back to the model, and the failure mode.

const Schema = z.object({ role: z.string(), years: z.number() })
const valid = { role: 'Backend Engineer', years: 3 }

const parts: Part[] = [
  { text: 'Tom Candidate, 3 years on payments.' },
  { media: { url: 'data:application/pdf;base64,JVBERi0=', contentType: 'application/pdf' } },
]

const ok = (output: unknown) => Promise.resolve({ output })

/** What the helper actually sends — narrower than the GenerateOptions type allows. */
interface SentRequest {
  model: unknown
  system?: string
  prompt: Part[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingBudget: number } }
}
const sent = (generate: Mock<GenerateCall>, n: number) =>
  generate.mock.calls[n][0] as unknown as SentRequest

describe('generateStructured', () => {
  it('returns the parsed output of a first-try success', async () => {
    const generate = vi.fn<GenerateCall>(() => ok(valid))
    await expect(generateStructured({ parts, schema: Schema }, generate)).resolves.toEqual(valid)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('sends the parts, the schema, a zero thinking budget and a zero temperature by default', async () => {
    const generate = vi.fn<GenerateCall>(() => ok(valid))
    await generateStructured({ parts, schema: Schema, system: 'You extract job facts.' }, generate)

    const req = sent(generate, 0)
    expect(req.model).toBeDefined()
    expect(req.system).toBe('You extract job facts.')
    expect(req.prompt).toEqual(parts)
    expect(req.output).toEqual({ schema: Schema })
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingBudget: 0 } })
  })

  it('passes an explicit thinking budget through', async () => {
    const generate = vi.fn<GenerateCall>(() => ok(valid))
    await generateStructured({ parts, schema: Schema, thinkingBudget: 512 }, generate)
    expect(sent(generate, 0).config).toEqual({
      temperature: 0,
      thinkingConfig: { thinkingBudget: 512 },
    })
  })

  // Temperature is sent on every request, never left to the provider's default. T10 measured
  // what the default costs: ten identical formParse runs returned 7, 8 or 9 questions for the
  // same 8-field form, and one returned 2. A caller that wants variety asks for it.
  it('passes an explicit temperature through, including one the default would hide', async () => {
    const generate = vi.fn<GenerateCall>(() => ok(valid))
    await generateStructured({ parts, schema: Schema, temperature: 0.9 }, generate)
    expect(sent(generate, 0).config).toEqual({
      temperature: 0.9,
      thinkingConfig: { thinkingBudget: 0 },
    })
  })

  it('keeps the temperature on the retry, so the second try is not a differently-sampled one', async () => {
    const generate = vi
      .fn<GenerateCall>()
      .mockImplementationOnce(() => ok({ role: 'Backend Engineer', years: 'three' }))
      .mockImplementationOnce(() => ok(valid))

    await generateStructured({ parts, schema: Schema, temperature: 0.4 }, generate)
    expect(sent(generate, 1).config).toEqual({
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 },
    })
  })

  it('omits system when the caller gives none', async () => {
    const generate = vi.fn<GenerateCall>(() => ok(valid))
    await generateStructured({ parts, schema: Schema }, generate)
    expect(sent(generate, 0).system).toBeUndefined()
  })

  it('retries once with the validation error appended when the output does not fit', async () => {
    const generate = vi
      .fn<GenerateCall>()
      .mockImplementationOnce(() => ok({ role: 'Backend Engineer', years: 'three' }))
      .mockImplementationOnce(() => ok(valid))

    await expect(generateStructured({ parts, schema: Schema }, generate)).resolves.toEqual(valid)
    expect(generate).toHaveBeenCalledTimes(2)

    const retryPrompt = sent(generate, 1).prompt
    expect(retryPrompt.slice(0, parts.length)).toEqual(parts)
    expect(retryPrompt).toHaveLength(parts.length + 1)
    // The appended part must name the offending field, or the retry teaches the model nothing.
    expect(retryPrompt[parts.length]).toMatchObject({ text: expect.stringContaining('years') })
  })

  it('retries when Genkit itself rejects the output', async () => {
    const generate = vi
      .fn<GenerateCall>()
      .mockRejectedValueOnce(new Error('generated output failed schema validation'))
      .mockImplementationOnce(() => ok(valid))

    await expect(generateStructured({ parts, schema: Schema }, generate)).resolves.toEqual(valid)
    expect(sent(generate, 1).prompt[parts.length]).toMatchObject({
      text: expect.stringContaining('schema validation'),
    })
  })

  it('retries when the response carries no output at all', async () => {
    const generate = vi
      .fn<GenerateCall>()
      .mockImplementationOnce(() => ok(null))
      .mockImplementationOnce(() => ok(valid))

    await expect(generateStructured({ parts, schema: Schema }, generate)).resolves.toEqual(valid)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('throws FlowOutputError after the retry also fails, without a third call', async () => {
    const generate = vi.fn<GenerateCall>(() => ok({ role: 'Backend Engineer' }))
    const promise = generateStructured({ parts, schema: Schema }, generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow('generateStructured failed after one retry: years: Required')
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('reports a transport failure as itself, not as a schema mismatch', async () => {
    const boom = new Error('502 from the model API')
    const generate = vi.fn<GenerateCall>(() => Promise.reject(boom))
    const promise = generateStructured({ parts, schema: Schema }, generate)

    await expect(promise).rejects.toMatchObject({ name: 'FlowOutputError', cause: boom })
    await expect(promise).rejects.toThrow(
      'generateStructured failed after one retry: 502 from the model API',
    )
  })

  it('strips keys the schema does not declare', async () => {
    const generate = vi.fn<GenerateCall>(() => ok({ ...valid, hallucinated: 'nonsense' }))
    await expect(generateStructured({ parts, schema: Schema }, generate)).resolves.toEqual(valid)
  })
})
