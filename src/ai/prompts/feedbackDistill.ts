/**
 * The feedbackDistill prompt: an AI draft and the human's final edit of the same answer in,
 * the instructions that turn the difference between them into durable voice rules out. The
 * system text below is the design spec's, word for word — it draws the one line this flow
 * turns on (a VOICE rule generalises to the next answer, a content edit does not), so it is
 * quoted rather than rewritten, and `tests/prompts.feedbackDistill.test.ts` holds a copy that
 * fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'

const SYSTEM = `Compare the AI draft with the human's final edit of the same answer.
Extract 0-3 durable voice rules: how THIS person writes, phrased as instructions a future
draft can follow ("cuts openers, starts with the fact", "replaces adjectives with numbers",
"shortens sentences to <20 words"). Only patterns that would generalize to other answers —
never content-specific edits ("mentions TRM" is content, not voice). evidence: quote the
before→after fragment that shows the rule. If the edit shows no generalizable pattern,
return zero rules. Do not restate existing rules.`

export interface FeedbackDistillInput {
  /** The answer the model wrote. */
  draft: string
  /** The answer the human actually saved, after their edits. */
  final: string
  /** Rule text the profile already holds — sent so the model does not restate what is known. */
  existingRules: string[]
}

/**
 * The rules already known, so the model spends its three slots on what is new. Only the rule
 * text goes — the evidence behind each is the profile editor's, not material for this call —
 * and an empty list is dropped rather than sent as a bare header: nothing known is not a
 * section, and an empty part is noise the model has to account for.
 */
function existingRulesPart(rules: string[]): string | null {
  if (rules.length === 0) return null
  const lines = rules.map((rule) => `- ${rule}`)
  return `Voice rules already known — do not restate these:\n${lines.join('\n')}`
}

/**
 * The draft first, then the human's edit of it: the rule is read out of the change from one
 * to the other, so the model needs both, each labelled which side of the edit it is. The
 * known rules come last — a constraint on the answer, not part of the thing being compared.
 * Both texts are always sent: this flow is only ever called on a genuine edit, so neither is
 * empty, and there is nothing to guard against here that the caller has not already ruled out.
 */
export function buildFeedbackDistillPrompt(input: FeedbackDistillInput): {
  system: string
  parts: Part[]
} {
  const sections = [
    `The AI draft (before):\n${input.draft}`,
    `The human's final edit (after):\n${input.final}`,
    existingRulesPart(input.existingRules),
  ]
  return { system: SYSTEM, parts: sections.filter((s) => s !== null).map((text) => ({ text })) }
}
