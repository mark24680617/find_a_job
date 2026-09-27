import { CHECK_IDS, sourceFor, type CheckId } from '@/lib/resume/checkSources'
import { findGaps, monthNumber } from '@/lib/resume/dates'
import { doctrinePhrasesIn } from '@/lib/resume/doctrinePhrases'
import { STANDARD_HEADINGS } from '@/lib/resume/structure' // <!-- R18 -->
import type { CheckResult, StoredResume } from '@/lib/resume/types'
import { normalizeWs } from '@/lib/research/quotes'

/**
 * The deterministic half of Diagnose: one pure function per row of spec §6.1's table, each
 * returning the lines it is about so the page can put the verdict beside the line rather than
 * beside a summary. No model is asked any of this — JEV "reads dates as text, not as ordered
 * quantities" and does not count, and none of these needs a judgement anyway.
 *
 * Two gates run before anything else, and both report `not-run` rather than `pass`, because a
 * check that did not run is not a check that passed:
 *   - `language !== 'en'` stops the whole suite (§6.1, risk 11). The same gate covers the Noul
 *     layer, which the route applies.
 *   - a document with no text layer stops everything but `text-layer` itself: there is nothing
 *     for the rest to read, and §6.1's empty state says so in as many words.
 */

/** Greenhouse's parse ceiling, well under its 100 MB upload ceiling. */
export const PARSE_CEILING_BYTES = 2_500_000

/** Our judgement, and the source row says so. Legibility, not a vendor threshold. */
export const MIN_FONT_PT = 9

/**
 * Set from Task A3's pdfjs spike (amended 2026-09-24, R9). A3 measured fill colour reachable
 * through `getOperatorList()`, and Task B4's extractor reads it: a white-filled run is stored at
 * `size: 0` with `hiddenBy: 'colour'`, so it is out of `text` and out of every model input, and the
 * `hidden-text-colour` row below is keyed on that field. Were it false, the row would be absent
 * from the suite entirely rather than drawn as `not-run` — spec §9.3: "it is dropped from the check
 * table and from the model-input exclusion" — and C11's evidence table would carry
 * `COLOUR_UNDETECTABLE`, the one line saying colour-hidden text cannot be detected on this build.
 * The zero-size half ships either way.
 */
export const COLOUR_HIDDEN_TEXT = true

/**
 * Deferred from v1 (amended 2026-09-24, R9). B4 captures no ToUnicode evidence, so the ligature
 * row is never drawn. The deferral is recorded in docs/notes/deps.md (Task A3 writes the sentence)
 * and is to be recorded in spec §12 item 19 (owner), so the check is seen to be cut rather than
 * forgotten.
 */
export const LIGATURE_CHECK = false

/**
 * Reported, never explained. §6.1 lists the gap check; D4 fixes what may be said about one: state
 * the period, never infer a cause, never advise hiding it. A finding written by a model would be
 * advice, so the route leaves these ids out of the set it hands `resumeFindings`, and the guard
 * that requires a `checkId` to be in that set is what makes the rule structural.
 */
export const NEUTRAL_CHECK_IDS: CheckId[] = ['employment-gap']

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const PHONE = /\+?\d[\d ().-]{7,}\d/g
/** A span of years, which PHONE's character class also matches: `2015-2019` is not a number to call. */
const YEAR_RANGE = /^(?:19|20)\d\d\s*[-–—]\s*(?:19|20)\d\d$/
const SPACED_LETTERS = /(?:\b[A-Za-z]\s){3,}[A-Za-z]\b/
const PLACEHOLDERS = [
  /\[[^\]]{2,40}\]/,          // [Your Name], [City, State]
  /\{\{[^}]{1,40}\}\}/,       // {{firstName}}
  /lorem ipsum/i,
  /\byour name\b/i,
  /\bcompany name\b/i,
  /\bxxx+\b/i,
]
// No heading list of its own (amended 2026-09-24, R18): `section-headings` counts against B3's
// `STANDARD_HEADINGS`, so a heading the structure pass recognises is one this check counts.

/**
 * Our judgement: a band is set off from the body by a gap more than twice the page's ordinary
 * line pitch (the median gap between baselines).
 */
const BAND_GAP = 2
/** Our judgement: a header or footer band is at most three baselines deep; more is body. */
const MAX_BAND_BASELINES = 3
/** Where a second column starts, as a share of the page's own observed horizontal extent. */
const COLUMN_SPLIT = 0.45
/** The least horizontal offset, in points, at which a second run of lines is a column rather than an indent. Our judgement: bullet and hanging indents run to about half an inch; a second column starts well past two. */
const MIN_COLUMN_OFFSET_PT = 144

const linesOn = (resume: StoredResume, page: number): number[] =>
  resume.lines.flatMap((l, i) => (l.page === page ? [i] : []))

/**
 * Indices of the lines that are there and not rendered: every `size: 0` run, and nothing else.
 * B4 stores both sub-visible and white-filled runs there, told apart by `hiddenBy` (R9), and stores
 * any run outside the page's own box at size 0 with `hiddenBy: 'size'`, measured against
 * `page.view`. Size is the one test, as types.ts and the extractor state it (final review,
 * judging-1): the negative-coordinate guard this had read the stored user-space coordinates as
 * if every page box started at 0,0, and on a PDF whose MediaBox or CropBox has a negative origin
 * it classed every visible line hidden. <!-- R9, amended 2026-09-24 -->
 */
export function hiddenLineIndices(resume: StoredResume): number[] {
  const hidden: number[] = []
  resume.lines.forEach((l, i) => {
    if (l.size <= 0) hidden.push(i)
  })
  return hidden
}

/** The geometry row's lines: a sub-visible run, or one off the page box — both `hiddenBy: 'size'`. R9. */
const geometryHidden = (resume: StoredResume): number[] =>
  resume.lines.flatMap((l, i) => (l.hiddenBy === 'size' ? [i] : []))

/** The colour row's lines: a white-filled run, and nothing else. R9. */
const colourHidden = (resume: StoredResume): number[] =>
  resume.lines.flatMap((l, i) => (l.hiddenBy === 'colour' ? [i] : []))

/**
 * The bullets the model may be shown. §8: hidden text is excluded from every model input on this
 * feature, JEV's state and Gemini's parts alike — a bullet sitting on a line the page does not
 * render is exactly where an injected instruction would be written.
 */
export function visibleBullets(resume: StoredResume): StoredResume['bullets'] {
  const hidden = new Set(hiddenLineIndices(resume))
  return resume.bullets.filter((b) => !b.lines.some((i) => hidden.has(i)))
}

/**
 * The resume as the reader sees it: the stored lines minus the ones the page does not render.
 * This, not `StoredResume.text`, is what reaches `resumeFindings` — and therefore what its quote
 * guard checks against, so a quote the page shows is always a span of text the reader can find.
 */
export function visibleText(resume: StoredResume): string {
  const hidden = new Set(hiddenLineIndices(resume))
  return resume.lines.filter((_, i) => !hidden.has(i)).map((l) => l.text).join('\n')
}

const row = (checkId: CheckId, state: CheckResult['state'], lines: number[] = []): CheckResult => ({
  checkId, state, source: sourceFor(checkId), lines,
})

const hasContact = (text: string): boolean =>
  EMAIL.test(text) ||
  [...text.matchAll(PHONE)].some(
    (m) => (m[0].match(/\d/g) ?? []).length >= 7 && !YEAR_RANGE.test(m[0].trim()),
  )

function contactInBand(resume: StoredResume): number[] {
  const page = linesOn(resume, 1).filter((i) => resume.lines[i].size > 0)
  if (page.length < 3) return []
  const ys = [...new Set(page.map((i) => resume.lines[i].y))].sort((a, b) => b - a)
  const gaps = ys.slice(1).map((y, k) => ys[k] - y).sort((a, b) => a - b)
  const pitch = gaps[Math.floor(gaps.length / 2)]
  if (pitch === undefined || pitch <= 0) return []
  // Walk in from an edge while the baselines keep the body's pitch; it is a band only if the walk
  // stops at a wider gap within MAX_BAND_BASELINES. A header line directly above the body, at the
  // body's own spacing, is part of the page rather than a band set apart from it.
  const band = (fromEdge: number[]): number[] => {
    for (let k = 0; k + 1 < fromEdge.length && k < MAX_BAND_BASELINES; k += 1) {
      if (Math.abs(fromEdge[k] - fromEdge[k + 1]) > BAND_GAP * pitch) return fromEdge.slice(0, k + 1)
    }
    return []
  }
  // Both extremes, symmetrically: whether the top of the page is the larger or the smaller y is a
  // property of the extractor's transform, and a check that had to know would be a check that
  // silently inverts the day someone changes it.
  const bandYs = new Set([...band(ys), ...band([...ys].reverse())])
  return page.filter((i) => bandYs.has(resume.lines[i].y) && hasContact(resume.lines[i].text))
}

function multiColumn(resume: StoredResume): number[] {
  const pages = [...new Set(resume.lines.map((l) => l.page))]
  for (const page of pages) {
    const idx = linesOn(resume, page)
    if (idx.length < 6) continue
    const xs = idx.map((i) => resume.lines[i].x)
    const left = Math.min(...xs)
    const spanX = Math.max(...xs) - left
    if (spanX <= 0) continue
    const cut = left + Math.max(spanX * COLUMN_SPLIT, MIN_COLUMN_OFFSET_PT)
    const rightIdx = idx.filter((i) => resume.lines[i].x >= cut)
    const leftIdx = idx.filter((i) => resume.lines[i].x < cut)
    if (rightIdx.length < 3 || leftIdx.length < 3) continue
    const ys = (list: number[]) => list.map((i) => resume.lines[i].y)
    const overlap =
      Math.min(Math.max(...ys(leftIdx)), Math.max(...ys(rightIdx))) -
      Math.max(Math.min(...ys(leftIdx)), Math.min(...ys(rightIdx)))
    // Two runs of text side by side over the same vertical stretch is a column; a right-aligned
    // date beside every role is not, which is why three lines a side is the floor.
    if (overlap > 0) return [...leftIdx, ...rightIdx].sort((a, b) => a - b)
  }
  return []
}

const phraseHits = (resume: StoredResume): number[] =>
  resume.lines.flatMap((l, i) => (doctrinePhrasesIn(l.text).length === 0 ? [] : [i]))

/**
 * The line an entry's dates are printed on: the first line whose text includes both the entry's
 * `fromRaw` and its `toRaw`. If there is none, the entry's first bullet line; otherwise none.
 */
function dateLineOf(resume: StoredResume, i: number): number[] {
  const e = resume.entries[i]
  const at = resume.lines.findIndex((l) => l.text.includes(e.fromRaw) && l.text.includes(e.toRaw))
  return at >= 0 ? [at] : e.bulletLines.slice(0, 1)
}

/**
 * The readable starts, in document order, each no later than the one above it. An unreadable start
 * is dropped rather than allowed to split the comparison: [2019, ?, 2021] is out of order and
 * fails (final review, acceptance-1). With an unreadable start and fewer than two readable ones
 * left there is nothing to compare, so the row is `not-run`, not `pass`.
 */
function reverseChronological(entries: StoredResume['entries']): CheckResult['state'] {
  const starts = entries.map((e) => (e.from === null ? null : monthNumber(e.from, 'from')))
  const readable = starts.filter((s): s is number => s !== null)
  if (readable.length < starts.length && readable.length < 2) return 'not-run'
  return readable.every((s, i) => i === 0 || readable[i - 1] >= s) ? 'pass' : 'fail'
}

/**
 * The whole suite, in `CHECK_IDS` order. The bullet rows are not here: those are the Noul layer's,
 * and `runChecks` is the half that needs no judge at all.
 */
export function runChecks(resume: StoredResume): CheckResult[] {
  const ids = CHECK_IDS.filter((id) => {
    if (id.startsWith('bullet-')) return false
    if (id === 'hidden-text-colour') return COLOUR_HIDDEN_TEXT
    if (id === 'ligature-damage') return LIGATURE_CHECK
    return true
  })

  if (resume.language !== 'en') return ids.map((id) => row(id, 'not-run'))

  const hasText = normalizeWs(resume.text) !== ''
  if (!hasText) {
    return ids.map((id) => (id === 'text-layer' ? row(id, 'fail') : row(id, 'not-run')))
  }

  const tiny = resume.lines.flatMap((l, i) => (l.size > 0 && l.size < MIN_FONT_PT ? [i] : []))
  const spaced = resume.lines.flatMap((l, i) => (SPACED_LETTERS.test(l.text) ? [i] : []))
  const residue = resume.lines.flatMap((l, i) => (PLACEHOLDERS.some((p) => p.test(l.text)) ? [i] : []))
  const headings = resume.sections.filter((s) =>
    STANDARD_HEADINGS.includes(normalizeWs(s.name).toLowerCase()),
  ).length
  const unreadable = resume.entries.flatMap((e, i) => (e.from === null || e.to === null ? [i] : []))
  // null: the search refused (an unreadable or self-contradicting range), which is `not-run` —
  // a check that did not run is not a check that passed (final review, acceptance-1).
  const gaps = findGaps(resume.entries)
  const gapLines = gaps !== null && gaps.length > 0 ? resume.entries.flatMap((e) => e.bulletLines) : []
  const contact = contactInBand(resume)
  const columns = multiColumn(resume)
  const phrases = phraseHits(resume)

  const fired = (id: CheckId, lines: number[]): CheckResult =>
    row(id, lines.length > 0 ? 'fail' : 'pass', lines)

  const byId: Record<string, CheckResult> = {
    'text-layer': row('text-layer', 'pass'),
    'file-size': row('file-size', resume.bytes > PARSE_CEILING_BYTES ? 'fail' : 'pass'),
    'contact-in-header': fired('contact-in-header', contact),
    'multi-column': fired('multi-column', columns),
    'section-headings': row('section-headings', headings >= 2 ? 'pass' : 'fail'),
    // The verdict is the condition's, not the pointer's: an entry with no bullets still fails.
    'dates-parseable': row(
      'dates-parseable',
      unreadable.length > 0 ? 'fail' : 'pass',
      unreadable.flatMap((i) => dateLineOf(resume, i)),
    ),
    'dates-reverse-chronological': row('dates-reverse-chronological', reverseChronological(resume.entries)),
    'employment-gap': row('employment-gap', gaps === null ? 'not-run' : gaps.length > 0 ? 'fail' : 'pass', gapLines),
    'spaced-letters': fired('spaced-letters', spaced),
    'font-size': fired('font-size', tiny),
    'placeholder-residue': fired('placeholder-residue', residue),
    'self-description': fired('self-description', phrases),
    // Two rows, two subsets, told apart by `hiddenBy` (R9).
    'hidden-text-geometry': fired('hidden-text-geometry', geometryHidden(resume)),
    'hidden-text-colour': fired('hidden-text-colour', colourHidden(resume)),
    // Never reached while LIGATURE_CHECK is false: the filter above drops the row (R9).
    'ligature-damage': row('ligature-damage', 'not-run'),
  }

  return ids.map((id) => byId[id])
}
