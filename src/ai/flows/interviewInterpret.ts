import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import {
  buildInterviewInterpretPrompt,
  type InterviewInterpretPromptInput,
} from '@/ai/prompts/interviewInterpret'
import { InterviewInterpretOutSchema, type InterviewInterpretOut } from '@/ai/schemas'

/**
 * Reading a notice is a local read of one short document — which round this is, when, who is
 * on it — with one judgment in it: whether the notice actually states a time or only implies
 * one. It is set to LOW because the 2026-09-14 evaluation found no measurable gain from thinking
 * here (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'LOW'

export type InterviewInterpretInput = InterviewInterpretPromptInput

/** One scheduling notice in, the typed round — type, time, people, open questions — out. */
export async function runInterviewInterpret(
  input: InterviewInterpretInput,
  generate?: GenerateCall,
): Promise<InterviewInterpretOut> {
  const { system, parts } = buildInterviewInterpretPrompt(input)
  return generateStructured(
    { parts, system, schema: InterviewInterpretOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
}
