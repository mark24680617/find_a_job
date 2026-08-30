import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { buildFormParsePrompt, type FormParseInput } from '@/ai/prompts/formParse'
import { FormParseOutSchema, type FormParseOut } from '@/ai/schemas'

/**
 * Reading a form is mostly transcription — the questions are right there. The judgment is
 * narrow and local: which control this field is, and therefore how long the answer may be.
 * A small budget buys that call without paying jobInterpret's 1024 for reasoning this flow
 * never has to do.
 */
const THINKING_BUDGET = 256

/** A form as pasted text and/or screenshots in, its questions and artifact scope out. */
export async function runFormParse(
  input: FormParseInput,
  generate?: GenerateCall,
): Promise<FormParseOut> {
  const { system, parts } = buildFormParsePrompt(input)
  return generateStructured(
    { parts, system, schema: FormParseOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
}
