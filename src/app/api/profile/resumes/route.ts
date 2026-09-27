import { requireUser } from '@/lib/auth'
import { utcToday } from '@/lib/dates'
import { getProfile, getResume, RESUME_CURRENT_ID, setResume } from '@/lib/db'
import {
  ExtractError,
  MAX_PARSE_QUEUE,
  MAX_RESUME_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  READER_BUSY_MESSAGE,
  TOO_LARGE_MESSAGE,
  UNREADABLE_MESSAGE,
} from '@/lib/resume/bounds'
import { extractResume, parseQueueDepth } from '@/lib/resume/extract'
// The refusal sentences are the meter's, one wording across every metered route (R49).
import { permitRefusal, resumeToolsEnabled, takePermit, TOOLS_OFF_MESSAGE } from '@/lib/resume/meter'
import { snippetCheck } from '@/lib/resume/snippetCheck'
import type { StoredResume } from '@/lib/types'

// The resume arrives. One document per account, at a fixed id, replaced in place. Node runtime
// (the default): `@/lib/db` reaches Firestore through firebase-admin and the extractor runs
// `pdfjs-dist`; requireUser runs before either.
//
// The 6 MB cap is checked TWICE, and the first time is the one that matters: a missing,
// unparseable or oversized `content-length` is refused before `req.json()`. The take-home route
// is the precedent for the second check only — it decodes downstream of `await req.json()`
// (assignment/route.ts:92) — and on a 512 Mi instance a body read whole before it is measured is
// the whole defence gone.
//
// The write keeps what the previous upload's tools produced. An upload bumps `addedAt` and does
// not clear `diagnose`, `gaps`, `rewrites` or `asks`, which keep their old `reviewedFrom` and are
// therefore drawn stale with their re-run control (spec §5.1, §5.2). The snippet report is the
// one derived field that is always recomputed: it is a statement about this text.
//
// This route is metered even though it calls no model. `MAX_EXTRACT_MS` is 20 seconds, so an
// authenticated account with a slow-to-parse PDF can hold a 512 Mi instance busy all day for the
// price of one request — the two 413s and the four bounds cap ONE upload, not a day of them. The
// permit is taken after both size checks and before the parse, which is where the cost is.

const bad = (error: string, status: number): Response => Response.json({ error }, { status })

/**
 * The one shape a document that could not be read takes. `extractFailed` is what tells the card
 * to show the reason against the file the candidate chose rather than as a failure of the page.
 */
const unextractable = (error: string): Response =>
  Response.json({ error, extractFailed: true }, { status: 422 })

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  if (!resumeToolsEnabled()) {
    return Response.json({ error: TOOLS_OFF_MESSAGE, disabled: true }, { status: 503 })
  }

  // First of the two size checks, and the only one that happens before the body is in memory.
  // A length we cannot read is a length we will not trust: absent, non-numeric and oversized are
  // one refusal, because all three mean the same thing about how much we are about to read.
  const declared = Number(req.headers.get('content-length'))
  if (!Number.isInteger(declared) || declared <= 0 || declared > MAX_UPLOAD_BODY_BYTES) {
    return bad(TOO_LARGE_MESSAGE, 413)
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const pdfBase64 = typeof body?.pdfBase64 === 'string' ? body.pdfBase64 : ''
  const filename = typeof body?.filename === 'string' ? body.filename.trim() : ''
  if (pdfBase64 === '' || filename === '') return bad('send pdfBase64 and filename', 400)

  // Second check, on the decoded document rather than on the base64 that carried it: the string
  // on the wire is a third longer than the file, and the bound is about the PDF.
  const bytes = Buffer.from(pdfBase64, 'base64')
  if (bytes.byteLength > MAX_RESUME_BYTES) return bad(TOO_LARGE_MESSAGE, 413)

  // Parsing is one at a time in this process, each up to MAX_EXTRACT_MS. Past MAX_PARSE_QUEUE
  // parses ahead, this one would wait longer than the queue promises, so it is turned away here,
  // before the permit — nothing is wrong with the document and nothing is spent on it.
  if (parseQueueDepth() >= MAX_PARSE_QUEUE) {
    return Response.json({ error: READER_BUSY_MESSAGE, busy: true }, { status: 503 })
  }

  // Both ceilings in one transaction, after every refusal above and before the parse. There is
  // no model call on this route to be "before", so the first expensive thing is the bound: the
  // permit goes in front of that. A refused upload above costs nothing; a parsed one costs a
  // unit whether or not the parse succeeds, because the CPU is spent either way.
  const permit = await takePermit(user.uid, 'upload', utcToday(), 1)
  if (permit !== 'ok') {
    const refusal = permitRefusal(permit)
    return Response.json(refusal.body, { status: refusal.status })
  }

  let extracted
  try {
    extracted = await extractResume(new Uint8Array(bytes), { now: () => Date.now() })
  } catch (error) {
    // The bound's own sentence, or one fixed sentence for everything else. Never the parser's
    // message: an exception escaping a handler is logged by the platform with its message and
    // stack, and nothing on this feature may put document content in a log (spec §8).
    if (error instanceof ExtractError) return unextractable(error.message)
    return unextractable(UNREADABLE_MESSAGE)
  }

  // Read before the write, so the previous upload's artifacts survive it and are drawn stale
  // rather than silently dropped.
  const [prior, profile] = await Promise.all([
    getResume(user.uid, RESUME_CURRENT_ID),
    getProfile(user.uid),
  ])
  const addedAt = new Date().toISOString()
  const doc: StoredResume = {
    ...(prior ?? {}),
    // Named rather than spread from `extracted`, which also carries `pages` — a count the route
    // uses and the document has no field for.
    text: extracted.text,
    lines: extracted.lines,
    sections: extracted.sections,
    entries: extracted.entries,
    bullets: extracted.bullets,
    language: extracted.language,
    addedAt,
    filename,
    bytes: bytes.byteLength,
    snippetCheck: { reviewedFrom: addedAt, ...snippetCheck(profile.facts, extracted.text) },
  }
  await setResume(user.uid, RESUME_CURRENT_ID, doc)

  // Read back rather than composed, so the page replaces its copy with the document exactly as
  // it is stored.
  const fresh = await getResume(user.uid, RESUME_CURRENT_ID)
  if (!fresh) return bad('not found', 404)
  return Response.json(fresh)
}
