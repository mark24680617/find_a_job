import { requireUser } from '@/lib/auth'
import { appendResumeAsk, getResume } from '@/lib/db'
import { RESUME_ID_RE } from '@/lib/resume/bounds'
import type { AnsweredAsk } from '@/lib/types'

// One answered ask, appended to the resume document. This is the write path behind every
// `askHuman` card on the feature — §6.2's bucket 3 and §6.3's missing-Y asks alike — and the
// rewrite flow reads `asks` back on its next run, which is how the Y rule's third source comes
// to exist at all (spec §4). Node runtime (the default): `@/lib/db` reaches Firestore through
// firebase-admin. No model call, so no permit and no kill switch: this stores what the candidate
// typed, and their own words are never what a ceiling is protecting.
//
// Read-modify-write inside a transaction (`appendResumeAsk`), not `FieldValue.arrayUnion`.
// `arrayUnion` appears nowhere in this repo — every array on a record is written whole, as the
// mock route's `chat: [...chat, spoken]` does — and it de-duplicates by deep equality, so a second
// answer that happened to match the first word for word would be silently dropped. The
// transaction is needed because a stale second tab is a second writer: a plain read-then-write
// would let both tabs read the same list, keep only the later answer, and tell both they saved.

type Ctx = { params: Promise<{ id: string }> }

/**
 * The caps on what one resume document holds of asks (R55, second amendment). The answer is long
 * enough that nobody writing in good faith meets it. The question is a card's own sentence and
 * never near its cap. The id is the section's stable id (`diagnose-…`, `gaps-…`, `rewrite-…`,
 * R31). With the count cap, the asks array is bounded at about 170 KB in Latin script and about
 * 500 KB in 3-byte UTF-8. That is not a guarantee the document fits Firestore's 1 MiB cap
 * (1,048,576 bytes, recorded in docs/notes/deps.md): Task B7's arithmetic puts a worst-case
 * extraction at 0.55–0.9 MB in Latin script and at the cap in CJK. An overflow fails the write as
 * a 500 and leaves the stored document as it was (B7's ruling).
 */
const MAX_ANSWER_CHARS = 1_000
const MAX_QUESTION_CHARS = 500
const MAX_ASK_ID_CHARS = 120
const MAX_ASKS = 100

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  if (!RESUME_ID_RE.test(id)) return bad('not found', 404)

  const body = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {}
  const askId = str(body.askId)
  const question = str(body.question)
  const answer = str(body.answer)
  // The question travels with the answer rather than being looked up: the card it was answered
  // on may be gone by the next run, and an answer with no question is a sentence nobody can
  // place.
  if (!askId || !question || !answer) {
    return bad('an answered ask carries askId, question and answer')
  }
  if (answer.length > MAX_ANSWER_CHARS) {
    return bad(`an answer is at most ${MAX_ANSWER_CHARS} characters`)
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return bad(`a question is at most ${MAX_QUESTION_CHARS} characters`)
  }
  if (askId.length > MAX_ASK_ID_CHARS) return bad(`an askId is at most ${MAX_ASK_ID_CHARS} characters`)

  const appended: AnsweredAsk = { askId, question, answer, answeredAt: new Date().toISOString() }
  const outcome = await appendResumeAsk(user.uid, id, appended, MAX_ASKS)
  if (outcome === 'missing') return bad('not found', 404)

  // A second answer to the same card is a stale tab or a double press, not a second answer. It
  // is refused rather than appended, because the rewrite flow reads these back and two answers
  // to one question is a contradiction nothing downstream can resolve. The id is stable per card
  // (R31), which is what lets this fire.
  // Two refusals, two statuses (amended 2026-09-24, R55): the duplicate is a 409 the page reads
  // as already saved; the full list is a 422, because nothing was stored and the page must say so.
  if (outcome === 'duplicate') {
    return Response.json(
      { error: 'that ask is already answered — reload the page', duplicate: true },
      { status: 409 },
    )
  }
  if (outcome === 'full') {
    return Response.json(
      { error: `this resume already holds ${MAX_ASKS} answered asks — no more can be stored`, asksFull: true },
      { status: 422 },
    )
  }

  // Read back rather than composed, so the page replaces its copy with the document exactly as
  // it is stored — the discipline every route on this feature ends on.
  const saved = await getResume(user.uid, id)
  if (!saved) return bad('not found', 404)
  return Response.json(saved)
}
