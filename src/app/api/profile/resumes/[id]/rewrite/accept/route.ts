import { judgeWithGemini } from '@/ai/flows/judgeFallback'
import { FlowOutputError } from '@/ai/genkit'
import { askNouls, JevError } from '@/ai/jev'
import type { BulletRewriteOut } from '@/ai/schemas'
import { requireUser } from '@/lib/auth'
import { utcToday } from '@/lib/dates'
import { appendResumeRewrite, getProfile, getResume } from '@/lib/db'
import { RESUME_ID_RE } from '@/lib/resume/bounds'
import { visibleText } from '@/lib/resume/checks'   // R43
import { judgeBullets } from '@/lib/resume/judge'
import { permitRefusal, resumeToolsEnabled, takePermit, TOOLS_OFF_MESSAGE } from '@/lib/resume/meter'   // R49
import type { AcceptedRewrite } from '@/lib/types'

// The one place on this feature that writes model-derived text. Node runtime (the default).
//
// The house order with three extra steps. The first exists because this body arrives from the
// client (amended 2026-09-24, R45): the flow's citation checks are run again on what was sent —
// each claimSpan non-empty and verbatim in the accepted text, each citation carrying a source, each
// resumeSpan verbatim in the visible resume text (R43) — because a type check says a citation is
// three strings and nothing about whether it is true. The other two exist because seconds passed
// between the proposal and this request. Every factId is re-checked against the LIVE bank: the bank may have
// moved while the model was writing, and a citation the reader cannot follow is worse than none,
// because it reads as verified. Then the accepted sentence is judged again by the same four
// questions the original bullet failed — the "Re-checked: 3 of 4" line on the page is arithmetic
// over what comes back, and it is arithmetic over a judgement of THIS sentence rather than of
// the one it replaced.
//
// The re-judge is a model call, and no model call on this feature sits outside the meter — four
// Nouls on the JEV path, one LOW Gemini call on the fallback. It costs one `rewrite` unit, taken
// after the live-bank check (so a proposal the bank has invalidated costs nothing) and before the
// judge (so the permit is in front of the spending, as everywhere else). The kill switch applies
// for the same reason: on the JEV-unavailable path this is a Gemini call, and a kill switch that
// leaves one reachable is not a kill switch.

type Ctx = { params: Promise<{ id: string }> }

const BULLET_ID = /^b\d+$/

/**
 * (final review, routes-1) What one accepted rewrite may carry. The flow's schema puts no ceiling
 * on either, and App Router handlers get no body limit, so without these a body of megabytes
 * reaches two scans that cost citations × text (a stalled event loop, before any permit) and the
 * re-judge (a model input, after one). One bullet is a sentence or two: 600 characters is several
 * times a long one. Eight citations is more claims than one bullet makes. A factId is a
 * Firestore-style id; 64 is RESUME_ID_RE's own length.
 */
const MAX_ACCEPTED_CHARS = 600
const MAX_ACCEPTED_CITATIONS = 8
const MAX_FACT_ID_CHARS = 64

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })
const moved = (): Response =>
  Response.json(
    { error: 'this resume was replaced while you were reading — re-run the rewrite', basisMoved: true },
    { status: 409 },
  )

type Body = {
  reviewedFrom: string
  bulletId: string
  text: string
  citations: BulletRewriteOut['rewrites'][number]['citations']
}

/**
 * The accepted rewrite as it arrives, or the sentence saying why it is not one. This checks the
 * SHAPE of every field and its size, and that no claimSpan is blank (amended 2026-09-24, R45): the rest of the
 * flow's citation checks — a source present, each span verbatim where it says — and the live-bank
 * factId check are re-run in the handler before the permit, because this body is stored and
 * shown back to the candidate as the sentence they chose, and the citations under it are what the
 * page underlines.
 */
function readBody(raw: unknown): Body | string {
  const b = raw as Record<string, unknown> | null
  const reviewedFrom = b?.reviewedFrom
  const bulletId = b?.bulletId
  const text = b?.text
  const citations = b?.citations
  if (typeof reviewedFrom !== 'string' || reviewedFrom === '') return 'reviewedFrom must say which upload this was written against'
  if (typeof bulletId !== 'string' || !BULLET_ID.test(bulletId)) return 'bulletId must be a bullet id like b7'
  if (typeof text !== 'string' || text.trim() === '') return 'a rewrite is text'
  // Sizes before anything reads the strings: every scan below is bounded by these (routes-1).
  if (text.length > MAX_ACCEPTED_CHARS) return `a rewritten line is at most ${MAX_ACCEPTED_CHARS} characters`
  if (!Array.isArray(citations)) return 'citations must be a list'
  if (citations.length > MAX_ACCEPTED_CITATIONS) return `a rewrite carries at most ${MAX_ACCEPTED_CITATIONS} citations`
  const read: Body['citations'] = []
  for (const entry of citations) {
    const c = entry as Record<string, unknown> | null
    if (typeof c?.claimSpan !== 'string' || c.claimSpan.trim() === '') return 'each citation needs the span it marks'
    if (c.factId !== null && typeof c.factId !== 'string') return 'a factId is text or nothing'
    if (c.resumeSpan !== null && typeof c.resumeSpan !== 'string') return 'a resumeSpan is text or nothing'
    if (c.claimSpan.length > MAX_ACCEPTED_CHARS || (c.resumeSpan?.length ?? 0) > MAX_ACCEPTED_CHARS) {
      return `a citation span is at most ${MAX_ACCEPTED_CHARS} characters`
    }
    if ((c.factId?.length ?? 0) > MAX_FACT_ID_CHARS) return `a factId is at most ${MAX_FACT_ID_CHARS} characters`
    read.push({ claimSpan: c.claimSpan, factId: c.factId as string | null, resumeSpan: c.resumeSpan as string | null })
  }
  return { reviewedFrom, bulletId, text, citations: read }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  if (!resumeToolsEnabled()) {
    return Response.json({ error: TOOLS_OFF_MESSAGE, disabled: true }, { status: 503 })   // R49
  }

  const { id } = await ctx.params
  if (!RESUME_ID_RE.test(id)) return bad('not found', 404)

  const body = readBody(await req.json().catch(() => null))
  if (typeof body === 'string') return bad(body)

  const before = await getResume(user.uid, id)
  if (!before) return bad('not found', 404)
  // The proposal was written against a document. If that is not the stored one any more, the
  // bullet ids in it were allocated over a different text and the spans were checked against it.
  if (before.addedAt !== body.reviewedFrom) return moved()

  const bullet = before.bullets.find((b) => b.id === body.bulletId)
  if (!bullet) return bad(`this resume has no bullet ${body.bulletId}`)

  // (amended 2026-09-24, R45) The flow's citation checks, run again on what arrived and against
  // the flow's own corpus (visibleText, R43), before the profile read and before the permit — a
  // body that fails them costs nothing. The messages name a position and never a span, as the
  // flow's do.
  const failedSpan = (error: string): Response =>
    Response.json({ error: `${error} — re-run the rewrite`, rewriteFailed: true }, { status: 422 })
  const visible = visibleText(before)
  for (const [i, c] of body.citations.entries()) {
    if (c.factId === null && c.resumeSpan === null) {
      return failedSpan(`citation ${i + 1} carries neither a fact nor a resume span`)
    }
    if (!body.text.includes(c.claimSpan)) {
      return failedSpan(`citation ${i + 1} does not appear verbatim in the accepted line`)
    }
    if (c.resumeSpan !== null && !visible.includes(c.resumeSpan)) {
      return failedSpan(`citation ${i + 1} cites a resume span that is not in the stored resume`)
    }
  }

  // The live bank, read now rather than trusted from the proposal.
  const profile = await getProfile(user.uid)
  const known = new Set(profile.facts.map((f) => f.id))
  for (const [i, c] of body.citations.entries()) {
    if (c.factId !== null && !known.has(c.factId)) {
      return Response.json(
        { error: `citation ${i + 1} names ${c.factId}, which is no longer in your fact bank — re-run the rewrite`, rewriteFailed: true },
        { status: 422 },
      )
    }
  }

  // Both ceilings in one transaction, before the re-judge. One unit, not one per Noul: the unit
  // on this tool is a bullet, and this is one bullet — the same bullet the proposal already paid
  // for, judged a second time because the candidate changed the sentence.
  const permit = await takePermit(user.uid, 'rewrite', utcToday(), 1)
  if (permit !== 'ok') {
    // (amended 2026-09-24, R49) The ceiling sentences live in `meter.ts`, once, for every route.
    const refusal = permitRefusal(permit)
    return Response.json(refusal.body, { status: refusal.status })
  }

  // The same state construction as Diagnose: the bullet plus its entry's role and company line,
  // and nothing more — with the accepted sentence standing in for the stored one.
  let recheck
  try {
    recheck = await judgeBullets([{ ...bullet, text: body.text }], before.entries, {
      askNouls,
      fallback: judgeWithGemini,
    })
  } catch (error) {
    // A JEV 422 is our bug in a question shape rather than a vendor outage, so it never falls
    // back — it surfaces, with the field it named. The field name is a name of ours; nothing of
    // the candidate's goes into the message or into the log.
    if (error instanceof JevError) {
      console.warn('jev refused a question shape, field:', error.field)
      return Response.json(
        { error: `the judge refused the question shape (${error.field ?? 'no field named'})`, rewriteFailed: true },
        { status: 422 },
      )
    }
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, rewriteFailed: true }, { status: 422 })
    }
    throw error
  }

  const stored: AcceptedRewrite = {
    reviewedFrom: body.reviewedFrom,
    // One request, one judge: every judgement in this re-check came back from the same call.
    judge: recheck[0].judge,
    acceptedAt: new Date().toISOString(),
    bulletId: body.bulletId,
    text: body.text,
    citations: body.citations,
    recheck,
  }
  // One write, appending, in a transaction that re-checks the basis on the same read. The judge
  // takes seconds and the document can move underneath it. An accepted rewrite is a record of a
  // decision the candidate made, so an earlier one is never replaced by a later one — the history
  // is the point.
  const appended = await appendResumeRewrite(user.uid, id, stored)
  if (appended === 'missing') return bad('not found', 404)
  if (appended === 'moved') return moved()

  const now = await getResume(user.uid, id)
  if (!now) return bad('not found', 404)
  return Response.json(now)
}
