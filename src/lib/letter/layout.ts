import type { Letterhead } from '@/lib/types'

/**
 * Where every mark of the letter sits on the page, worked out without a PDF library.
 *
 * pdf-lib draws text and can wrap it at a width, but it reports no line count, so it cannot say
 * when a letter has run past the bottom of the page. The wrapping and the pagination are
 * therefore ours, and the measuring is injected: this module never imports a font, which is what
 * lets the pane preview the same header the renderer prints and lets the whole layout be read in
 * a test with a fake measure rather than inferred from bytes.
 *
 * Positions are pdf-lib's own: the origin is the page's bottom-left corner, `y` is a baseline,
 * and everything here sits flush left at the margin. Nothing is drawn in a header or footer
 * region, and nothing is centred — a business letter is a column of text, and the one visual
 * decision in it is where the paragraphs break.
 */

/** US Letter at 72 dpi, one inch on every side. */
export const PAGE = { width: 612, height: 792, margin: 72 } as const
export const BODY_SIZE = 11
export const NAME_SIZE = 14
export const LINE_HEIGHT = 13.2
export const NAME_LINE_HEIGHT = 17
export const PARAGRAPH_GAP = 11

/**
 * The backstop for a final somebody pasted rather than drafted. A letter under the flow's word
 * ceiling is one page by construction — at 11 pt Times with these margins a page holds roughly
 * 600 words after the header — so this refuses a document that was never a cover letter.
 */
export const MAX_PAGES = 3

/** The longest final the PDF route will set. The finalize route stores a final of any length. */
export const MAX_LETTER_CHARS = 20_000

/** How wide a string is, in points, in the font the renderer will actually draw it with. */
export type Measure = (text: string, size: number, bold: boolean) => number

/** One line placed on a page. `y` is its baseline, measured from the page's bottom. */
export interface Line { text: string; size: number; bold: boolean; x: number; y: number }
export type Page = Line[]

export interface HeaderLines { name: string; contact: string; date: string; recipient: string[] }
export interface Unsupported { char: string; where: string }
/** The characters a refusal names, and how many it found in all. */
export interface UnsupportedReport { chars: Unsupported[]; total: number }

/**
 * The field names `unsupportedCharacters` reports. They are read aloud in a sentence on the
 * pane — "The PDF font can’t set “邱” (in your name)" — so they are phrases, not keys.
 */
export const FIELD_WHERE: Record<keyof Letterhead | 'company', string> = {
  name: 'in your name', email: 'in the email', phone: 'in the phone', location: 'in the location',
  recipient: 'in the recipient', recipientTitle: 'in their title',
  companyAddress: 'in the company address', company: 'in the company name',
}

// What a paste can carry into a letter that the page cannot set: line separators that are not
// newlines, spaces that are not the space character, and the invisible run around the
// zero-width space — the byte-order mark a file or a rich editor puts at the head of the text
// and the word joiner among them — which would measure as nothing and print as nothing but
// count as a character. The curly quotes, the dashes and the non-breaking space are all WinAnsi,
// so they pass through: they are what a person actually typed.
const LINE_SEPARATORS = /[\u2028\u2029]/g
const ODD_SPACES = /[\t\u2007\u2009\u202f]/g
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2060\ufeff]/g

export function normalizeLetterText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(LINE_SEPARATORS, '\n')
    .replace(ODD_SPACES, ' ')
    .replace(INVISIBLE, '')
    // Three blank lines and two say the same thing to a reader; to the layout they are a gap
    // of unbounded size in the middle of a one-page document.
    .replace(/\n{3,}/g, '\n\n')
}

/** Paragraphs split on blank lines; each a list of its own lines. */
export function paragraphs(text: string): string[][] {
  return text.trim().split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trimEnd()))
}

/**
 * Word-wrap one line to `maxWidth` by the injected measure. A token wider than the column on its
 * own — a URL, a long hyphenless name — is broken by character, so the loop always advances;
 * left whole it would fit nowhere and the wrap would never end.
 */
export function wrap(line: string, measure: Measure, size: number, bold: boolean, maxWidth: number): string[] {
  const fits = (s: string) => measure(s, size, bold) <= maxWidth
  const out: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    const next = current ? `${current} ${word}` : word
    if (fits(next)) { current = next; continue }
    if (current) out.push(current)
    let piece = ''
    for (const ch of word) {
      if (fits(piece + ch)) piece += ch
      else { out.push(piece); piece = ch }
    }
    current = piece
  }
  out.push(current)
  return out
}

/**
 * The header as it prints. Every blank is a line omitted rather than a line guessed, so a
 * letterhead with nothing but a name prints nothing but a name. The recipient block is the one
 * part that is never empty: the company is always known, and a letter addressed to nobody at
 * all is the one thing this document must not be.
 */
export function headerLines(letter: Letterhead, company: string, dateIso: string): HeaderLines {
  const present = (values: string[]) => values.map((v) => v.trim()).filter(Boolean)
  return {
    name: letter.name.trim(),
    contact: present([letter.email, letter.location, letter.phone]).join(' · '),
    date: formatLetterDate(dateIso),
    recipient: present([letter.recipient, letter.recipientTitle, company, ...letter.companyAddress.split('\n')]),
  }
}

/**
 * `September 7, 2026`. Formatted at midnight UTC and read back in UTC, so the day printed is the
 * day the client asked for rather than the day it is where the server happens to run.
 */
export function formatLetterDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

/** A `YYYY-MM-DD` that round-trips through a Date, so a well-shaped `2026-02-31` is refused. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const date = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s
}

/** How much of a paragraph is quoted back when a character in it cannot be set. */
const SPAN = 40

function excerpt(chars: string[], at: number): string {
  // A paragraph is what sits between blank lines, so it may be several hard-wrapped lines and the
  // window can straddle one. The span is quoted inside a single sentence on the pane, so its own
  // line breaks are folded to spaces rather than breaking the sentence that carries it.
  const flatten = (part: string[]) => part.join('').replace(/\s+/g, ' ').trim()
  if (chars.length <= SPAN) return flatten(chars)
  const start = Math.max(0, Math.min(at - Math.floor(SPAN / 2), chars.length - SPAN))
  return flatten(chars.slice(start, start + SPAN))
}

/**
 * How many characters a refusal names. The letter itself is what makes this a cap rather than a
 * list: a letter written in Chinese carries several hundred distinct characters, and each one
 * named with a span of the paragraph around it is a refusal that grows with the letter — read out
 * on the pane as a sentence per character. Five is enough to see what kind of problem it is.
 */
export const UNSUPPORTED_SHOWN = 5

/**
 * The characters of every field the font cannot set, with where each sits: a field name for the
 * letterhead, and for the letter itself a span of the paragraph around it, so the person can
 * find the character rather than hunt for it. Each distinct character counts once — a name
 * written in Chinese is two problems, not two hundred — and only the first few are described,
 * while `total` still says how many there are.
 */
export function unsupportedCharacters(fields: Record<string, string>, charset: Set<number>): UnsupportedReport {
  const chars: Unsupported[] = []
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(fields)) {
    const field = (FIELD_WHERE as Record<string, string | undefined>)[key]
    for (const block of value.split(/\n\s*\n/)) {
      const blockChars = Array.from(block)
      blockChars.forEach((char, at) => {
        if (charset.has(char.codePointAt(0) ?? 0) || seen.has(char)) return
        seen.add(char)
        // Counted whichever side of the cap it falls, so the sentence the person reads is true;
        // the excerpt is the expensive half, and past the cap it is not built at all.
        if (chars.length < UNSUPPORTED_SHOWN) {
          chars.push({ char, where: field ?? `in “${excerpt(blockChars, at)}”` })
        }
      })
    }
  }
  return { chars, total: seen.size }
}

/**
 * The header and then the letter, line by line, onto as many pages as it takes. Throws nothing:
 * a letter that runs long is a fact the caller decides what to do about, and the only way to
 * learn it is to lay the whole thing out.
 */
export function paginate(header: HeaderLines, text: string, measure: Measure): Page[] {
  const maxWidth = PAGE.width - 2 * PAGE.margin
  const top = PAGE.height - PAGE.margin
  const pages: Page[] = [[]]
  let y = top

  const place = (t: string, size: number, bold: boolean, advance: number) => {
    if (y - advance < PAGE.margin) { pages.push([]); y = top }
    y -= advance
    pages[pages.length - 1].push({ text: t, size, bold, x: PAGE.margin, y })
  }
  const body = (t: string) => {
    for (const line of wrap(t, measure, BODY_SIZE, false, maxWidth)) place(line, BODY_SIZE, false, LINE_HEIGHT)
  }
  const gap = () => { y -= PARAGRAPH_GAP }

  // The name wraps like every other line: a letterhead field holds two hundred characters, and
  // about sixty of them fit across the column at this size, so a name pasted with credentials
  // after it would otherwise run off the right edge and be clipped by the page.
  if (header.name) {
    for (const line of wrap(header.name, measure, NAME_SIZE, true, maxWidth)) place(line, NAME_SIZE, true, NAME_LINE_HEIGHT)
  }
  if (header.contact) body(header.contact)
  if (header.name || header.contact) gap()
  body(header.date)
  gap()
  for (const line of header.recipient) body(line)
  gap()
  paragraphs(normalizeLetterText(text)).forEach((lines, i) => {
    if (i > 0) gap()
    for (const line of lines) body(line)
  })
  return pages
}
