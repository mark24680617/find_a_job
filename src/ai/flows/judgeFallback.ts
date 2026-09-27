import { z } from 'genkit'
import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import type { Noul } from '@/ai/jev'
import { JUDGE_FALLBACK_SYSTEM, buildJudgeFallbackPrompt } from '@/ai/prompts/judgeFallback'

/**
 * LOW, as spec §4 (Fallback) sets it. It is not measured on this flow: the evidence is the nearest
 * measured atomic call, where MEDIUM took the mock's median turn from ~1 s to ~6 s
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14"), and Diagnose makes this
 * call once per bullet on the demo path. What a Diagnose on this arm actually takes is recorded by
 * C10b's smoke under "Measured timings".
 */
const THINKING_LEVEL: ThinkingLevel = 'LOW'

/**
 * The model id stamped on every judgement this flow answers, so a stored `BulletJudgement` says
 * which model said it. It must equal the model `src/ai/genkit.ts:15` builds every call with.
 */
export const JUDGE_FALLBACK_MODEL = 'gemini-3.8-flash'

const ANSWER = z.enum(['yes', 'no'])

/**
 * A schema with one enum per question id, built from the ids rather than from a `z.record()`:
 * `z.record()` would put a bare `{type:'object'}` in front of the model, and the whole point of
 * this call is that the keys are fixed. Built here and named in the prompt, both.
 */
function schemaFor(ids: string[]): z.ZodType<Record<string, 'yes' | 'no'>> {
  const shape: Record<string, typeof ANSWER> = {}
  for (const id of ids) shape[id] = ANSWER
  return z.object(shape) as unknown as z.ZodType<Record<string, 'yes' | 'no'>>
}

/**
 * The same questions JEV would have been asked, answered yes or no. No number comes back — there
 * is nothing here to calibrate and nothing to put a band around, so §6.1's `unjudged` band does
 * not apply on this arm and `toVerdict` says so.
 *
 * `temperature` is sent explicitly rather than left to the default: a judgement that changed
 * between two runs of the same resume would make the count on screen a sample.
 *
 * `systemPrompt` defaults to the Diagnose prompt; Gaps passes `JUDGE_FALLBACK_GAPS_SYSTEM` (R34).
 */
export async function judgeWithGemini(
  state: string,
  questions: Record<string, Noul>,
  generate?: GenerateCall,
  systemPrompt: string = JUDGE_FALLBACK_SYSTEM,
): Promise<Record<string, 'yes' | 'no'>> {
  const ids = Object.keys(questions)
  const { system, parts } = buildJudgeFallbackPrompt(state, questions, systemPrompt)
  const out = await generateStructured(
    { parts, system, schema: schemaFor(ids), thinkingLevel: THINKING_LEVEL, temperature: 0 },
    generate,
  )
  // The schema already refused a missing id and a word that is not one of the two. This drops a
  // key nobody asked for, so the caller's loop over its own ids is the only thing that decides
  // what was judged.
  const answers: Record<string, 'yes' | 'no'> = {}
  for (const id of ids) answers[id] = out[id]
  return answers
}
