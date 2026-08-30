/**
 * The profileIngest prompt: a resume PDF and/or pasted notes in, the instructions that
 * turn them into cited facts out. The system text below is the design spec's, word for
 * word — it is the only place the never-invent rule is stated to the model, so it is
 * quoted rather than rewritten, and `tests/prompts.profileIngest.test.ts` holds a copy
 * that fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'

/**
 * The standard-answer keys — the facts only the candidate knows. The model fills one
 * only when the input states it and writes "UNKNOWN" otherwise; it never guesses.
 *
 * These are pinned by the prompt alone: the plugin strips `additionalProperties` from
 * the schema it sends (docs/notes/deps.md), so `standardAnswers` reaches the model as a
 * bare object with no key list. The list inside SYSTEM is therefore the real contract,
 * and the prompt test asserts this array and that list still agree.
 */
export const STANDARD_KEYS = [
  'work_authorization',
  'visa_sponsorship_needed',
  'relocation',
  'remote_onsite_preference',
  'earliest_start_date',
  'notice_period',
  'salary_expectation',
  'security_clearance',
] as const

const SYSTEM = `You extract a candidate's profile from their resume and notes.
Rules:
- Output facts: atomic, verifiable claims. Each fact MUST carry sourceSnippet: the verbatim
  fragment of the input it came from. Never merge two claims into one fact. Never infer a
  fact that is not stated. Quantified facts (numbers, dates, scale) are separate facts.
- tags: 2-4 lowercase topic tags per fact (e.g. "backend", "ios", "leadership"). Where a fact
  clearly belongs to one named company, school or project, add one further tag "entity:<Name>",
  the name written as the input writes it — "entity:Fenwick". At most one, and only when the
  input names it.
- standardAnswers: for each of these keys, fill the value ONLY if the input states it,
  else the string "UNKNOWN":
  work_authorization, visa_sponsorship_needed, relocation, remote_onsite_preference,
  earliest_start_date, notice_period, salary_expectation, security_clearance.
- gaps: list what a job application will likely need that this input does not contain
  (missing dates, unexplained employment gaps, missing metrics, missing links). Never list a
  gap that one of the standardAnswers keys above already covers — those are asked separately.
A resume states someone's story. Do not improve it, do not embellish it — capture it.

Fact ids are sequential: the first fact is f1, the next f2, and so on through fN. No other
id format is valid.`

export interface ProfileIngestInput {
  pdfBase64?: string
  pastedText?: string
}

/**
 * The PDF goes first: it is the document, and the pasted text is the note beside it.
 * Empty strings are dropped rather than sent — an empty part is noise the model has to
 * account for. Nothing left to send is an error, not an empty prompt: asking for facts
 * with no input in front of it is the one situation where a model has to invent them.
 */
export function buildProfileIngestPrompt(input: ProfileIngestInput): {
  system: string
  parts: Part[]
} {
  const parts: Part[] = []
  if (input.pdfBase64) {
    parts.push({
      media: {
        url: `data:application/pdf;base64,${input.pdfBase64}`,
        contentType: 'application/pdf',
      },
    })
  }
  if (input.pastedText) parts.push({ text: `Pasted resume / notes:\n${input.pastedText}` })
  if (parts.length === 0) throw new Error('profileIngest needs a pdfBase64 or pastedText')
  return { system: SYSTEM, parts }
}
