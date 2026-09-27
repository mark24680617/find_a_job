import type { StoredResume } from '@/lib/resume/types'

/**
 * Dates as a resume writes them, read without guessing. Every side comes back `YYYY-MM` when a
 * month is readable, `YYYY` when only a year is, and `null` when it is neither — D4's rule, and
 * the reason the check table has a `dates-parseable` row at all: an unread date is reported as
 * unread, never filled in from the one beside it.
 *
 * `today` is passed in, never read here (the `todayPart` convention, src/ai/prompts/answerDraft.ts:124).
 *
 * This grammar must read every form structure.ts's DATE_TOKEN admits, since that pass is what
 * hands it the raw sides.
 */

/** The longest run with no entry covering it that the product says nothing about. */
export const GAP_MONTHS = 6

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** Present, and its synonyms. Only ever read on the `to` side: a role cannot start at "now". */
const NOW_WORDS = ['present', 'current', 'currently', 'now', 'to date', 'ongoing', '至今', '现在']

/**
 * The dashes a resume separates a range with, including the two CJK ones. An unspaced ASCII hyphen
 * splits only between two bare years (`2020-2022`), anchored at both ends, because `2020-03` is a
 * month and not a range. <!-- R3 (C-2), amended 2026-09-24 -->
 */
const RANGE_SPLIT = /(?<=^\d{4})\s*-\s*(?=\d{4}$)|\s*[–—−~－]\s*|\s+-\s+|\s+to\s+|\s*至(?!今)\s*|\s*(?=至今$)/i

const pad = (m: number): string => String(m).padStart(2, '0')

/** `YYYY-MM` from a year and a 1-based month, or `YYYY` when the month was never read. */
const stamp = (year: number, month: number | null): string =>
  month === null ? String(year) : `${year}-${pad(month)}`

/**
 * A two-digit year, resolved against the caller's clock rather than a fixed pivot: `19` is 2019
 * on a resume read in 2026 and 1919 on none of them, and a hard-coded century would age.
 */
function fullYear(raw: string, today: string): number | null {
  const n = Number(raw)
  if (!Number.isInteger(n)) return null
  if (raw.length === 4) return n >= 1900 && n <= 2999 ? n : null
  if (raw.length !== 2) return null
  const thisYear = Number(today.slice(0, 4))
  const candidate = 2000 + n
  return candidate <= thisYear ? candidate : 1900 + n
}

function monthFromName(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '')
  const i = MONTHS.findIndex((m) => m === w || m.slice(0, 3) === w || (w === 'sept' && m === 'september'))
  return i === -1 ? null : i + 1
}

/**
 * One side of a range. Ordered most specific first, because `2020年3月` and `03/19` both contain
 * digits a looser pattern would happily misread.
 */
function parseSide(raw: string, today: string, side: 'from' | 'to'): string | null {
  const text = raw.trim()
  if (text === '') return null

  const lower = text.toLowerCase()
  if (NOW_WORDS.some((w) => lower === w || lower.startsWith(`${w} `))) {
    // "Present" says when a role ends, and nothing about when one began.
    return side === 'to' ? today.slice(0, 7) : null
  }

  // 2020年3月 / 2020年3
  const cn = /^(\d{4})\s*年\s*(\d{1,2})\s*月?$/.exec(text)
  if (cn) {
    const month = Number(cn[2])
    return month >= 1 && month <= 12 ? stamp(Number(cn[1]), month) : null
  }

  // 2020-03, 2020/03
  const iso = /^(\d{4})[-/](\d{1,2})$/.exec(text)
  if (iso) {
    const month = Number(iso[2])
    return month >= 1 && month <= 12 ? stamp(Number(iso[1]), month) : null
  }

  // 03/19, 03-2019, 03.2019
  const slash = /^(\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text)
  if (slash) {
    const month = Number(slash[1])
    const year = fullYear(slash[2], today)
    return month >= 1 && month <= 12 && year !== null ? stamp(year, month) : null
  }

  // Jan 2020, January 2020, Jan. 2020 — and Summer 2021, whose month is not ours to invent.
  const worded = /^([A-Za-z.]+)\s+(\d{4})$/.exec(text)
  if (worded) {
    const year = fullYear(worded[2], today)
    if (year === null) return null
    return stamp(year, monthFromName(worded[1]))
  }

  // A bare year.
  if (/^\d{4}$/.test(text)) {
    const year = fullYear(text, today)
    return year === null ? null : stamp(year, null)
  }

  return null
}

/**
 * The two sides of one entry's dates. When the structure pass could only isolate one string —
 * `Jan 2020 – Present` as it stands on the page — it arrives whole on the `from` side and is
 * split here, so the caller never has to know which of the two shapes it holds.
 */
export function parseDateRange(
  fromRaw: string,
  toRaw: string,
  today: string,
): { from: string | null; to: string | null } {
  let left = fromRaw
  let right = toRaw
  if (right.trim() === '') {
    const parts = left.split(RANGE_SPLIT)
    if (parts.length === 2) {
      left = parts[0]
      right = parts[1]
    }
  }
  return { from: parseSide(left, today, 'from'), to: parseSide(right, today, 'to') }
}

/**
 * A `YYYY` or `YYYY-MM` as a month ordinal, for arithmetic. A bare year widens to January on the
 * start of a span and to December on its end — both directions lengthen the employment and
 * therefore shorten, never invent, a gap.
 */
export function monthNumber(part: string, edge: 'from' | 'to'): number | null {
  const iso = /^(\d{4})-(\d{2})$/.exec(part)
  if (iso) return Number(iso[1]) * 12 + Number(iso[2])
  if (/^\d{4}$/.test(part)) return Number(part) * 12 + (edge === 'from' ? 1 : 12)
  return null
}

const monthString = (n: number): string => {
  const month = ((n - 1) % 12) + 1
  return `${Math.floor((n - 1) / 12)}-${pad(month)}`
}

/** A period with no entry covering it. No cause, no advice — D4's neutral report. */
export interface EmploymentGap {
  from: string
  to: string
  months: number
}

/**
 * The runs with no entry over them, longer than GAP_MONTHS — or `null` when the search refused to
 * run, which is not the same answer as "no gaps" (final review, acceptance-1): `runChecks` draws
 * the gap row `not-run` on null rather than `pass`.
 *
 * Three refusals are the whole of this function's honesty. One entry with a date that could not be
 * read stops the search outright: a gap computed over a partial set is a claim about a period the
 * unreadable entry may well cover, and D4 forbids inferring one. A range that ends before it begins
 * stops it the same way: it contradicts itself, and reordering it would infer what the author
 * meant. And nothing after the last entry is ever reported — that run is the candidate's present,
 * which is theirs to explain and not ours to notice.
 */
export function findGaps(entries: StoredResume['entries']): EmploymentGap[] | null {
  const spans: { start: number; end: number }[] = []
  for (const entry of entries) {
    if (entry.from === null || entry.to === null) return null
    const start = monthNumber(entry.from, 'from')
    const end = monthNumber(entry.to, 'to')
    if (start === null || end === null) return null
    if (start > end) return null
    spans.push({ start, end })
  }
  spans.sort((a, b) => a.start - b.start)

  const gaps: EmploymentGap[] = []
  let reach = spans.length > 0 ? spans[0].end : 0
  for (let i = 1; i < spans.length; i += 1) {
    const span = spans[i]
    const months = span.start - reach - 1
    if (months > GAP_MONTHS) {
      gaps.push({ from: monthString(reach + 1), to: monthString(span.start - 1), months })
    }
    reach = Math.max(reach, span.end)
  }
  return gaps
}
