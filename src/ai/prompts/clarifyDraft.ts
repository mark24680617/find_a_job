/**
 * The clarifyDraft prompt: one question, the raw posting and the candidate's facts in, the
 * instructions that turn them into a short round of positioning questions out. The system
 * text is the design spec's, word for word — it draws the line the whole step turns on
 * (positioning, never information; ask only what the facts cannot settle), so it is quoted
 * rather than rewritten, and `tests/prompts.clarifyDraft.test.ts` holds a copy that fails
 * the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import type { ClarifyAnswer, Fact, Question } from '@/lib/types'

const SYSTEM = `You set up one job-application answer before it is written. Your job is to find what the writer must decide that only the candidate can settle — never to ask for a fact.

You are given the question, the raw job posting, and the candidate's facts. First work out, silently, what this role is really screening for — the competencies and signals a strong candidate must show, read from the posting's responsibilities and requirements, not its adjectives. Then find where the candidate's facts could match that in more than one way, or where the strongest answer depends on something the facts do not settle.

Ask only about those. Rules:
- Never ask for a fact you were given or could infer from the facts. Positioning, not information: which experience should lead, which angle to take, whether to address a gap head-on, what the candidate cares about in THIS role that the facts do not say.
- At most 4 questions. Fewer is better. If the answer is clear from the facts and the posting, ask nothing — return an empty list and the answer will be written directly.
- Each question: a short question, a one-line why it changes the answer, 2 to 4 concrete options drawn from the candidate's actual material, a recommended option, and whether more than one option can hold at once.
- Options must be real and specific to this candidate and this role — never generic. The recommended option is the one you would pick if the candidate never answered.
- allowOther only when a free-text answer would genuinely serve better than your options.`

export interface ClarifyDraftInput {
  question: Question
  /** The raw posting — the depth source. The caller truncates it before it arrives here. */
  jdText: string
  facts: Fact[]
  /** The candidate's settled answers, straight off the profile — "UNKNOWN" values and all. */
  standardAnswers: Record<string, string>
  /** Positioning already chosen on an earlier round, so the model does not ask it again. */
  clarifyAnswers: ClarifyAnswer[]
}

/** The question whose answer this round is setting up. */
function askPart(question: Question): string {
  return `The question the answer will address:\n${question.q}`
}

/** The posting, verbatim — the material the model reads the role's real screens out of. */
function jobPostingPart(jdText: string): string {
  return `The job posting:\n${jdText}`
}

/**
 * The facts, one `f<id>: claim` line each — the material every option must be drawn from.
 * An empty list is sent as "(none)" rather than omitted: options can only be as specific as
 * the facts behind them, and a model told there is nothing to draw on asks less, not more.
 */
function factsPart(facts: Fact[]): string {
  const lines = facts.map((f) => `${f.id}: ${f.claim}`)
  return `Candidate facts (draw every option from these):\n${lines.join('\n') || '(none)'}`
}

/**
 * The answers the candidate has already settled. "UNKNOWN" is profileIngest's placeholder
 * for a key the resume never stated, so it is dropped — sending it would present a non-answer
 * as one, and the whole point of this step is to notice what the facts leave open.
 */
function standardAnswersPart(answers: Record<string, string>): string | null {
  const lines = Object.entries(answers)
    .filter(([, v]) => v.trim() !== '' && v.trim().toUpperCase() !== 'UNKNOWN')
    .map(([k, v]) => `${k}: ${v}`)
  if (lines.length === 0) return null
  return `Standard answers the candidate has already settled:\n${lines.join('\n')}`
}

/**
 * The positioning the candidate settled on an earlier round. Only answered ones go, so the
 * model does not re-ask a decision already made; an unanswered card is still open and is not
 * something to feed back as though it were resolved.
 */
function priorChoicesPart(clarifyAnswers: ClarifyAnswer[]): string | null {
  const chosen = clarifyAnswers
    .map((a) => ({ question: a.question, answer: a.answer.filter((v) => v.trim()) }))
    .filter((a) => a.answer.length > 0)
  if (chosen.length === 0) return null
  const blocks = chosen.map((a) => `Q: ${a.question}\nChose: ${a.answer.join(', ')}`)
  return `The candidate has already settled these — do not ask them again:\n\n${blocks.join('\n\n')}`
}

/**
 * Numbering is stated here, not in the system text: the schema enforces the `c<n>` shape and
 * the flow keys stored answers back by it, so the model has to hear the convention it is
 * being held to. Kept out of the verbatim system block so that block stays the spec's.
 */
function idInstructionPart(): string {
  return 'Number your questions c1, c2, c3 … in order.'
}

/**
 * The question first — everything else is read through it — then the posting it must be
 * matched to, the facts every option is drawn from, and whatever the candidate has already
 * settled. Empty sections are dropped rather than sent as bare headers. A question with no
 * text, or a posting with none, is refused: with either missing the model would be inventing
 * the very thing it is meant to be reasoning from.
 */
export function buildClarifyDraftPrompt(input: ClarifyDraftInput): {
  system: string
  parts: Part[]
} {
  if (!input.question.q.trim()) throw new Error('clarifyDraft needs a question')
  if (!input.jdText.trim()) throw new Error('clarifyDraft needs the job posting')
  const sections = [
    askPart(input.question),
    jobPostingPart(input.jdText),
    factsPart(input.facts),
    standardAnswersPart(input.standardAnswers),
    priorChoicesPart(input.clarifyAnswers),
    idInstructionPart(),
  ]
  return { system: SYSTEM, parts: sections.filter((s) => s !== null).map((text) => ({ text })) }
}
