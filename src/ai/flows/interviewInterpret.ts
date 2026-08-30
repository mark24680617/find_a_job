import { generateStructured, type GenerateCall } from '@/ai/genkit'
import {
  buildInterviewInterpretPrompt,
  type InterviewInterpretPromptInput,
} from '@/ai/prompts/interviewInterpret'
import { InterviewInterpretOutSchema, type InterviewInterpretOut } from '@/ai/schemas'

/**
 * Reading a notice is a local read of one short document — which round this is, when, who is
 * on it — with one judgment in it: whether the notice actually states a time or only implies
 * one. That is formParse's kind of work, so it gets formParse's budget. Nothing heavier would
 * make "next Thursday" into a date it is allowed to write down.
 */
const THINKING_BUDGET = 256

export type InterviewInterpretInput = InterviewInterpretPromptInput

/** One scheduling notice in, the typed round — type, time, people, open questions — out. */
export async function runInterviewInterpret(
  input: InterviewInterpretInput,
  generate?: GenerateCall,
): Promise<InterviewInterpretOut> {
  const { system, parts } = buildInterviewInterpretPrompt(input)
  return generateStructured(
    { parts, system, schema: InterviewInterpretOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
}
