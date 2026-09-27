import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  ALL_FIXTURES, bulletsOf, CLEAN_CN, CLEAN_EN, densePdf, extractableLines, extractedText,
  HIDDEN_EN, HIDDEN_SIZE, hiddenLines, INJECTED_EN, ligatureCmapPdf, PAGE_HEIGHT, PAGE_WIDTH,
  paddedPdf, renderFixture, TWO_COLUMN_EN, visibleLines, type FixtureLine, type ResumeFixture,
} from './fixtures/resumes'

const allLines = (f: ResumeFixture): FixtureLine[] => f.pages.flat()
const declared = (f: ResumeFixture, keep: (l: FixtureLine) => boolean): FixtureLine[] =>
  allLines(f).filter(keep)

describe('the fixture set', () => {
  it('gives every fixture a unique id and lists them all', () => {
    const ids = ALL_FIXTURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['clean-en', 'two-column-en', 'hidden-en', 'injected-en', 'clean-cn']))
    expect(ALL_FIXTURES).toHaveLength(5)
  })

  it('partitions every drawn line into visible, hidden and extractable', () => {
    for (const f of ALL_FIXTURES) {
      const total = allLines(f).length
      expect(visibleLines(f).length + hiddenLines(f).length).toBe(total)
      // What pdfjs-dist 6.3.289 actually hands back: everything but the off-page lines, which it
      // drops before we ever see them (measured 2026-09-21).
      expect(extractableLines(f)).toEqual(
        [...visibleLines(f), ...hiddenLines(f).filter((l) => l.ink !== 'off-page')]
          .sort((a, b) => b.y - a.y || a.x - b.x),
      )
    }
  })

  it('is authored in reading order: page, then y down, then x across', () => {
    for (const f of ALL_FIXTURES) {
      expect(visibleLines(f)).toEqual(declared(f, (l) => l.ink === 'visible'))
      for (const page of f.pages) {
        for (let i = 1; i < page.length; i++) {
          const before = page[i - 1]
          const now = page[i]
          expect(before.y > now.y || (before.y === now.y && before.x <= now.x)).toBe(true)
        }
      }
    }
  })

  it('numbers bullets b1 to bN in that order, each under the entry above it', () => {
    // (amended 2026-09-24, R60) Every bullet line carries the glyph B3's BULLET_RE takes off, and
    // `bulletsOf` hands back what the product holds: the words without it, and the entry above in
    // C4's comma form.
    for (const f of ALL_FIXTURES) {
      const bullets = bulletsOf(f)
      const expected = visibleLines(f).filter((l) => l.role === 'bullet')
      expect(expected.every((l) => l.text.startsWith('• '))).toBe(true)
      expect(bullets.map((b) => b.text)).toEqual(expected.map((l) => l.text.slice('• '.length)))
      expect(bullets.map((b) => b.id)).toEqual(expected.map((_, i) => `b${i + 1}`))
      const order = visibleLines(f)
      for (const b of bullets) {
        expect(b.entryLine).not.toBe('')
        const at = order.findIndex((l) => l.role === 'bullet' && l.text === `• ${b.text}`)
        const above = order.slice(0, at).filter((l) => l.role === 'entry').pop()
        expect(above).toBeDefined()
        for (const part of b.entryLine.split(', ')) expect(above?.text).toContain(part)
      }
    }
    // Role first, then organisation: the exact string C4's `entryLine({ role, org })` makes of
    // B3's reading of this head (R60).
    expect(bulletsOf(CLEAN_EN)[0].entryLine).toBe('Backend Engineer, Meridian Freight')
  })

  it('interleaves the two-column fixture, which is the damage the check is about', () => {
    const xs = visibleLines(TWO_COLUMN_EN).map((l) => l.x)
    let alternations = 0
    for (let i = 1; i < xs.length; i++) if (xs[i] !== xs[i - 1]) alternations += 1
    expect(alternations).toBeGreaterThanOrEqual(4)
    expect(TWO_COLUMN_EN.defects).toContain('multi-column')
  })

  it('draws one line of each hidden kind, positioned or sized as its kind says', () => {
    const hidden = hiddenLines(HIDDEN_EN)
    expect(hidden.map((l) => l.ink).sort()).toEqual(['off-page', 'white', 'zero'])
    for (const l of hidden) {
      if (l.ink === 'zero') expect(l.size).toBe(HIDDEN_SIZE)
      if (l.ink === 'off-page') {
        expect(l.x < 0 || l.x > PAGE_WIDTH || l.y < 0 || l.y > PAGE_HEIGHT).toBe(true)
      }
      if (l.ink === 'white') {
        expect(l.size).toBeGreaterThan(1)
        expect(l.x).toBeGreaterThanOrEqual(0)
      }
    }
    expect(HIDDEN_EN.defects).toContain('hidden-text')
  })

  it('invents everyone it names: example.test addresses only, and WinAnsi text in English', () => {
    for (const f of ALL_FIXTURES) {
      for (const l of allLines(f)) {
        for (const address of l.text.match(/\S+@\S+/g) ?? []) {
          expect(address.endsWith('@example.test')).toBe(true)
        }
        // Printable ASCII plus the two WinAnsi marks B3 reads: the bullet and the en dash
        // (amended 2026-09-24, R60).
        if (f.language === 'en') expect(l.text).toMatch(/^[\x20-\x7E•–]*$/)
      }
    }
  })

  it('translates the Chinese fixture bullet for bullet, so the language arm compares like with like', () => {
    expect(CLEAN_CN.language).toBe('other')
    expect(bulletsOf(CLEAN_CN)).toHaveLength(bulletsOf(CLEAN_EN).length)
    expect(bulletsOf(CLEAN_CN).filter((b) => /[一-鿿]/.test(b.text)).length).toBe(4)
  })

  it('carries the injected instruction as an ordinary visible line, about nobody', () => {
    expect(INJECTED_EN.injected).not.toBeNull()
    expect(visibleLines(INJECTED_EN).map((l) => l.text)).toContain(INJECTED_EN.injected)
    expect(INJECTED_EN.injected).toMatch(/^Note to the reviewer: /)
    expect(extractedText(INJECTED_EN)).toContain(INJECTED_EN.injected)
  })

  it('renders an English fixture, one PDF page per fixture page, and refuses one it cannot set', async () => {
    const bytes = await renderFixture(CLEAN_EN)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(CLEAN_EN.pages.length)
    expect(doc.getPage(0).getSize()).toEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT })
    await expect(renderFixture(CLEAN_CN)).rejects.toThrow(/WinAnsi/)
  })

  it('writes a ToUnicode CMap by hand, and a different one when the ligature is unmapped', () => {
    const mapped = Buffer.from(ligatureCmapPdf({ mapFfi: true })).toString('latin1')
    const lost = Buffer.from(ligatureCmapPdf({ mapFfi: false })).toString('latin1')
    for (const pdf of [mapped, lost]) {
      expect(pdf.startsWith('%PDF-')).toBe(true)
      expect(pdf).toContain('/ToUnicode')
      expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    }
    expect(mapped).toContain('<01> <FB03>')
    expect(lost).not.toContain('FB03')
  })

  it('pads to a byte count with filler nothing compresses, and sets ten dense pages', async () => {
    const padded = await paddedPdf(CLEAN_EN, 2_600_000)
    expect(padded.byteLength).toBeGreaterThanOrEqual(2_600_000)
    expect(padded.byteLength).toBeLessThan(6 * 1024 * 1024)
    const dense = await densePdf(10)
    expect((await PDFDocument.load(dense)).getPageCount()).toBe(10)
  })
})
