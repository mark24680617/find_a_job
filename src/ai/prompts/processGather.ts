import type { Part } from '@/ai/genkit'
import type { RoleFamily } from '@/lib/research/roleFamily'

/**
 * The gather prompt: one planned search in, a handful of observations out. The system text
 * is the spec's, word for word, and `tests/prompts.process.test.ts` holds a copy — the rule
 * that matters is "no URLs": the sources are read from the response's metadata, and a URL in
 * the prose is one nobody verified.
 */
export const GATHER_SYSTEM = `You research how one company interviews for one role. Use Google Search.
Write 3 to 8 observations, one per line, each a single factual sentence about the interview
process: the rounds, their order, format and length, take-home assignments, or the questions
asked. Prefer recent, first-hand accounts. No URLs, no numbering, no preamble.
If the search finds nothing specific to this company, write one line beginning with
"Nothing specific:" and then what is usual for the role family.`

export interface ProcessGatherPromptInput {
  company: string
  role: string
  family: RoleFamily
  query: string
}

export function buildProcessGatherPrompt(input: ProcessGatherPromptInput): { system: string; parts: Part[] } {
  return {
    system: GATHER_SYSTEM,
    parts: [
      { text: `Company: ${input.company}\nRole: ${input.role}\nRole family: ${input.family}\nSearch for: ${input.query}` },
    ],
  }
}
