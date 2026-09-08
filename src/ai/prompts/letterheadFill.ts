/**
 * The letterheadFill prompt: the candidate's facts and the posting in, the instructions that
 * turn them into the five letterhead fields nobody should have to retype out.
 *
 * The system text is an extraction brief, not a writing brief. Each field names the one document
 * it may come from, and the rules underneath spell out the three ways a fill goes wrong — a value
 * with no quote behind it, a value inferred from something next to it, and a value taken from the
 * other document. `tests/prompts.letterheadFill.test.ts` holds a copy that fails the build if this
 * one drifts.
 *
 * The two documents are laid out with the same builders the draft prompt uses where there is one,
 * because a field verified against the posting has to be verified against the posting the model
 * was actually shown.
 */
import { jobPostingPart } from '@/ai/prompts/answerDraft'
import type { Part } from '@/ai/genkit'
import type { Fact, ParsedJob } from '@/lib/types'

const SYSTEM = `You fill in the letterhead of a cover letter from two documents, and you never guess.
From the candidate's facts, and only from them: their phone number, and where they are based as "City, State" or "City, Country".
From the job posting, and only from it: the full name of the person applications go to, the hiring manager, or whom the role reports to; that person's title; and the office or headquarters address the posting states for this role — the full address when it gives one, else the city and state.
Rules:
1. Every value carries a quote: a verbatim span of the fact or of the posting that states it. No quote, no value — return null.
2. Never infer. A company's city is not the candidate's; a recruiter's first name is not a full name; "remote" is not an address; a name signing a posting is the recipient only when the posting says applications or the role go to that person.
3. Never an honorific, never a street address for the candidate, never a value from anywhere but the document named for it.`

export interface LetterheadFillPromptInput {
  /** The whole fact bank. A phone number is on whichever fact carried the resume's header. */
  facts: Fact[]
  /** The posting as it was captured, truncated by the caller. */
  jdText: string
  /** Which role's office is being read for, and whose name is on the letter. */
  parsed: Pick<ParsedJob, 'company' | 'role'>
}

/**
 * The facts with the words behind each of them. The draft prompt's `factsPart` sends the claim
 * alone — provenance is for the profile editor, not material for an answer — but here the
 * provenance IS the material: a phone number is almost never a claim of its own, it is in the
 * resume header the contact fact was cut from, and a quote onto that header is what makes the
 * number checkable. An empty bank is sent as "(none)" for the same reason the draft's is: a
 * missing section reads as "this is not part of the task", where an empty one reads as "there is
 * nothing here to find", which is true and returns nulls rather than inventions.
 */
function factsWithSourcesPart(facts: Fact[]): string {
  const lines = facts.map((f) => `${f.id}: ${f.claim} — ${JSON.stringify(f.sourceSnippet)}`)
  return `The candidate's facts, with the words each came from:\n${lines.join('\n') || '(none)'}`
}

/**
 * The facts, the role, then the posting. Both documents can be missing one at a time — a profile
 * with no contact fact still lets the posting name a recipient, and an application whose posting
 * was never captured still lets the facts give a location — and each missing one simply takes its
 * fields down with it. Both missing is refused: a fill with nothing to read is the one situation
 * that forces the model to write five values out of the company name.
 */
export function buildLetterheadFillPrompt(input: LetterheadFillPromptInput): {
  system: string
  parts: Part[]
} {
  if (!input.jdText.trim() && input.facts.length === 0) {
    throw new Error('letterheadFill needs the facts or the posting')
  }
  const sections = [
    factsWithSourcesPart(input.facts),
    `Company: ${input.parsed.company}. Role: ${input.parsed.role}.`,
    jobPostingPart(input.jdText),
  ]
  return { system: SYSTEM, parts: sections.filter((s) => s !== null).map((text) => ({ text })) }
}
