/**
 * The jobInterpret prompt: one job posting plus one candidate's facts in, the instructions
 * that turn them into a parsed posting out. The system text below is the design spec's,
 * word for word — it encodes the product's core judgment (the hard-gate posture ladder,
 * the per-application vs per-profile scope split, the apply-or-skip advisory), so it is
 * quoted rather than rewritten, and `tests/prompts.jobInterpret.test.ts` holds a copy that
 * fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import type { Fact } from '@/lib/types'

const SYSTEM = `You interpret one job posting for one specific candidate.
- roleFacts: the concrete facts of the role (team, product, level, location, salary if stated).
- gates: every hard requirement (numeric minimums, degree, work authorization, mandated
  overlap hours, on-site days). For each: met = yes/no/unclear judged ONLY against the
  candidate facts provided; posture =
    "escape-clause" if the posting itself softens it ("even if you don't meet every…"),
    "explicit"      if worded as must/minimum/required,
    "silent"        otherwise.
  In \`note\`, quote the posting's own wording (short).
- themes: which of the candidate's fact clusters this role rewards most (3-5, ranked).
- scope: does material for this application attach to one requisition ("per-application")
  or to a platform-wide profile ("per-profile")? Judge from the posting/platform; if you
  cannot tell, "unknown" — the UI will ask the human.
- advisory: if any gate has met=no with posture explicit or silent, state plainly whether
  to apply anyway or skip, and why, in ≤2 sentences. Unmet minimums are decisions, not
  details. Otherwise empty string.
Judge only from the posting text and candidate facts given. Do not invent requirements.`

/**
 * The candidate's facts, as the gate judgment sees them: one `f<id>: claim` line each and
 * nothing more. The stored fact also carries a sourceSnippet and tags, but a gate is
 * judged against the claim alone — the snippet is provenance for the profile editor, not
 * signal for this decision, so it is dropped to keep the prompt short. An empty list is a
 * real state (a brand-new profile), and it yields an empty summary rather than an error:
 * with no facts, every gate is judged "unclear", which is the honest answer, not invented.
 */
export function summarizeFacts(facts: Fact[]): string {
  return facts.map((f) => `${f.id}: ${f.claim}`).join('\n')
}

export interface JobInterpretPromptInput {
  jdText: string
  factsSummary: string
}

/**
 * The posting goes first — it is the document being interpreted — and the candidate facts
 * follow as the lens the gates are judged through. An empty jdText is refused: interpreting
 * a posting that isn't there is the one situation that forces the model to invent the
 * requirements it is supposed to be reading. An empty factsSummary is allowed (see above).
 */
export function buildJobInterpretPrompt(input: JobInterpretPromptInput): {
  system: string
  parts: Part[]
} {
  if (!input.jdText.trim()) throw new Error('jobInterpret needs jdText')
  const parts: Part[] = [
    { text: `Job posting:\n${input.jdText}` },
    { text: `Candidate facts:\n${input.factsSummary}` },
  ]
  return { system: SYSTEM, parts }
}
