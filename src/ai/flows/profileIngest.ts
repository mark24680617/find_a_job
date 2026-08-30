import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { buildProfileIngestPrompt, type ProfileIngestInput } from '@/ai/prompts/profileIngest'
import { ProfileIngestOutSchema, type ProfileIngestOut } from '@/ai/schemas'

/**
 * Extraction over a whole resume is the one flow worth paying thinking tokens for: the
 * model has to hold the document in mind while splitting it into atomic claims and
 * finding the verbatim snippet behind each one. Every other flow works from a much
 * smaller input and keeps the default budget of 0.
 */
const THINKING_BUDGET = 512

/** Resume PDF and/or pasted notes in, cited facts and a gaps list out. */
export async function runProfileIngest(
  input: ProfileIngestInput,
  generate?: GenerateCall,
): Promise<ProfileIngestOut> {
  const { system, parts } = buildProfileIngestPrompt(input)
  return generateStructured(
    { parts, system, schema: ProfileIngestOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
}
