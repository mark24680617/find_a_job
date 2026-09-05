/**
 * The prepBrief prompt: one round type, the parsed posting and the candidate's facts in — and,
 * once the process map exists, the stage this round is and the questions people report being
 * asked at this company — the instructions that turn them into a prep brief out. The system
 * text below is the design specs', word for word (the five sections from the MVP spec, the
 * citation rule from the round-practice one) — its last line is the whole product in one
 * sentence ("It does not script lies"), and the angle rule is what keeps the brief pointing at
 * facts the candidate actually gave. So it is quoted rather than rewritten, and
 * `tests/prompts.interview.test.ts` holds a copy that fails the build if this one drifts.
 */
import type { Part } from '@/ai/genkit'
import type { ReportedQuestion, StagePlacement } from '@/lib/practice'
import type { ParsedJob, RoundType } from '@/lib/types'

const SYSTEM = `You write an interview prep brief for one round.
Input: the round type, the parsed job (role facts, gates, themes), the candidate's facts.
Sections:
- likelyTopics: what THIS round type at THIS company probes, tied to the role facts.
- questionsToPrepare: likely questions + angle = which candidate fact cluster answers each.
  Use only provided facts for angles; never invent an experience.
  When questions people report being asked are given, lead questionsToPrepare with the ones
  that fit THIS stage, copied word for word, each with the sourceId of the guide that reported
  it. Write your own only after those, with sourceId null. A reported question that does not
  fit this stage is left out, not adapted.
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

/**
 * The stage this round is, as the brief needs it: where it sits on the loop and how far in,
 * how it runs and how long, what it probes, and what people advise for it. A missing length is
 * stated rather than dropped — a length the model cannot see is one it will assume, and a
 * 45-minute screen and a four-hour onsite are not prepared for alike. The Tips block is omitted
 * entirely when the stage has no tips — not left as a bare heading: an empty heading reads to a
 * model as an instruction to fill it, which is how a stage with no advice acquires invented advice.
 */
export function summarizeStage(placement: StagePlacement): string {
  const { stage, of } = placement
  const lines = [
    `Stage ${stage.order} of ${of}: ${stage.name} · ${stage.format} · ${stage.duration ?? 'length not stated'}`,
    `What it probes: ${stage.whatItProbes}`,
  ]
  if (stage.tips.length > 0) lines.push(`Tips:\n${stage.tips.map((t) => `- ${t}`).join('\n')}`)
  return lines.join('\n')
}

/**
 * Every question the guides reported, one per line. The source id leads the line because it is
 * the token the model has to hand back to cite the question, and `citeReported` checks what
 * comes back against exactly this list. The bracket says how much the line is worth: somebody's
 * own account of this loop carries more than a prep site's list, and a question from a guide
 * that is old and known to be old should be read with that in mind. A guide digested before we
 * recorded first-hand has no flag at all, so the line says neither rather than guessing.
 */
export function summarizeReported(reported: ReportedQuestion[]): string {
  if (reported.length === 0) return '(none)'
  return reported
    .map((r) => {
      const tags = [
        ...(r.firstHand === undefined ? [] : [r.firstHand ? 'first-hand' : 'second-hand']),
        r.year ?? 'undated',
        ...(r.stale ? ['stale'] : []),
      ]
      return `${r.sourceId} [${tags.join('; ')}]: ${r.text}`
    })
    .join('\n')
}

export interface PrepBriefPromptInput {
  roundType: RoundType
  jobSummary: string
  factsSummary: string
  /** The mapped stage, when the application has a map and this round is on it. */
  stageSummary?: string
  /** Every reported question, whenever there is a map — `(none)` when the guides had none. */
  reportedSummary?: string
}

/**
 * The round type first — every section below is written for one kind of conversation, and a
 * brief for the wrong one is worse than none — then the stage, which is what this round
 * actually is when the loop has been researched, then the posting it is at, then the facts the
 * angles and the rehearsal lines have to come from. The reported questions come last, after the
 * facts, because that is the order they are judged in: a question is worth leading with only if
 * this candidate has something to say to it.
 */
export function buildPrepBriefPrompt(input: PrepBriefPromptInput): {
  system: string
  parts: Part[]
} {
  const parts: Part[] = [{ text: `Round type: ${input.roundType}` }]
  if (input.stageSummary !== undefined) {
    parts.push({ text: `The stage this round is:\n${input.stageSummary}` })
  }
  parts.push({ text: `The job:\n${input.jobSummary}` })
  parts.push({ text: `Candidate facts:\n${input.factsSummary}` })
  if (input.reportedSummary !== undefined) {
    parts.push({ text: `Questions people report being asked at this company:\n${input.reportedSummary}` })
  }
  return { system: SYSTEM, parts }
}
