/**
 * The single Genkit entry point. Every flow reaches the model through
 * `generateStructured` — there is no other call site, so the model, the thinking budget
 * and the retry policy are decided in exactly one place.
 *
 * Nothing here touches the network at import time: `googleAI()` only registers the
 * plugin, and the API key is read from GEMINI_API_KEY when a call is actually made.
 */
import { genkit, type GenerateOptions, type z } from 'genkit'
import { googleAI } from '@genkit-ai/google-genai'

const ai = genkit({ plugins: [googleAI()] })

// Passed explicitly on every request so the request object fully describes the call.
const model = googleAI.model('gemini-3.7-flash')

/** A prompt fragment. Media is inlined as a data URL: `data:<mime>;base64,<data>`. */
export type Part = { text: string } | { media: { url: string; contentType: string } }

export interface GenerateStructuredOptions<T> {
  parts: Part[]
  schema: z.ZodType<T>
  /** Thinking tokens the model may spend. Defaults to 0 — flows opt in deliberately. */
  thinkingBudget?: number
  /**
   * Sampling temperature. Defaults to 0, and it is always sent: leaving it unset applies
   * Gemini's own default, which is high. Task 10 measured what that costs — ten identical
   * formParse runs over one 8-field form returned 7, 8 or 9 questions, and one returned 2,
   * dropping stated limits along the way. Raising the thinking budget did not steady it.
   * These flows read documents and report what is in them, so the same input should give
   * the same answer; a product whose whole claim is "grounded, not credulous" cannot have
   * its groundedness depend on a sample. A caller that genuinely wants variety asks for it.
   */
  temperature?: number
  system?: string
}

/** Thrown when the model could not produce output matching the schema, twice. */
export class FlowOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FlowOutputError'
  }
}

/** The Genkit call, injectable so tests can exercise this file without an API key. */
export type GenerateCall = (options: GenerateOptions) => Promise<{ output: unknown }>

const callGenkit: GenerateCall = (options) => ai.generate(options)

const retryInstruction = (error: string) =>
  [
    'Your previous response did not fit the required output schema.',
    `The validator reported: ${error}`,
    'Answer again. Return only JSON matching the schema — do not explain the failure.',
  ].join('\n')

type Attempt<T> = { data: T } | { error: string; cause: unknown }

/**
 * Generates a value of the schema's type. Genkit constrains the model to the schema and
 * we re-validate the result ourselves, so the returned value is `T` or nothing at all.
 *
 * A model that misses the schema usually hits it once told how it missed, so one retry
 * carries the validation error back into the prompt. A second miss is a real failure —
 * retrying further would just burn quota on the same mistake.
 */
export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
  generate: GenerateCall = callGenkit,
): Promise<T> {
  const attempt = async (parts: Part[]): Promise<Attempt<T>> => {
    let output: unknown
    try {
      const response = await generate({
        model,
        system: opts.system,
        prompt: parts,
        output: { schema: opts.schema },
        config: {
          temperature: opts.temperature ?? 0,
          thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
        },
      })
      output = response.output
    } catch (cause) {
      // Covers Genkit's own schema check as well as transport failures; both are worth
      // one more try, and the message is what the retry shows the model.
      const message = cause instanceof Error ? cause.message || cause.constructor.name : String(cause)
      return { error: message, cause }
    }
    // Genkit returns null rather than throwing when a response carries no output.
    const parsed = opts.schema.safeParse(output)
    if (parsed.success) return { data: parsed.data }
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    return { error: issues, cause: parsed.error }
  }

  const first = await attempt(opts.parts)
  if ('data' in first) return first.data

  const second = await attempt([...opts.parts, { text: retryInstruction(first.error) }])
  if ('data' in second) return second.data

  // Deliberately generic: this also fires for a transport failure the retry swallowed,
  // and `cause` is the real error either way.
  throw new FlowOutputError(`generateStructured failed after one retry: ${second.error}`, {
    cause: second.cause,
  })
}
