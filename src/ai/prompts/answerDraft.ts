/**
 * The answerDraft prompt: one question, one candidate and one posting in, the instructions
 * that turn them into a cited draft out. The system text below is the design spec's, word
 * for word — it is where the product's central invariant is stated to the model (every
 * factual claim carries a citation or becomes a question for the human), so it is quoted
 * rather than rewritten, and `tests/prompts.answerDraft.test.ts` holds a copy that fails
 * the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import type { AskHuman, ClarifyAnswer, Fact, ParsedJob, QConstraints, Question } from '@/lib/types'

const SYSTEM = `You draft one job-application answer in the candidate's own voice.
The candidate's story is unique. You refine how it is told. You never replace it.
Hard rules:
1. GROUNDING. Every factual claim must trace to a provided fact (cite factId) or a provided
  standardAnswer / human answer. If the strongest answer needs something you do not have
  (motivation for THIS company, a date, a preference), do NOT write around it and do NOT
  hedge into vagueness — emit an askHuman item: the exact question, and why the answer
  needs it. An answer with an open askHuman is a draft with a hole, and that is correct.
2. citations: map each factual claimSpan (verbatim substring of your text) to its factId.
  Whole-cloth sentences with no possible citation are forbidden — rework or askHuman.
3. LIMIT. Stated limit is exact. Count. Under is fine, over is failure.
4. SCOPE. If parsed.scope is "per-profile": never quote this posting's wording, never
  confess gaps against this posting's requirements, never name a site/office. Those moves
  are only allowed when scope is "per-application".
5. REGISTER. Concrete, specific, understated. Prefer the quantified fact over the
  adjective. Ban: passionate, leverage, cutting-edge, delve, spearheaded, synergy.
6. VOICE RULES. Apply every provided voice rule; they encode how this person writes.
7. One story, one spine: pick the angle of the story that answers THIS question; do not
  reuse a spine that answers a different question.
8. MATCH, do not list. Work out what this role screens for from the posting, and lead with the candidate's single strongest match to it. An answer that recites facts in order is worse than one that makes the case for this candidate in this role. The positioning choices below, if any, are decisions the candidate has already made — follow them.
9. When the candidate's own telling is present, its specifics outrank resume-level phrasing. The answer should read like their story, written well — concrete, in order, still cited. Do not flatten it back into a summary.`

export interface AnswerDraftInput {
  question: Question
  parsed: ParsedJob
  /** The raw posting — what rule 8 reads the role's real screens out of. Caller truncates it. */
  jdText: string
  facts: Fact[]
  /** The candidate's settled answers, straight off the profile — "UNKNOWN" values and all. */
  standardAnswers: Record<string, string>
  /** Just the rule text; the evidence behind each is for the profile editor, not the model. */
  voiceRules: string[]
  humanAnswers: AskHuman[]
  /** Positioning the candidate settled in the clarify step — decisions the draft must follow. */
  clarifyAnswers: ClarifyAnswer[]
  /**
   * The candidate's own telling of what happened, in their words — optional, and the most
   * decisive material here when it is present. Rule 9 is what it is for.
   */
  story?: string
}

/**
 * The limit this answer must hit, or none. A limit and a unit only mean something together:
 * "at most 500" is a target in nothing, and counting it as words when the form meant
 * characters would reject a correct answer. Exported because the flow's guard enforces
 * exactly the limit this prompt states — one reading, so the two cannot drift apart.
 */
export function statedLimit(c: QConstraints): { limit: number; unit: 'words' | 'chars' } | null {
  if (c.limit === undefined || c.unit === undefined) return null
  return { limit: c.limit, unit: c.unit }
}

/** The question and the shape of the answer it takes. */
function askPart(question: Question): string {
  const { type, required } = question.constraints
  const stated = statedLimit(question.constraints)
  const length = stated ? `at most ${stated.limit} ${stated.unit}` : 'no stated limit'
  return [
    `Question to answer:\n${question.q}`,
    `Answer constraints: ${length}; field type ${type}; ${required ? 'required' : 'optional'}.`,
  ].join('\n\n')
}

/**
 * The posting, minus the advisory. `advisory` is the apply-or-skip call this product makes
 * TO the candidate — "skip, the 8-year minimum is explicit" — and it has no business in the
 * answer they submit. Everything else goes, `scope` above all: rule 4 is judged on it, so a
 * posting sent without it silently drops a hard rule.
 */
function jobPart(parsed: ParsedJob): string {
  const { company, role, roleFacts, gates, themes, scope } = parsed
  return `Parsed job:\n${JSON.stringify({ company, role, roleFacts, gates, themes, scope })}`
}

/**
 * The raw posting, verbatim — what rule 8 works out the role's real screens from. The parsed
 * job above is this product's reading of the posting; this is the posting itself, and matching
 * needs the responsibilities and requirements in their own words. Omitted when blank rather
 * than sent as an empty header: an application whose posting was never captured still drafts,
 * on the parsed job alone, and an empty section is noise the model has to account for.
 */
function jobPostingPart(jdText: string): string | null {
  if (!jdText.trim()) return null
  return `The job posting:\n${jdText}`
}

/**
 * The facts, as the draft cites them: one `f<id>: claim` line each. The stored fact also
 * carries a sourceSnippet and tags — provenance for the profile editor, not material for an
 * answer — so both are dropped. An empty list is sent as an explicit "(none)" rather than
 * omitted: a missing facts section reads as "grounding is not part of this task", where an
 * empty one reads as "there is nothing to cite", which is true and sends the model to
 * askHuman instead of to invention.
 */
function factsPart(facts: Fact[]): string {
  const lines = facts.map((f) => `${f.id}: ${f.claim}`)
  return `Candidate facts (cite these by id):\n${lines.join('\n') || '(none)'}`
}

/**
 * The answers the candidate has already settled. "UNKNOWN" is what profileIngest writes for
 * a key the resume never stated, so sending it would hand the model a non-answer dressed as
 * one; those keys are dropped, and their absence is what makes the model ask.
 */
function standardAnswersPart(answers: Record<string, string>): string | null {
  const lines = Object.entries(answers)
    .filter(([, v]) => v.trim() !== '' && v.trim().toUpperCase() !== 'UNKNOWN')
    .map(([k, v]) => `${k}: ${v}`)
  if (lines.length === 0) return null
  return `Standard answers the candidate has already settled:\n${lines.join('\n')}`
}

function voiceRulesPart(rules: string[]): string | null {
  if (rules.length === 0) return null
  const lines = rules.map((rule) => `- ${rule}`)
  return `Voice rules — how this person writes. Apply every one:\n${lines.join('\n')}`
}

/**
 * What the human has told the agent since the last draft. Only answered items go: an
 * unanswered askHuman is still a hole, and passing the question along as though it were
 * material is exactly the "write around it" move rule 1 forbids.
 */
function humanAnswersPart(items: AskHuman[]): string | null {
  const answered = items.filter((item) => item.answer?.trim())
  if (answered.length === 0) return null
  const blocks = answered.map((item) => `Q: ${item.question}\nA (from the candidate): ${item.answer}`)
  return `The candidate has already answered these:\n\n${blocks.join('\n\n')}`
}

/**
 * The candidate's own telling, verbatim. It sits directly under the facts because that is the
 * comparison rule 9 asks the model to make: the facts are this product's flattening of a
 * career into atomic claims, and the telling is the thing they were flattened from. Sent as
 * typed — unpolished, out of order, whatever it is — because polishing it is the job, and
 * because these same words are the sourceSnippets behind the facts just merged from it.
 *
 * Blank drops the section, like every other empty part.
 */
function storyPart(story: string | undefined): string | null {
  if (!story?.trim()) return null
  return `The candidate's own telling (use its specifics, keep its truth, raise its craft):\n${story}`
}

/**
 * The positioning the candidate settled in the clarify step — which strength leads, which
 * angle to take. Rule 8 treats these as decisions already made, so the draft follows them
 * rather than re-deciding. Only answered ones go, and an answer with several selected values
 * is joined into one line; an empty set drops the section, like every other empty part.
 */
function positioningChoicesPart(clarifyAnswers: ClarifyAnswer[]): string | null {
  const chosen = clarifyAnswers
    .map((a) => ({ question: a.question, answer: a.answer.filter((v) => v.trim()) }))
    .filter((a) => a.answer.length > 0)
  if (chosen.length === 0) return null
  const blocks = chosen.map((a) => `Q: ${a.question} / Chose: ${a.answer.join(', ')}`)
  return `The candidate's positioning choices:\n${blocks.join('\n')}`
}

/**
 * The question first — it decides which story gets told, and every other section is read
 * through it. Then the posting, the facts, and whatever the candidate has settled. Empty
 * sections are dropped rather than sent as bare headers (facts excepted, see above): an
 * empty part is noise the model has to account for. A question with no text is refused —
 * drafting an answer to nothing is the one situation that forces the model to invent both.
 */
export function buildAnswerDraftPrompt(input: AnswerDraftInput): {
  system: string
  parts: Part[]
} {
  if (!input.question.q.trim()) throw new Error('answerDraft needs a question')
  const sections = [
    askPart(input.question),
    jobPostingPart(input.jdText),
    jobPart(input.parsed),
    factsPart(input.facts),
    storyPart(input.story),
    positioningChoicesPart(input.clarifyAnswers),
    standardAnswersPart(input.standardAnswers),
    voiceRulesPart(input.voiceRules),
    humanAnswersPart(input.humanAnswers),
  ]
  return { system: SYSTEM, parts: sections.filter((s) => s !== null).map((text) => ({ text })) }
}
