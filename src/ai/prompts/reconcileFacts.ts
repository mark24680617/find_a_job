/**
 * The reconcileFacts prompt: the fact bank the profile already holds plus one fresh extraction
 * in, the instructions that turn them into the smallest honest changeset out.
 *
 * This is the step that stands between a document and the vault. The old ingest appended —
 * upload the same resume twice and the bank said everything twice — so the rules here are all
 * about the same claim arriving again: recognise it, merge it when the new telling is better,
 * and when you genuinely cannot tell whether two claims are the same claim, ask rather than
 * guess. `tests/prompts.reconcileFacts.test.ts` holds a copy of the system text that fails the
 * build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import type { ClarifyAnswer, Fact, FactAdd } from '@/lib/types'

const SYSTEM = `You reconcile one fresh extraction against a profile that already exists.

You are given the facts the profile already holds, each with an id, and the facts just extracted from a new document. Work out the smallest honest change to the profile. This is a person's record of their own career: a change you cannot justify is worse than no change.

Account for every extracted fact exactly once, as one of:
- adds — it says something the profile does not hold. Carry its claim and its verbatim sourceSnippet across unchanged.
- updates — it is the same claim as a stored fact, told better: a number the stored one lacks, a date, a scope, a correction. Name the stored fact's id and write the merged claim. The merged claim must keep everything the stored one established and add what is new. Never update a fact into saying less than it said.
- skips — the profile already holds it. Name the id it duplicates, and give one line saying why.

A stored fact belongs to at most one of updates and skips. If you are revising it, that is the whole account of it; do not also skip it.

Nothing may be dropped in silence. If you cannot tell whether an extracted fact is the same claim as a stored one, or which stored fact it revises, do not guess — ask.

questions: at most 4, and only for matches you genuinely cannot settle. Fewer is better; none is normal. Each is a short question, a one-line why it changes the outcome, 2 to 4 concrete options quoting the actual claims in play, and a recommended option — what you would do if the candidate never answered. Number them c1, c2, c3 … in order. An answer you have already been given is settled: apply it and do not ask it again.

tags: 2-4 lowercase topic tags. Where a fact clearly belongs to one named company, school or project, include one further tag "entity:<Name>", the name written as the document writes it — "entity:Fenwick". Only where the documents say so: do not file a fact under a company because it is the only one mentioned. An update is the place to give a stored fact an entity tag it is missing.

When the candidate has said what is wrong with your previous changeset, their words settle it. Redo it their way, even where you would have judged otherwise.

Never write a claim the documents do not support. Do not improve the candidate's story — reconcile it.`

export interface ReconcileFactsInput {
  /** The bank as stored. Ids in `updates` and `skips` must name one of these. */
  facts: Fact[]
  /** The fresh extraction's facts. Their own ids are deliberately not shown — see below. */
  extracted: FactAdd[]
  /** Answers to a previous round's questions, if the candidate has settled any. */
  answers?: ClarifyAnswer[]
  /** The candidate's own words about what a previous changeset got wrong. */
  guidance?: string
}

/**
 * The stored bank, one `f<id>: claim` line each with its tags — the only ids in this prompt, and
 * the only ones an update or a skip may name. Tags are shown because an update's job includes
 * giving a stored fact the entity tag it is missing, which cannot be judged blind.
 *
 * An empty bank is sent as "(none)" rather than omitted: a model shown nothing has to be told
 * that nothing is what there is, or it starts wondering what it was not given.
 */
function storedPart(facts: Fact[]): string {
  const lines = facts.map((f) => {
    const tags = f.tags.filter((t) => t.trim() !== '')
    return `${f.id}: ${f.claim}${tags.length ? ` [tags: ${tags.join(', ')}]` : ''}`
  })
  return `Facts the profile already holds:\n${lines.join('\n') || '(none)'}`
}

/**
 * The fresh extraction, numbered 1..N — NOT f1..fN.
 *
 * The extractor numbers its own output from f1 every run, so its "f1" and the bank's "f1" are
 * different facts with the same name. Showing both would let a model put an extraction id into
 * an update, which the route would then either reject or, worse, apply to the wrong stored fact.
 * So the extraction arrives unnamed, and the instruction under it says which ids are real.
 */
function extractedPart(extracted: FactAdd[]): string {
  const blocks = extracted.map((f, i) => {
    const snippet = f.sourceSnippet.trim()
    return `${i + 1}. ${f.claim}${snippet ? `\n   source: ${snippet}` : ''}`
  })
  return [
    'Facts just extracted from the new document (these have no ids — every id in updates and',
    'skips must name a stored fact above):',
    blocks.join('\n'),
  ].join('\n')
}

/**
 * The questions the candidate has already settled. Only answered ones go: an unanswered card is
 * still open, and feeding it back as though it were resolved would settle it on their behalf.
 */
function answersPart(answers: ClarifyAnswer[]): string | null {
  const settled = answers
    .map((a) => ({ question: a.question, answer: a.answer.filter((v) => v.trim() !== '') }))
    .filter((a) => a.answer.length > 0)
  if (settled.length === 0) return null
  const blocks = settled.map((a) => `Q: ${a.question}\nAnswered: ${a.answer.join(', ')}`)
  return `The candidate has settled these — apply them and do not ask again:\n\n${blocks.join('\n\n')}`
}

/** What the candidate said was wrong with the last changeset. Last, so it is read last. */
function guidancePart(guidance: string): string | null {
  const words = guidance.trim()
  if (words === '') return null
  return `The candidate says this about your previous changeset — their words take precedence:\n${words}`
}

/**
 * The bank first — it is what the extraction is being read against — then the extraction, then
 * whatever the candidate has already settled, then their own words about the last attempt.
 * Empty sections are dropped rather than sent as bare headers. An empty extraction is refused:
 * a reconcile with nothing to reconcile is a changeset invented out of the bank alone.
 */
export function buildReconcileFactsPrompt(input: ReconcileFactsInput): {
  system: string
  parts: Part[]
} {
  if (input.extracted.length === 0) throw new Error('reconcileFacts needs extracted facts')
  const sections = [
    storedPart(input.facts),
    extractedPart(input.extracted),
    answersPart(input.answers ?? []),
    guidancePart(input.guidance ?? ''),
  ]
  return { system: SYSTEM, parts: sections.filter((s) => s !== null).map((text) => ({ text })) }
}
