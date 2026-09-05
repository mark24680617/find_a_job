/**
 * The interviewInterpret prompt: one scheduling notice in, the instructions that turn it into
 * a typed round out. The system text below is the design spec's, word for word — it carries
 * the round taxonomy the rest of the product keys on and the rule that keeps this flow honest
 * ("Never guess a date"), so it is quoted rather than rewritten, and
 * `tests/prompts.interview.test.ts` holds a copy that fails the build if this one drifts.
 *
 * The spec's first line says "email text or screenshot" and it stays as written: reading a
 * screenshot of a notice is roadmap, and today only text is sent. A notice pasted as text is
 * what an interview invitation actually is — an email — so nothing is lost by starting there.
 */
import type { Part } from '@/ai/genkit'

const SYSTEM = `You interpret an interview notice (email text or screenshot).
- roundType: recruiter-screen | technical | system-design | behavioral | panel | onsite | other.
  Judge from the notice's own words (who, how long, "coding", "values", "meet the team").
- datetime: ISO 8601 with timezone if the notice states one, else null. Never guess a date.
- people: names/titles of interviewers if stated.
- askHuman: what the notice does not say that preparation needs (round number? recruiter
  said what to expect? is there a take-home?). Ask, do not guess.`

export interface InterviewInterpretPromptInput {
  /** The notice as it arrived — an email pasted whole, headers, signature and all. */
  noticeText: string
}

/**
 * The notice and nothing else. An empty one is refused: interpreting a notice that isn't
 * there is the one situation that forces the model to invent a round type and a date, which
 * is exactly what the system text above forbids.
 */
export function buildInterviewInterpretPrompt(input: InterviewInterpretPromptInput): {
  system: string
  parts: Part[]
} {
  if (!input.noticeText.trim()) throw new Error('interviewInterpret needs noticeText')
  return { system: SYSTEM, parts: [{ text: `Interview notice:\n${input.noticeText}` }] }
}
