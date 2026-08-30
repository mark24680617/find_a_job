/**
 * The prepBrief prompt: one round type, the parsed posting and the candidate's facts in, the
 * instructions that turn them into a prep brief out. The system text below is the design
 * spec's, word for word — its last line is the whole product in one sentence ("It does not
 * script lies"), and the angle rule is what keeps the brief pointing at facts the candidate
 * actually gave. So it is quoted rather than rewritten, and `tests/prompts.interview.test.ts`
 * holds a copy that fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import type { ParsedJob, RoundType } from '@/lib/types'

const SYSTEM = `You write an interview prep brief for one round.
Input: the round type, the parsed job (role facts, gates, themes), the candidate's facts.
Sections:
- likelyTopics: what THIS round type at THIS company probes, tied to the role facts.
- questionsToPrepare: likely questions + angle = which candidate fact cluster answers each.
  Use only provided facts for angles; never invent an experience.
- questionsToAsk: sharp questions the candidate should ask back, grounded in role facts.
- factsToRehearse: the candidate's facts (verbatim claims) most load-bearing for this round.
- redFlags: pitfalls for this candidate in this round (unmet gates that may come up —
  say how to address honestly, not how to dodge).
The brief prepares the candidate to tell their own story clearly. It does not script lies.`

/**
 * The posting as the brief needs it: the company and role it is for, the role facts the
 * topics and the questions-to-ask must be tied to, the gates the red flags come out of, and
 * the themes. The advisory and the scope are left out — one is an apply-or-skip decision
 * already taken by the time a round is booked, the other is about where a document attaches.
 * Each gate carries its verdict and its posture, because a red flag about an unmet explicit
 * minimum reads differently from one the posting itself softened.
 */
export function summarizeJob(parsed: ParsedJob): string {
  const sections = [
    `Company: ${parsed.company}`,
    `Role: ${parsed.role}`,
    `Role facts:\n${parsed.roleFacts.map((f) => `- ${f}`).join('\n')}`,
    `Gates:\n${parsed.gates
      .map((g) => `- [met=${g.met}, ${g.posture}] ${g.requirement} — ${g.note}`)
      .join('\n')}`,
    `Themes: ${parsed.themes.join(', ')}`,
  ]
  return sections.join('\n\n')
}

export interface PrepBriefPromptInput {
  roundType: RoundType
  jobSummary: string
  factsSummary: string
}

/**
 * The round type first — every section below is written for one kind of conversation, and a
 * brief for the wrong one is worse than none — then the posting it is at, then the facts the
 * angles and the rehearsal lines have to come from.
 */
export function buildPrepBriefPrompt(input: PrepBriefPromptInput): {
  system: string
  parts: Part[]
} {
  const parts: Part[] = [
    { text: `Round type: ${input.roundType}` },
    { text: `The job:\n${input.jobSummary}` },
    { text: `Candidate facts:\n${input.factsSummary}` },
  ]
  return { system: SYSTEM, parts }
}
