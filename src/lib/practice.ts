import { mapRoundToStage } from '@/lib/processMap'
import { normalizeWs } from '@/lib/research/quotes'
import type { RoleFamily } from '@/lib/research/roleFamily'
import type {
  InterviewRound,
  PracticeMode,
  PrepBrief,
  ProcessMap,
  ProcessStage,
  RoundType,
  StageKind,
} from '@/lib/types'

/**
 * The decisions the practice half of a round makes in code instead of asking the model for:
 * which mode a stage is practised in, where a logged round sits on the reported loop, which
 * questions people say they were actually asked here, and which of the brief's citations
 * survive checking. Pure, so the route that starts a mock and the page that describes one
 * before a session exists reach the same answer, and so every one of them can be read in a
 * test rather than inferred from a transcript.
 */

/** The whole session. The `answer` action counts the questions; the model is never asked to. */
export const MAX_QUESTIONS = 6
/**
 * One answer, or a screen of code, with room to spare: long enough that nobody writing in
 * good faith meets it, short enough that a runaway paste is refused before a model call.
 */
export const MAX_ANSWER_CHARS = 12_000
/** The closing turn's text — written by the route, never by the model. */
export const CLOSING_LINE = 'That’s all I had. End the mock for the feedback.'
/**
 * How many reported questions a prompt may carry. Past this the list stops being evidence and
 * starts being noise, and the ordering below has already put the best-attested ones first.
 */
const REPORTED_CAP = 40

/**
 * Where a round sits, and how long the loop is. `mapRoundToStage` already decides which stage
 * a round claims; the count travels with it because everything that reads a placement — the
 * prompt's `Stage 2 of 5`, the page's heading — needs both, and reading the map twice is how
 * the two come apart.
 */
export interface StagePlacement {
  stage: ProcessStage
  of: number
}

export function placeRound(
  round: InterviewRound,
  rounds: InterviewRound[],
  map: ProcessMap,
): StagePlacement | null {
  const stage = mapRoundToStage(round, rounds, map)
  return stage ? { stage, of: map.stages.length } : null
}

/** The two families whose technical round is code someone reads afterwards. */
const CODING_FAMILIES = new Set<RoleFamily>(['software engineering', 'data science / ML'])

/**
 * Which box the candidate answers in — decided here, never by the model, because getting it
 * wrong is invisible on screen and expensive in the moment. A stage is a coding round only
 * when it is technical AND the role is one that codes: the three real runs settle it, with
 * Stripe's four technical stages coding and its System & API Design stage not, while Vercel's
 * portfolio review and TRM's case stage stay conversations however technical they sound.
 * `kind` is the mapped stage's kind when the round is on the loop and the round's own type
 * when it is not, which is why it takes either.
 */
export function practiceMode(kind: StageKind | RoundType, family: RoleFamily): PracticeMode {
  if (kind === 'system-design') return 'design'
  if (kind === 'technical' && CODING_FAMILIES.has(family)) return 'coding'
  return 'conversation'
}

/** One question a guide reported, with the source that reported it attached. */
export interface ReportedQuestion {
  sourceId: string
  host: string
  url: string
  text: string
  /** Undefined for a guide digested before the flag existed — the prompt line then says neither. */
  firstHand?: boolean
  stale: boolean
  /** 'YYYY', when the source's date begins with one — `yearOf` below says why only then. */
  year?: string
}

/**
 * A year, or nothing. The digest asks for an ISO date and Reddit and HN give one, but the
 * schema only asks for a string, so what arrives may be `March 2024` — which `Date.parse`
 * accepts and whose first four characters are `Marc`. A prompt line and a screen may carry a
 * year; they may not carry four characters of a date. So the leading four digits are the only
 * thing read as one, and an undated source has no year: the line says `undated` rather than
 * guessing one.
 */
function yearOf(publishedAt: string | undefined): string | undefined {
  return /^\d{4}/.exec(publishedAt ?? '')?.[0]
}

/**
 * Every question the guides say people were asked, joined to the source that reported it so
 * the brief's citation can be checked and the screen can link to it. Ordered *before* it is
 * deduplicated, deliberately: when two guides report the same question, the copy that
 * survives is the first-hand, un-stale one, and that is the source the brief will cite. The
 * text is whitespace-normalised here because it becomes one line of a prompt, and because
 * every comparison downstream is normalised anyway.
 */
export function reportedQuestions(map: ProcessMap): ReportedQuestion[] {
  const sources = new Map(map.sources.map((s) => [s.id, s]))
  const rows: { question: ReportedQuestion; guide: number; index: number }[] = []
  map.guides.forEach((guide, guideIndex) => {
    // A guide whose source is not in the map has no host and no URL, so there is nothing to
    // cite and nothing to link: it is left out rather than shown as a question from nowhere.
    const source = sources.get(guide.sourceId)
    if (!source) return
    const year = yearOf(source.publishedAt)
    guide.questionsReported.forEach((raw, index) => {
      const text = normalizeWs(raw)
      if (text === '') return
      rows.push({
        question: {
          sourceId: source.id,
          host: source.host,
          url: source.url,
          text,
          ...(guide.firstHand === undefined ? {} : { firstHand: guide.firstHand }),
          stale: guide.stale,
          ...(year ? { year } : {}),
        },
        guide: guideIndex,
        index,
      })
    })
  })

  // Somebody's own account outranks a prep site's summary of one; a fresh account outranks an
  // old one; after that the guides keep the order the research ranked them in, and a guide
  // keeps the order it listed its questions in.
  const hand = (row: (typeof rows)[number]) => (row.question.firstHand === true ? 0 : 1)
  const staleness = (row: (typeof rows)[number]) => (row.question.stale ? 1 : 0)
  rows.sort(
    (a, b) =>
      hand(a) - hand(b) || staleness(a) - staleness(b) || a.guide - b.guide || a.index - b.index,
  )

  const seen = new Set<string>()
  const kept: ReportedQuestion[] = []
  for (const row of rows) {
    if (seen.has(row.question.text)) continue
    seen.add(row.question.text)
    kept.push(row.question)
    if (kept.length === REPORTED_CAP) break
  }
  return kept
}

/**
 * The brief's citation guard. A `sourceId` survives only when that source really reported
 * that question, word for word — whitespace-normalised on both sides, because the model's
 * copy of a question wraps where its own line broke and ours wraps where the guide's did.
 * Otherwise the citation is dropped and the question is kept, uncited: the question is still
 * worth preparing, and a citation nobody can check is the one thing the screen may not show.
 * Not a retry — the same discipline as the quote check on a digest. `null` becomes an absent
 * key rather than a stored `undefined`, so the record says what it means.
 */
export function citeReported(
  questions: { q: string; angle: string; sourceId: string | null }[],
  reported: ReportedQuestion[],
): PrepBrief['questionsToPrepare'] {
  const asked = new Map<string, Set<string>>()
  for (const question of reported) {
    const texts = asked.get(question.sourceId) ?? new Set<string>()
    texts.add(normalizeWs(question.text))
    asked.set(question.sourceId, texts)
  }
  return questions.map(({ q, angle, sourceId }) => {
    // Keyed by source, not by text: a question one guide reported does not license a citation
    // onto a different guide that never said it.
    if (sourceId !== null && asked.get(sourceId)?.has(normalizeWs(q))) return { q, angle, sourceId }
    return { q, angle }
  })
}
