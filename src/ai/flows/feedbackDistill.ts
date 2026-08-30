import { generateStructured, type GenerateCall } from '@/ai/genkit'
import { buildFeedbackDistillPrompt, type FeedbackDistillInput } from '@/ai/prompts/feedbackDistill'
import { FeedbackDistillOutSchema, type FeedbackDistillOut } from '@/ai/schemas'

/**
 * Naming the difference between two short answers is a narrow, local read — no weighing of
 * facts against a posting, no counting, no choosing an angle. formParse's 256 is the right
 * size for that kind of judgment; nothing heavier would buy a better rule.
 */
const THINKING_BUDGET = 256

/** An AI draft and the human's final edit of it in, at most three durable voice rules out. */
export async function runFeedbackDistill(
  input: FeedbackDistillInput,
  generate?: GenerateCall,
): Promise<FeedbackDistillOut> {
  const { system, parts } = buildFeedbackDistillPrompt(input)
  return generateStructured(
    { parts, system, schema: FeedbackDistillOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
}
