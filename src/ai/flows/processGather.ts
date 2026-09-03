import { generateGrounded, type GenerateCall, type GroundedResult } from '@/ai/genkit'
import { buildProcessGatherPrompt, type ProcessGatherPromptInput } from '@/ai/prompts/processGather'

/** Reading search results into a few sentences is close to transcription; a small budget. */
const THINKING_BUDGET = 512

export interface ProcessGatherOut extends GroundedResult {
  notes: string[]
}

/** One planned search in — the observations, and the pages Google grounded them on, out. */
export async function runProcessGather(input: ProcessGatherPromptInput, generate?: GenerateCall): Promise<ProcessGatherOut> {
  const { system, parts } = buildProcessGatherPrompt(input)
  const res = await generateGrounded({ parts, system, thinkingBudget: THINKING_BUDGET }, generate)
  // One observation per line was asked for; numbering and bullets are stripped in case the
  // model added them anyway, and blank lines dropped. A list number is one or two digits and
  // is followed by a space — enough for any list the model would write, and narrow enough
  // that "2024. The loop changed." keeps its year instead of losing it to the marker rule.
  const notes = res.text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, '').trim())
    .filter((line) => line !== '')
  return { ...res, notes }
}
