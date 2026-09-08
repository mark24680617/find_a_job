import { requireUser } from '@/lib/auth'
import { getApplication } from '@/lib/db'
import { isIsoDate, MAX_LETTER_CHARS } from '@/lib/letter/layout'
import { isCoverLetter, LETTERHEAD_FIELD_MAX, readLetterhead } from '@/lib/letter/letterhead'
import { LetterRenderError, renderLetterPdf } from '@/lib/letter/pdf'

// The saved cover letter as a business letter on a US-Letter page. Shaped like the `.ics`
// export: a GET, the token in the header, a file back. Node runtime (the default): `@/lib/db`
// reaches Firestore through firebase-admin, and pdf-lib builds the document in memory.
//
// The date comes from the client because it is the letter's own date, and only the browser
// knows which day it is where the person is sitting: this server's midnight is somebody's
// evening, and a letter dated tomorrow is a letter that reads as written by a machine. It is
// checked here rather than trusted, so what prints is a day that exists.
//
// The content-disposition filename is a constant. The pretty name — the candidate's and the
// company's — is computed on the client and applied there, because a header value outside
// Latin-1 throws in Node, and the one person most likely to have a name outside it is exactly
// the person this export must not fail for.
//
// Nothing here is logged: not the letter, not the letterhead, not the character that could not
// be set. Every refusal answers JSON, because `apiFetch` reads a non-2xx as JSON for its
// message, and an empty body would leave the panel with a blank error line.

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const date = new URL(req.url).searchParams.get('date') ?? ''
  if (!isIsoDate(date)) {
    return Response.json({ error: 'date must be a real YYYY-MM-DD' }, { status: 400 })
  }

  const { id } = await ctx.params
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })

  // By kind, never by index: the letter sits wherever the page appended it and wherever a
  // re-parse has since left it, and an index into `questions` would export whichever answer
  // happened to be standing in that slot.
  const q = app.questions.find(isCoverLetter)
  if (!q) return Response.json({ error: 'no cover letter on this application' }, { status: 404 })

  // The SAVED letter, never a draft and never the box's unsaved text: what you export is what
  // you signed. Read as text or not at all: the application PATCH validates only that its body is
  // an object, so the record's own owner can leave a number where the letter goes, and every
  // refusal on this route is a sentence the pane can show rather than a TypeError and a 500.
  const final = typeof q.final === 'string' ? q.final : ''
  if (final.trim() === '') {
    return Response.json({ error: 'save the letter before exporting it' }, { status: 400 })
  }
  // The finalize route accepts a final of any length — clearing and rewriting an answer is the
  // human's call, and no guard there counts characters — so the cap that keeps a paste out of
  // the typesetter belongs here, before the work starts.
  if (final.length > MAX_LETTER_CHARS) {
    return Response.json({ error: 'the letter is too long to set' }, { status: 422 })
  }

  let bytes: Uint8Array
  try {
    bytes = await renderLetterPdf({
      letter: readLetterhead(q.letter),
      // The company is the one value on the page that never passes through `readLetterhead`, so
      // it is read as text and cut to a line here. Uncapped it is the one input the typesetter
      // takes unbounded — a name of a megabyte would be measured and wrapped in full before the
      // page count refused it, and Firestore's document limit is all that bounds what the PATCH
      // can store.
      company: typeof app.company === 'string' ? app.company.slice(0, LETTERHEAD_FIELD_MAX) : '',
      text: final,
      dateIso: date,
    })
  } catch (error) {
    // The renderer's two refusals are the person's to act on, so each becomes a sentence they
    // can read; anything else is a bug or an outage and goes up as a 500.
    if (!(error instanceof LetterRenderError)) throw error
    if ('unsupported' in error.detail) {
      const n = error.detail.total
      return Response.json(
        {
          error: `The PDF font can’t set ${n} character${n === 1 ? '' : 's'} — use a Latin spelling, or copy the letter as text.`,
          // The characters the renderer named and where each sits, so the panel can say which one
          // and the person can go and find it rather than hunting the whole letter. It names a
          // handful at most; `total` is what the sentence above counts, so a letter in a script
          // the font has none of says how many there are without listing them all.
          unsupported: error.detail.unsupported,
          total: error.detail.total,
        },
        { status: 422 },
      )
    }
    return Response.json(
      { error: `The letter runs to ${error.detail.pages} pages — cut it to one before exporting.` },
      { status: 422 },
    )
  }

  // `Buffer.from` rather than the bytes as they are: a `Uint8Array<ArrayBufferLike>` is not a
  // `BodyInit` under this project's TypeScript, and the build's typecheck says so.
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="cover-letter.pdf"',
      'cache-control': 'no-store',
    },
  })
}
