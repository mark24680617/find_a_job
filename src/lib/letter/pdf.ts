import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Letterhead } from '@/lib/types'
import {
  headerLines, MAX_PAGES, normalizeLetterText, PAGE, paginate, unsupportedCharacters,
  type Measure, type Unsupported,
} from '@/lib/letter/layout'

/**
 * The letter set on a page. Everything about where a mark goes was decided in `layout.ts`; this
 * module owns the two things that need a real font — how wide a string is, and which characters
 * the font can set at all — and then draws the lines that module placed.
 *
 * Server only: `pdf-lib` embeds the standard Times faces by name, so there is no file to read
 * and no font to ship, but the document it builds is bytes, and bytes are what the route
 * returns. Nothing here is logged — not the letter, not the letterhead, not the character that
 * failed.
 */

export class LetterRenderError extends Error {
  constructor(message: string, readonly detail: { unsupported: Unsupported[]; total: number } | { pages: number }) {
    super(message)
    this.name = 'LetterRenderError'
  }
}

export async function renderLetterPdf(input: { letter: Letterhead; company: string; text: string; dateIso: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const [font, bold] = await Promise.all([
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.TimesRomanBold),
  ])
  const text = normalizeLetterText(input.text)

  // A newline is a break the layout owns rather than a mark the font sets, but the layout owns it
  // in only two of the values below: the address block, which it splits into its lines, and the
  // letter, which it splits into paragraphs and lines. `readLetterhead` now folds newlines out of
  // the other six on the way off the record, and the company name comes off a record whose PATCH
  // validates only that its body is an object — so this is the renderer's own guard, for the
  // company and for any caller that hands it a letterhead that did not come through that read.
  // Folded to a space here it prints as the person meant it; left alone it would pass the check
  // below and then reach the font, which refuses it in an error of its own that the route could
  // only answer with a 500.
  const oneLine = (value: string) => value.replace(/\n/g, ' ')
  const letter: Letterhead = {
    ...input.letter,
    name: oneLine(input.letter.name),
    email: oneLine(input.letter.email),
    phone: oneLine(input.letter.phone),
    location: oneLine(input.letter.location),
    recipient: oneLine(input.letter.recipient),
    recipientTitle: oneLine(input.letter.recipientTitle),
  }
  const company = oneLine(input.company)

  // Every field the page will carry, checked against what the font can set BEFORE anything is
  // drawn, so a refusal names all of them at once and the person fixes them in one pass. The
  // newline joins the set for the two values that may still carry one, because there it is
  // structure the layout reads rather than a character anybody could go and remove.
  const charset = new Set([...font.getCharacterSet(), ...bold.getCharacterSet(), '\n'.codePointAt(0) as number])
  // The keys are `FIELD_WHERE`'s — the seven letterhead fields and the company — except `letter`,
  // which is deliberately not one: a character in the letter itself is reported with a span of
  // the paragraph around it, because "in the letter" would leave the person hunting for it.
  const unsupported = unsupportedCharacters(
    {
      name: letter.name, email: letter.email, phone: letter.phone, location: letter.location,
      recipient: letter.recipient, recipientTitle: letter.recipientTitle,
      companyAddress: letter.companyAddress, company, letter: text,
    },
    charset,
  )
  if (unsupported.total > 0) {
    throw new LetterRenderError('the font cannot set every character', {
      unsupported: unsupported.chars,
      total: unsupported.total,
    })
  }

  const measure: Measure = (s, size, b) => (b ? bold : font).widthOfTextAtSize(s, size)
  const pages = paginate(headerLines(letter, company, input.dateIso), text, measure)
  if (pages.length > MAX_PAGES) throw new LetterRenderError('the letter is too long', { pages: pages.length })

  for (const lines of pages) {
    const page = doc.addPage([PAGE.width, PAGE.height])
    for (const line of lines) {
      page.drawText(line.text, {
        x: line.x, y: line.y, size: line.size, font: line.bold ? bold : font, color: rgb(0, 0, 0),
      })
    }
  }
  return doc.save()
}
