import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { buildFormParsePrompt, type FormParseInput } from '@/ai/prompts/formParse'
import { FormParseOutSchema, type FormParseOut } from '@/ai/schemas'

/**
 * Reading a form is mostly transcription — the questions are right there. The judgment is
 * narrow and local: which control this field is, and therefore how long the answer may be.
 * It is set to MEDIUM anyway, as a hedge on thin evidence: in the 2026-09-14 evaluation one run
 * with no thinking dropped the form's stated "Max 500 characters", and runs with no thinking kept
 * pure data fields as questions in 3 of 3, against 1 of 2 at MEDIUM. The screenshot form read the
 * same either way (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

/** A form as pasted text and/or screenshots in, its questions and artifact scope out. */
export async function runFormParse(
  input: FormParseInput,
  generate?: GenerateCall,
): Promise<FormParseOut> {
  const { system, parts } = buildFormParsePrompt(input)
  return generateStructured(
    { parts, system, schema: FormParseOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
}
