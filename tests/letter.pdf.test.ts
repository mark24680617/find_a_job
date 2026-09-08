import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { LetterRenderError, renderLetterPdf } from '@/lib/letter/pdf'
import { blankLetterhead } from '@/lib/letter/letterhead'
import { UNSUPPORTED_SHOWN } from '@/lib/letter/layout'

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
const letter = { ...blankLetterhead('Tom Candidate', 'tom@example.test'), phone: '555 0100', location: 'Seattle, WA', recipient: 'Dana Wu', recipientTitle: 'Head of Engineering' }
const text = (body: string) => `Dear Dana Wu,\n\n${body}\n\nSincerely,\n\nTom Candidate`

describe('renderLetterPdf', () => {
  it('sets a one-page letter as a PDF with a text layer', async () => {
    const bytes = await renderLetterPdf({ letter, company: 'Marram Systems', text: text(words(300)), dateIso: '2026-09-07' })
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  })
  it('passes curly quotes and dashes, which the standard font has', async () => {
    await expect(renderLetterPdf({ letter, company: 'Marram Systems', text: text('I’m “sure” – so – is she — and Zoë.'), dateIso: '2026-09-07' })).resolves.toBeInstanceOf(Uint8Array)
  })
  it('refuses a character the font cannot set, naming it and where, before drawing anything', async () => {
    const err = await renderLetterPdf({ letter: { ...letter, name: '邱明' }, company: 'Marram Systems', text: text('Ω is not in WinAnsi.'), dateIso: '2026-09-07' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LetterRenderError)
    expect((err as LetterRenderError).detail).toEqual({ unsupported: [
      { char: '邱', where: 'in your name' }, { char: '明', where: 'in your name' }, { char: 'Ω', where: expect.stringMatching(/^in “/) },
    ], total: 3 })
  })

  it('names a handful of them and counts the rest, so the refusal cannot grow with the letter', async () => {
    // A letter written in Chinese is the case the export must not fail badly for: every distinct
    // character quoted with a span of its own would be a megabyte of JSON, and one sentence per
    // character read out as a single alert.
    const many = Array.from({ length: 40 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join(' ')
    const err = await renderLetterPdf({ letter, company: 'Marram Systems', text: text(many), dateIso: '2026-09-07' }).catch((e: unknown) => e)
    const detail = (err as LetterRenderError).detail as { unsupported: unknown[]; total: number }
    expect(detail.unsupported).toHaveLength(UNSUPPORTED_SHOWN)
    expect(detail.total).toBe(40)
  })
  it('sets the line breaks inside an address and a paragraph rather than refusing them', async () => {
    // The newline is not a character the font can set, and every line is drawn on its own, so it
    // must not be reported back as one the person should go and remove.
    const wrapped = { ...letter, companyAddress: '1 Main St\nSeattle, WA 98101' }
    await expect(renderLetterPdf({ letter: wrapped, company: 'Marram Systems', text: text('One.\nTwo.'), dateIso: '2026-09-07' })).resolves.toBeInstanceOf(Uint8Array)
  })
  it('sets a line break in a field the layout never splits as a space rather than failing on it', async () => {
    // Nothing breaks these values into lines, so a newline left in one reaches the font itself,
    // and the font answers with a raw encoding error rather than the refusal the route knows how
    // to turn into an answer. `readLetterhead` folds them out of the six single-line fields on the
    // way off the record, so this is the renderer's own guard — for the company, which does not
    // pass through that read, and for any caller that hands it a letterhead that did not either.
    const pasted = { ...letter, name: 'Tom Candidate\nPhD', recipient: 'Dana Wu\nHiring', location: 'Seattle\nWA' }
    await expect(renderLetterPdf({ letter: pasted, company: 'Marram\nSystems', text: text('One.'), dateIso: '2026-09-07' })).resolves.toBeInstanceOf(Uint8Array)
  })
  it('refuses a letter past three pages', async () => {
    const err = await renderLetterPdf({ letter, company: 'Marram Systems', text: text(words(3000)), dateIso: '2026-09-07' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LetterRenderError)
    expect((err as LetterRenderError).detail).toMatchObject({ pages: expect.any(Number) })
    expect(((err as LetterRenderError).detail as { pages: number }).pages).toBeGreaterThan(3)
  })
})
