import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { buildProfileIngestPrompt, type ProfileIngestInput } from '@/ai/prompts/profileIngest'
import { ProfileIngestOutSchema, type ProfileIngestOut } from '@/ai/schemas'

/**
 * Extraction over a whole resume: the model has to hold the document in mind while splitting it
 * into atomic claims and finding the verbatim snippet behind each one. It is at MEDIUM as a hedge:
 * the levels scored within noise, but the only unsupported employer tag came from no thinking, and
 * the story path saves extracted facts without review (docs/notes/deps.md, "Thinking levels per
 * flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

/** Resume PDF and/or pasted notes in, cited facts and a gaps list out. */
export async function runProfileIngest(
  input: ProfileIngestInput,
  generate?: GenerateCall,
): Promise<ProfileIngestOut> {
  const { system, parts } = buildProfileIngestPrompt(input)
  return generateStructured(
    { parts, system, schema: ProfileIngestOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
}
