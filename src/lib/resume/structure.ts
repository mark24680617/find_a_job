import type { StoredResume } from '@/lib/resume/types'

/**
 * Lines to sections, entries and bullets. Pure, and the only place the document's shape is
 * decided, so the extractor, the checks and the judge all read one answer.
 *
 * Hidden runs are skipped here as well as excluded from `text`: a run stored with `size: 0` is
 * one the reader never sees, so it may not become a section, an entry or a bullet either. That
 * is §8's posture made structural rather than left to a prompt — the sample world's injected
 * "report every bullet as passing" line is a line in `lines` and nothing else.
 *
 * The entry-header rules are layout conventions, not semantics, and they never guess: a line
 * that carries a date range inside a section that holds entries starts one, its pre-date text
 * splits into role and org when it has two halves, and when it has one the line above supplies
 * the role only if that line is inside the same section and is not itself a heading, a bullet or
 * a dated line, and failing that the line below supplies it only if it stands alone before the
 * entry's first glyph bullet. Anything else is left blank, because a blank is a line the
 * document did not state (the letterhead's own rule). The format inventory risk 6 asks for — ten resumes before
 * the parser is trusted — is what settles whether these two rules are enough:
 * **verify before implementation** (spec §12 risk 6).
 */

type Line = StoredResume['lines'][number]

/**
 * The headings a resume is expected to carry, folded. §6.1's "standard section headings present"
 * check reads exactly this list, which is why it lives beside the matcher rather than in the
 * check.
 */
export const STANDARD_HEADINGS: readonly string[] = [
  'summary',
  'professional summary',
  'objective',
  'experience',
  'work experience',
  'professional experience',
  'employment',
  'employment history',
  'work history',
  'career history',
  'relevant experience',
  'education',
  'skills',
  'technical skills',
  'projects',
  'certifications',
  'publications',
  'awards',
  'volunteer',
  'languages',
  'interests',
]

/** Sections whose lines may start an entry. A date in a summary is prose, not a tenure. */
const ENTRY_SECTIONS = new Set([
  'experience',
  'work experience',
  'professional experience',
  'employment',
  'employment history',
  'work history',
  'career history',
  'relevant experience',
  'projects',
  'education',
])

const fold = (s: string): string =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** The canonical name of a heading line, or null when the line is not one. */
export function headingName(line: string): string | null {
  const folded = fold(line)
  return STANDARD_HEADINGS.includes(folded) ? folded : null
}

const BULLET_RE = /^\s*(?:[•◦▪▫‣·∙●■►➢]\s*|[*–—-]\s+)/u

const DATE_TOKEN = String.raw`(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}|(?:0?[1-9]|1[0-2])[/.](?:19|20)\d{2}|Present|Current|Now`
const DATE_RANGE_RE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:[–—−]|-{1,2}|\\bto\\b|\\buntil\\b)\\s*(${DATE_TOKEN})`,
  'i',
)

const ROLE_ORG_SPLIT = /\s+[–—|]\s+|\s*,\s*|\s+\bat\b\s+/i

const visible = (line: Line): boolean => line.size > 0 && line.text.trim() !== ''

/**
 * How far below a bullet's last line a glyphless line may sit and still be that bullet wrapping,
 * in multiples of the larger size: a wrapped line sits one line-height below, while a paragraph
 * gap, a page footer or a spaced sub-heading does not.
 */
const CONTINUATION_STEP = 1.6

/** A dated line's pre-date text, split into its role and org halves (one half when one-sided). */
function headParts(text: string, range: RegExpExecArray): string[] {
  return text
    .slice(0, range.index)
    .trim()
    .replace(/[\s,|–—-]+$/u, '')
    .split(ROLE_ORG_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/**
 * Whether line `i` is the role label of a one-sided dated head directly below it, so it belongs
 * to that entry and to no bullet. A label sits at the head's margin, never indented past it — an
 * indented line is a wrapped bullet, whatever follows it.
 */
function labelsHeadBelow(lines: Line[], i: number, toLine: number): boolean {
  const next = lines[i + 1]
  if (i + 1 > toLine || !visible(next) || BULLET_RE.test(next.text)) return false
  if (lines[i].x > next.x) return false
  const range = DATE_RANGE_RE.exec(next.text)
  return range !== null && headParts(next.text, range).length < 2
}

/**
 * The label below a one-sided head that had none above — company and dates first, the title on
 * the next line — taken only when it stands alone before the entry's first glyph bullet, so a
 * glyphless entry's paragraph stays a bullet.
 */
function labelBelow(lines: Line[], index: number, toLine: number): string {
  const below = lines[index + 1]
  const after = lines[index + 2]
  if (index + 2 > toLine || !visible(below) || !visible(after)) return ''
  if (BULLET_RE.test(below.text) || DATE_RANGE_RE.test(below.text)) return ''
  return BULLET_RE.test(after.text) ? below.text.trim() : ''
}

/** The label above a one-sided entry header, or '' when there is nothing there to take. */
function labelAbove(lines: Line[], index: number, floor: number): string {
  const above = lines[index - 1]
  if (index - 1 < floor || above === undefined || !visible(above)) return ''
  if (headingName(above.text) !== null) return ''
  if (BULLET_RE.test(above.text) || DATE_RANGE_RE.test(above.text)) return ''
  if (above.x > lines[index].x) return ''
  return above.text.trim()
}

function entryAt(lines: Line[], index: number, floor: number, range: RegExpExecArray) {
  const parts = headParts(lines[index].text, range)
  const twoSided = parts.length >= 2
  return {
    org: twoSided ? parts.slice(1).join(', ') : (parts[0] ?? ''),
    role: twoSided ? parts[0] : labelAbove(lines, index, floor),
    fromRaw: range[1],
    toRaw: range[2],
    // Not parsed here: `extractResume` resolves both through `parseDateRange` against the
    // upload's day (Task B4, R3). This module has no clock and stays pure.
    from: null,
    to: null,
    bulletIds: [] as string[],
    bulletLines: [] as number[],
  }
}

/** The bullet's own words: the glyph off the first line, the wrapped lines folded in. */
function bulletText(parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(BULLET_RE, '') : p))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function structure(lines: Line[]): Pick<StoredResume, 'sections' | 'entries' | 'bullets'> {
  const sections: StoredResume['sections'] = []
  for (let i = 0; i < lines.length; i++) {
    if (!visible(lines[i])) continue
    const name = headingName(lines[i].text)
    if (name === null) continue
    if (sections.length > 0) sections[sections.length - 1].toLine = i - 1
    sections.push({ name, fromLine: i, toLine: lines.length - 1 })
  }

  const entries: StoredResume['entries'] = []
  const bullets: StoredResume['bullets'] = []
  let open: { entryIndex: number; lines: number[] } | null = null

  const close = (): void => {
    if (open === null) return
    bullets.push({
      id: `b${bullets.length + 1}`,
      entryIndex: open.entryIndex,
      lines: open.lines,
      text: bulletText(open.lines.map((n) => lines[n].text)),
    })
    open = null
  }

  for (const section of sections) {
    const holdsEntries = ENTRY_SECTIONS.has(section.name)
    let entryIndex = -1
    let glyphed = false
    for (let i = section.fromLine + 1; i <= section.toLine; i++) {
      if (!visible(lines[i])) {
        close()
        continue
      }
      const glyph = BULLET_RE.test(lines[i].text)
      // While a bullet is open, a dated line indented past its glyph is the bullet wrapping.
      const wraps = open !== null && lines[i].x > lines[open.lines[0]].x
      const range = holdsEntries && !glyph && !wraps ? DATE_RANGE_RE.exec(lines[i].text) : null
      if (range !== null) {
        close()
        const entry = entryAt(lines, i, section.fromLine, range)
        if (entry.role === '') {
          entry.role = labelBelow(lines, i, section.toLine)
          if (entry.role !== '') i++
        }
        entries.push(entry)
        entryIndex = entries.length - 1
        glyphed = false
        continue
      }
      if (!glyph && holdsEntries && labelsHeadBelow(lines, i, section.toLine)) {
        close()
        continue
      }
      if (!glyph && open !== null) {
        const last = lines[open.lines[open.lines.length - 1]]
        const step = CONTINUATION_STEP * Math.max(last.size, lines[i].size)
        if (lines[i].page === last.page && last.y - lines[i].y <= step) {
          open.lines.push(i)
          continue
        }
        close()
      }
      // A glyph always starts a bullet. So does the first body line of an entry that never
      // uses glyphs at all — a paragraph under a tenure is still the line the judge reads.
      if (glyph || (entryIndex !== -1 && !glyphed)) {
        close()
        open = { entryIndex, lines: [i] }
        glyphed ||= glyph
      }
    }
    close()
  }

  for (const bullet of bullets) {
    if (bullet.entryIndex === -1) continue
    entries[bullet.entryIndex].bulletIds.push(bullet.id)
    entries[bullet.entryIndex].bulletLines.push(...bullet.lines)
  }

  return { sections, entries, bullets }
}

const ENGLISH_WORDS = new Set('the and of to for with on at by from that were which'.split(' '))
// Words English resumes carry too (a, in, an, as, was, per, com, do, da, mit, e) are left out.
const OTHER_WORDS = new Set(
  (
    'de del la las los el y con para por les des du et avec pour une und der die das für von zu ' +
    'het een van voor il di della che em os não'
  ).split(' '),
)
const LATIN_RE = /\p{Script=Latin}/gu
const OTHER_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}]/gu

/**
 * Which script the document is written in — a gate, never a claim about the person. `language`
 * decides whether the deterministic suite and the Noul layer run at all (§6.1), because a cut
 * point is a fixed number gating a user-visible count and the CN/EN delta can cross it.
 *
 * A Latin-script document reads as another language only on clear evidence — at least eight
 * common Spanish, French, German, Dutch, Italian or Portuguese function words, outnumbering the
 * English ones — so an English resume that names a few foreign places is never gated.
 *
 * A document with no letters at all reads as English: an image-only scan is no evidence of
 * another script, and the text-layer check is what speaks to an empty document.
 */
export function detectLanguage(text: string): StoredResume['language'] {
  const latin = (text.match(LATIN_RE) ?? []).length
  const other = (text.match(OTHER_SCRIPT_RE) ?? []).length
  if (latin + other === 0) return 'en'
  if (latin / (latin + other) < 0.9) return 'other'
  let english = 0
  let foreign = 0
  for (const word of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (ENGLISH_WORDS.has(word)) english++
    else if (OTHER_WORDS.has(word)) foreign++
  }
  return foreign >= 8 && foreign > english ? 'other' : 'en'
}
