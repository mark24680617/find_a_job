import { runBulletRewrite } from '@/ai/flows/bulletRewrite'
import { FlowOutputError } from '@/ai/genkit'
import { entryLine } from '@/ai/prompts/nouls'                    // R17
import type { BulletRewriteOut } from '@/ai/schemas'
import { requireUser } from '@/lib/auth'
import { utcToday } from '@/lib/dates'
import { getProfile, getResume } from '@/lib/db'
import { RESUME_ID_RE } from '@/lib/resume/bounds'
import { visibleText } from '@/lib/resume/checks'                 // R43
import { permitRefusal, resumeToolsEnabled, takePermit, TOOLS_OFF_MESSAGE } from '@/lib/resume/meter'   // R49

// A rewrite PROPOSAL. Node runtime (the default): `@/lib/db` reaches Firestore through
// firebase-admin and the Genkit call needs it too; requireUser runs before either.
//
// This route writes NOTHING. It is the reconcileFacts disposition, for the same reason: the
// resume is the candidate's document, the model's sentences are a suggestion about it, and the
// only thing here allowed to change the record is the candidate pressing accept — which is a
// different request, on a different handler, with a re-check the model never sees.
//
// The order is the house order with one addition. Every hard input is checked BEFORE the permit
// is taken — a stale tab asking to rewrite a bullet that passed should cost the account nothing
// — and the permit is taken before the model call, in one transaction, because the increment IS
// the permit and a read-then-check ceiling in front of a plain POST is defeated by two tabs.

type Ctx = { params: Promise<{ id: string }> }

const BULLET_ID = /^b\d+$/

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })

/** The ids the client asked for, or the sentence saying why they are not ids. */
function readBulletIds(body: unknown): string[] | string {
  const raw = (body as Record<string, unknown> | null)?.bulletIds
  if (!Array.isArray(raw) || raw.length === 0) return 'bulletIds must be a non-empty list of bullet ids like b7'
  for (const id of raw) {
    if (typeof id !== 'string' || !BULLET_ID.test(id)) {
      return 'bulletIds must be a non-empty list of bullet ids like b7'
    }
  }
  return [...new Set(raw as string[])]
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  // The kill switch, before anything is read: it exists so the tools can be turned off during
  // the judged window without a deploy, and a switch that still spends a Firestore read is a
  // switch that was not thrown.
  if (!resumeToolsEnabled()) {
    return Response.json({ error: TOOLS_OFF_MESSAGE, disabled: true }, { status: 503 })   // R49
  }

  const { id } = await ctx.params
  // A malformed id and another account's resume answer the same 404, which says nothing about
  // whether either exists.
  if (!RESUME_ID_RE.test(id)) return bad('not found', 404)

  const body: unknown = await req.json().catch(() => null)
  const bulletIds = readBulletIds(body)
  if (typeof bulletIds === 'string') return bad(bulletIds)

  const resume = await getResume(user.uid, id)
  if (!resume) return bad('not found', 404)

  const byId = new Map(resume.bullets.map((b) => [b.id, b]))
  const unknownId = bulletIds.find((b) => !byId.has(b))
  if (unknownId) return bad(`this resume has no bullet ${unknownId}`)

  // The input set of this tool is §6.1's output set: the bullets a judge failed, on a Diagnose
  // run against THIS upload. A diagnosis of the previous upload names bullet ids that were
  // allocated over a different document.
  const diagnose = resume.diagnose
  if (!diagnose || diagnose.reviewedFrom !== resume.addedAt) {
    return Response.json(
      { error: 'run Diagnose against this upload before rewriting', rewriteFailed: true },
      { status: 422 },
    )
  }
  const failed = new Set(
    diagnose.judgements.filter((j) => j.verdict === 'fail').map((j) => j.bulletId),
  )
  const bullets = bulletIds
    .filter((b) => failed.has(b))
    .map((b) => {
      const bullet = byId.get(b)!
      const entry = resume.entries[bullet.entryIndex]
      // The same line JEV's state carries — C4's `entryLine`, the role and the company and
      // nothing more (R17). A bullet outside any entry sits on entryIndex -1 (B3), so `entry`
      // can be undefined, and it is sent with an empty line rather than a 500.
      return { id: bullet.id, text: bullet.text, entryLine: entry ? entryLine(entry) : '' }
    })
  if (bullets.length === 0) {
    return Response.json({ error: 'none of those bullets failed a check', rewriteFailed: true }, { status: 422 })
  }

  // The unit is bullets, not calls (spec §8): rewriting six bullets costs six, and a refused or
  // failed call does not refund them.
  const permit = await takePermit(user.uid, 'rewrite', utcToday(), bullets.length)
  if (permit !== 'ok') {
    // (amended 2026-09-24, R49) The ceiling sentences live in `meter.ts`, once, for every route.
    const refusal = permitRefusal(permit)
    return Response.json(refusal.body, { status: refusal.status })
  }

  const profile = await getProfile(user.uid)
  let proposal: BulletRewriteOut
  try {
    proposal = await runBulletRewrite({
      // (amended 2026-09-24, R43) The resume as the reader sees it: a hidden line is neither sent
      // to the model nor a corpus a resumeSpan or a digit may be sourced from.
      resumeText: visibleText(resume),
      bullets,
      facts: profile.facts,
      // The rule text is what the model applies; the evidence behind each is what the profile
      // editor shows a human wondering where the rule came from.
      voiceRules: profile.voiceRules.map((r) => r.rule),
      // The Y rule's third source, and the only one the candidate wrote themselves.
      asks: resume.asks ?? [],
      today: utcToday(),
    })
  } catch (error) {
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, rewriteFailed: true }, { status: 422 })
    }
    throw error
  }

  // The basis travels with the proposal, because accept checks it: these sentences were written
  // against this upload, and a proposal accepted onto a different one is a rewrite of a document
  // nobody is holding any more.
  return Response.json({ reviewedFrom: resume.addedAt, proposal })
}
