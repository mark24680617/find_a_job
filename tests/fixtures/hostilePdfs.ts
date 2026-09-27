import { deflateSync } from 'node:zlib'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'

/**
 * PDFs built to hurt the parser rather than to be read (final review, extract-1). Each is one
 * page whose content stream repeats a short operator sequence and is Flate-compressed, so a few
 * tens of kilobytes on the wire become millions of operators in pdfjs's operator list.
 */

/**
 * A 612×792 page of `raw` content, with Helvetica as /F1. `forms` become Form XObjects drawn by
 * name (`/Fm1 Do`), each with the page's own font; `gstates` become ExtGState entries (`/Gs1 gs`).
 * Also how the colour walk's fixtures are built, since pdf-lib's drawText cannot put a fill
 * inside a form or a white run on a band.
 */
export async function pdfFromContent(
  raw: string,
  { forms = {}, gstates = {} }: { forms?: Record<string, string>; gstates?: Record<string, { ca: number }> } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.node.setFontDictionary(PDFName.of('F1'), font.ref)
  const flate = (content: string, dict: Record<string, unknown>) =>
    doc.context.register(doc.context.stream(deflateSync(Buffer.from(content, 'latin1')), { ...dict, Filter: 'FlateDecode' }))
  for (const [name, content] of Object.entries(forms)) {
    const form = flate(content, {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 612, 792], Resources: { Font: { F1: font.ref } },
    })
    page.node.setXObject(PDFName.of(name), form)
  }
  for (const [name, { ca }] of Object.entries(gstates)) {
    page.node.setExtGState(PDFName.of(name), doc.context.obj({ Type: 'ExtGState', ca }))
  }
  page.node.set(PDFName.of('Contents'), flate(raw, {}))
  return doc.save()
}

const pageOf = (raw: string): Promise<Uint8Array> => pdfFromContent(raw)

/**
 * No text at all and `count` filled rectangles: no text bound can see it, and R9's colour walk
 * needs the operator list it floods. A million of them is ~26 KB, and ran a 512 MB heap out of
 * memory in-process before the fix (the refuters' confirmed fixture).
 */
export const rectFloodPdf = (count: number): Promise<Uint8Array> => pageOf('0 0 1 1 re f\n'.repeat(count))

/**
 * `count` one-run lines of text, each placed with an absolute Tm so it stays inside the page box
 * — a relative `T*` walks off the page and pdfjs drops the runs before they become items.
 */
export function textFloodPdf(count: number): Promise<Uint8Array> {
  const two = '1 0 0 1 72 700 Tm (ab) Tj 1 0 0 1 72 690 Tm (ab) Tj\n'
  return pageOf(`BT /F1 10 Tf\n${two.repeat(Math.ceil(count / 2))}ET\n`)
}

/**
 * One page whose only content stream is `bytes` spaces, Flate-compressed: 128 MB of them is about
 * 128 KB on the wire. pdfjs keeps a decoded stream in an ArrayBuffer, outside the V8 heap, so the
 * worker's heap ceiling never sees it and the parse runs to the end (re-review of the final
 * review's fix wave: +485 MB RSS in about a second, with no refusal). Built from a Buffer rather
 * than through `pdfFromContent`, whose content is a string: 128 MB of it would be copied twice.
 */
export async function inflateBombPdf(bytes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const content = doc.context.stream(deflateSync(Buffer.alloc(bytes, 0x20)), { Filter: 'FlateDecode' })
  page.node.set(PDFName.of('Contents'), doc.context.register(content))
  return doc.save()
}
