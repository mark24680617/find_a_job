import { generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { buildFeedbackDistillPrompt, type FeedbackDistillInput } from '@/ai/prompts/feedbackDistill'
import { FeedbackDistillOutSchema, type FeedbackDistillOut } from '@/ai/schemas'

/**
 * Naming the difference between two short answers is a narrow, local read — no weighing of
 * facts against a posting, no counting, no choosing an angle. It is set to LOW because the
 * 2026-09-14 evaluation found no measurable gain from thinking here
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'LOW'

/** An AI draft and the human's final edit of it in, at most three durable voice rules out. */
export async function runFeedbackDistill(
  input: FeedbackDistillInput,
  generate?: GenerateCall,
): Promise<FeedbackDistillOut> {
  const { system, parts } = buildFeedbackDistillPrompt(input)
  return generateStructured(
    { parts, system, schema: FeedbackDistillOutSchema, thinkingLevel: THINKING_LEVEL },
    generate,
  )
}
