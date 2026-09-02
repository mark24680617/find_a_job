import { runFormParse } from '@/ai/flows/formParse'
import { IMAGE_MIMES, type FormImage } from '@/ai/prompts/formParse'
import { requireUser } from '@/lib/auth'
import { getApplication, updateApplication } from '@/lib/db'
import type { Application, Question } from '@/lib/types'

// Read one application form — pasted text, screenshots of the live form, or both — and put
// its questions on the record. Node runtime (the default): `@/lib/db` reaches Firestore
// through firebase-admin and the Genkit call needs it too; requireUser runs before either.
//
// Parsing REPLACES `questions` wholesale: the newest intake is the description of the form,
// and a question list half from one screenshot and half from another is a list that matches
// no form that exists. Drafts on the old questions go with them, so the UI (Task 12) asks
// before re-parsing a form that already has answers. `append: true` is the other case — the
// form asks something this parse missed, so the read questions go on the END of the list and
// nothing already drafted is touched.

type Ctx = { params: Promise<{ id: string }> }

/** A field the client either sent as a usable string or did not usefully send at all. */
function readString(body: unknown, key: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const isImageMime = (mime: unknown): mime is FormImage['mime'] =>
  (IMAGE_MIMES as readonly string[]).includes(mime as string)

/**
 * Screenshots as the client sent them, or the reason they are not usable. A mime outside
 * the list is refused here rather than forwarded: the model reads a form by looking at it,
 * so a type it cannot decode would be answered blind instead of read.
 */
function readImages(body: unknown): FormImage[] | string {
  const raw = (body as Record<string, unknown> | null)?.images
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return 'images must be an array'

  const images: FormImage[] = []
  for (const entry of raw) {
    const base64 = readString(entry, 'base64')
    const mime = (entry as Record<string, unknown> | null)?.mime
    if (!base64) return 'each image needs base64 data'
    if (!isImageMime(mime)) return `image mime must be one of ${IMAGE_MIMES.join(', ')}`
    images.push({ base64, mime })
  }
  return images
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const body: unknown = await req.json().catch(() => null)
  const text = readString(body, 'text')
  const images = readImages(body)
  if (typeof images === 'string') return Response.json({ error: images }, { status: 400 })
  if (!text && images.length === 0) {
    return Response.json({ error: 'send text or images' }, { status: 400 })
  }
  // Which of the two writes this is. Refused rather than coerced: a truthy string here would
  // silently turn a replace into an append, or the reverse, on somebody's only copy of a draft.
  const append = (body as Record<string, unknown> | null)?.append
  if (append !== undefined && typeof append !== 'boolean') {
    return Response.json({ error: 'append must be true or false' }, { status: 400 })
  }

  const { id } = await ctx.params
  // Read once before the model call so a form parsed against an application that is not
  // there (or is not this user's) is not a call spent on a result with nowhere to go.
  if (!(await getApplication(user.uid, id))) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  const out = await runFormParse({ text, images })

  // Read again after it. The model call takes seconds, and the record can move underneath
  // it — a human answering the scope question, any other PATCH — so the pre-call read is
  // stale by the time it would decide anything. Firestore's update() replaces `parsed`
  // whole, so composing the write from that stale copy would revert whatever landed in the
  // window. Same reasoning as `POST /api/profile/ingest`, which reads after the model for
  // the same freshness.
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })

  const read = out.questions.map(
    (q): Question => ({ q: q.q, constraints: q.constraints, askHuman: [], status: 'pending' }),
  )
  // Composed from that fresh read in both modes, so an append carries the existing questions
  // through by reference — drafts, finals, stories and positioning intact — including one that
  // landed while the model was reading.
  const patch: Partial<Application> = {
    questions: append ? [...app.questions, ...read] : read,
  }
  // The posting could not tell whether this material attaches to one requisition or to a
  // platform profile; the form itself often can. Only that one field is overwritten, and
  // only while it is STILL unknown as of the read above — a scope a human settled while the
  // model was reading is a decision they just made, not this call's to move.
  if (app.parsed && app.parsed.scope === 'unknown') {
    patch.parsed = { ...app.parsed, scope: out.scope }
  }

  await updateApplication(user.uid, id, patch)
  // Composed from the fresh read plus the patch just written, rather than read back a third
  // time: those are exactly the fields that changed, and the rest is as current as anything
  // this request can honestly claim.
  return Response.json({ ...app, ...patch })
}
