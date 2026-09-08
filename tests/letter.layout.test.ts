import { describe, it, expect } from 'vitest'
import {
  BODY_SIZE, formatLetterDate, headerLines, isIsoDate, LINE_HEIGHT, MAX_PAGES, NAME_SIZE,
  normalizeLetterText, PAGE, paginate, paragraphs, unsupportedCharacters, UNSUPPORTED_SHOWN, wrap,
  type Measure,
} from '@/lib/letter/layout'
import { blankLetterhead } from '@/lib/letter/letterhead'

const measure: Measure = (text, size, bold) => text.length * (bold ? 8 : 6) * (size / BODY_SIZE)
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

describe('normalizeLetterText', () => {
  it('normalises line ends, spaces and controls, and keeps what WinAnsi can set', () => {
    // The tab and the thin space become spaces; the bell and the zero-width space are
    // stripped where they stand, so the letters either side of them close up.
    expect(normalizeLetterText('a\r\nb\rc\u2028d\te\u2009f\u0007g\u200bh\n\n\n\ni')).toBe('a\nb\nc\nd e fgh\n\ni')
    expect(normalizeLetterText('“curly” – dash — em nbsp')).toBe('“curly” – dash — em nbsp')
  })
  it('strips the invisibles a paste carries in, byte-order mark and word joiner alike', () => {
    // Neither can be seen in the box or deleted by eye, and neither is WinAnsi: left in, they
    // would be refused at export as a character the person cannot find.
    expect(normalizeLetterText('﻿Dear Dana,⁠')).toBe('Dear Dana,')
  })
})

describe('paragraphs', () => {
  it('splits on blank lines and keeps the lines inside a paragraph', () => {
    expect(paragraphs('Dear Dana Wu,\n\nFirst.\nSecond line.\n\nSincerely,\n\nTom')).toEqual([
      ['Dear Dana Wu,'], ['First.', 'Second line.'], ['Sincerely,'], ['Tom'],
    ])
  })
})

describe('wrap', () => {
  it('breaks at spaces so no line exceeds the width', () => {
    const lines = wrap('one two three four five', measure, BODY_SIZE, false, 60)   // 10 chars fit
    expect(lines).toEqual(['one two', 'three four', 'five'])
  })
  it('breaks a token wider than the column by character rather than looping', () => {
    expect(wrap('abcdefghijklmnop', measure, BODY_SIZE, false, 60)).toEqual(['abcdefghij', 'klmnop'])
  })
  it('keeps an empty line empty', () => {
    expect(wrap('', measure, BODY_SIZE, false, 60)).toEqual([''])
  })
})

describe('headerLines', () => {
  it('joins what is present and always names the company', () => {
    const h = headerLines({ ...blankLetterhead('Tom Candidate', 'tom@x.test'), phone: '555 0100', recipient: 'Dana Wu', recipientTitle: 'Head of Engineering', companyAddress: '1 Main St\nSeattle, WA' }, 'Marram Systems', '2026-09-07')
    expect(h).toEqual({ name: 'Tom Candidate', contact: 'tom@x.test · 555 0100', date: 'September 7, 2026', recipient: ['Dana Wu', 'Head of Engineering', 'Marram Systems', '1 Main St', 'Seattle, WA'] })
    expect(headerLines(blankLetterhead(), 'Marram Systems', '2026-09-07').recipient).toEqual(['Marram Systems'])
    expect(headerLines(blankLetterhead(), 'Marram Systems', '2026-09-07').contact).toBe('')
  })
})

describe('the date', () => {
  it('prints the day it was given, whatever the zone', () => {
    expect(formatLetterDate('2026-09-07')).toBe('September 7, 2026')
    expect(formatLetterDate('2026-01-01')).toBe('January 1, 2026')
  })
  it('accepts only a real YYYY-MM-DD', () => {
    expect(isIsoDate('2026-09-07')).toBe(true)
    expect(isIsoDate('2026-02-31')).toBe(false)
    expect(isIsoDate('2026-9-7')).toBe(false)
    expect(isIsoDate('September 7, 2026')).toBe(false)
  })
})

describe('unsupportedCharacters', () => {
  const charset = new Set(Array.from({ length: 128 }, (_, i) => i))   // ASCII only, for the test
  it('names each character once and says where it sits', () => {
    const out = unsupportedCharacters({ name: '邱明', letter: 'Dear Hiring Manager,\n\nI worked at 邱 for years — long ones.' }, charset)
    expect(out.chars.map((u) => u.char)).toEqual(['邱', '明', '—'])
    expect(out.total).toBe(3)
    expect(out.chars[0].where).toBe('in your name')
    expect(out.chars[2].where).toMatch(/^in “.*— long ones\.”$/)
  })
  it('folds a paragraph’s own line breaks into the span it quotes', () => {
    // A paragraph is what sits between blank lines, so it may be several hard-wrapped lines, and
    // the span is read inside one sentence on the pane.
    const out = unsupportedCharacters(
      { letter: 'Line one is here and quite long indeed\nLine two has 邱 in it right here now' },
      charset,
    )
    expect(out.chars).toHaveLength(1)
    expect(out.chars[0].where).not.toContain('\n')
  })
  it('names a handful at most, and still counts them all', () => {
    // A letter in a script the font has none of carries hundreds of distinct characters. Naming
    // every one of them with a span of its own is a refusal that grows with the letter, and the
    // pane reads one sentence per named character out loud.
    const many = Array.from({ length: 30 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join(' ')
    const out = unsupportedCharacters({ letter: many }, charset)
    expect(out.chars).toHaveLength(UNSUPPORTED_SHOWN)
    expect(out.chars[0].char).toBe('一')
    expect(out.total).toBe(30)
  })
  it('is empty when everything is in the set', () => {
    expect(unsupportedCharacters({ name: 'Tom', letter: 'Dear Dana,' }, charset)).toEqual({ chars: [], total: 0 })
  })
})

describe('paginate', () => {
  const header = headerLines(blankLetterhead('Tom Candidate', 'tom@x.test'), 'Marram Systems', '2026-09-07')
  it('sets the header then the paragraphs, top down, inside the margins', () => {
    const [page] = paginate(header, 'Dear Hiring Manager,\n\nOne.\n\nSincerely,\n\nTom Candidate', measure)
    expect(page[0]).toMatchObject({ text: 'Tom Candidate', size: NAME_SIZE, bold: true, x: PAGE.margin })
    expect(page[0].y).toBeLessThan(PAGE.height - PAGE.margin)
    expect(page.map((l) => l.text)).toEqual(['Tom Candidate', 'tom@x.test', 'September 7, 2026', 'Marram Systems', 'Dear Hiring Manager,', 'One.', 'Sincerely,', 'Tom Candidate'])
    const ys = page.map((l) => l.y)
    expect([...ys].sort((a, b) => b - a)).toEqual(ys)                          // strictly descending
    expect(ys.at(-1)).toBeGreaterThanOrEqual(PAGE.margin)
  })
  it('starts a new page when the next line would cross the bottom margin', () => {
    const pages = paginate(header, words(900), measure)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) for (const l of p) expect(l.y).toBeGreaterThanOrEqual(PAGE.margin)
    expect(pages[1][0].y).toBeCloseTo(PAGE.height - PAGE.margin - LINE_HEIGHT, 5)
  })
  it('wraps a name too wide for the column instead of running it off the page', () => {
    const wide = headerLines(
      blankLetterhead('Doctor Alexandra Fitzwilliam Hastings the Third Esquire', 'tom@x.test'),
      'Marram Systems', '2026-09-07',
    )
    const [page] = paginate(wide, 'Dear Hiring Manager,', measure)
    const name = page.filter((l) => l.size === NAME_SIZE)
    expect(name).toHaveLength(2)
    for (const l of name) expect(measure(l.text, NAME_SIZE, true)).toBeLessThanOrEqual(PAGE.width - 2 * PAGE.margin)
  })
  it('a letter under the ceiling is one page', () => {
    expect(paginate(header, `Dear Hiring Manager,\n\n${words(340)}\n\nSincerely,\n\nTom Candidate`, measure)).toHaveLength(1)
    expect(MAX_PAGES).toBe(3)
  })
})
