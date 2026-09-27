import { judgeWithGemini } from '@/ai/flows/judgeFallback'
import { FlowOutputError } from '@/ai/genkit'
import { askNouls, JevError } from '@/ai/jev'
import { NOTHING_TO_COMPARE } from '@/components/resume/copy'
import { requireUser } from '@/lib/auth'
import { utcToday } from '@/lib/dates'
import { getProfile, getResume, listApplications, patchResume } from '@/lib/db'
import { RESUME_ID_RE } from '@/lib/resume/bounds'
import { hiddenLineIndices, visibleText } from '@/lib/resume/checks'
import { CHECK_LANGUAGE, LANGUAGE_GATE_SENTENCE } from '@/lib/resume/checkSources'
import { bucketSkills, demandedSkills, tier0Terms } from '@/lib/resume/gaps'
import { judgeSkills } from '@/lib/resume/judge'
import { permitRefusal, resumeToolsEnabled, takePermit, TOOLS_OFF_MESSAGE } from '@/lib/resume/meter'
import { ONET_RELEASE, ONET_SKILLS } from '@/lib/resume/onet'
import { resolveRoleFamily } from '@/lib/resume/onetLookup'
import type { GapsResult } from '@/lib/types'

// What this resume does not say that the user's own saved postings and O*NET's data for one
// confirmed occupation ask for. Node runtime (the default): `@/lib/db` reaches Firestore through
// firebase-admin, and the fallback judge is a Genkit call; requireUser runs before either.
//
// There is no Gemini flow here (spec §6.2). The judge answers one yes/no per skill and every
// bucket after that is arithmetic in `@/lib/resume/gaps` — so nothing on this screen is a number
// or a category a model chose.
//
// The house order, with the permit where §8 puts it: requireUser → the kill switch → the id →
// the body → read → refuse on missing hard inputs → one transaction for both ceilings → the
// judge → read again → 409 if the basis moved → one write → the re-read document.

type Ctx = { params: Promise<{ id: string }> }

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })
/** `ranAt` only. The meter day comes from `utcToday()`, as it does on every other route here. */
const now = (): string => new Date().toISOString()

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  // The kill switch for the judged window: off, and the route costs nothing and reads nothing.
  // The words are meter.ts's, the same on every route (R49).
  if (!resumeToolsEnabled()) {
    return Response.json({ error: TOOLS_OFF_MESSAGE, disabled: true }, { status: 503 })
  }

  const { id } = await ctx.params
  if (!RESUME_ID_RE.test(id)) return bad('not found', 404)

  const body = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {}
  // Both travel: `roleFamily` is the title the page shows and stores, `onetSoc` is the code
  // ONET_SKILLS is keyed by. A pair that does not agree is a control nobody confirmed. This is
  // also the contract's "400 on an onetSoc not in ONET_SKILLS": every code in ROLE_FAMILIES is
  // asserted to be a key of ONET_SKILLS by tests/resume.onetLookup.test.ts, so a code that is
  // not one cannot match a family and is refused here.
  const onetSoc = typeof body.onetSoc === 'string' ? body.onetSoc : ''
  const family = resolveRoleFamily(typeof body.roleFamily === 'string' ? body.roleFamily : '')
  if (!family || family.onetSoc !== onetSoc) {
    return bad('confirm a role family from the list before running this')
  }
  const candidates = ONET_SKILLS[family.onetSoc]

  const [resume, profile, apps] = await Promise.all([
    getResume(user.uid, id),
    getProfile(user.uid),
    listApplications(user.uid),
  ])
  if (!resume) return bad('not found', 404)
  // §6.1's language gate covers the Noul layer, and this is the Noul layer: a cut point is a
  // fixed number gating what the user is told, and the CN/EN delta can cross it. Lifting this is
  // a deps.md entry, not a code change here. The same 400, constant and sentence as Diagnose
  // (R26); the page renders the sentence from `resume.language` and never offers the trigger.
  if (resume.language !== CHECK_LANGUAGE) {
    return Response.json({ error: LANGUAGE_GATE_SENTENCE, languageGate: true }, { status: 400 })
  }

  const { terms, postingsUsed } = tier0Terms(apps)
  const demanded = demandedSkills(candidates, terms)
  // §6.2's empty state, verbatim from copy.ts (R35). A 400 rather than a stored empty result,
  // which would overwrite a comparison the user already has.
  if (demanded.length === 0) return bad(NOTHING_TO_COMPARE)

  // Both counters in one transaction, before the model call. The increment is the permit; a
  // refused or failed run does not refund it (spec §8). The refusal's words are meter.ts's (R49).
  const permit = await takePermit(user.uid, 'gaps', utcToday())
  if (permit !== 'ok') {
    const refusal = permitRefusal(permit)
    return Response.json(refusal.body, { status: refusal.status })
  }

  let judged: Awaited<ReturnType<typeof judgeSkills>>
  try {
    judged = await judgeSkills(visibleText(resume), demanded.map((c) => c.name), { askNouls, fallback: judgeWithGemini })
  } catch (error) {
    // Both are mapped rather than thrown on: anything escaping a handler is logged by the
    // platform with its message and stack, and nothing on this feature is logged (spec §8).
    if (error instanceof JevError) {
      return Response.json(
        { error: `the judge refused a question (${error.field ?? 'no field named'})`, gapsFailed: true },
        { status: 422 },
      )
    }
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, gapsFailed: true }, { status: 422 })
    }
    throw error
  }

  const fresh = await getResume(user.uid, id)
  if (!fresh) return bad('not found', 404)
  if (fresh.addedAt !== resume.addedAt) {
    // A run takes seconds, and in those seconds the candidate can replace the resume in another
    // tab. These buckets are about a document nobody is holding any more.
    return Response.json(
      { error: 'the resume was replaced while this ran — run it again', basisMoved: true },
      { status: 409 },
    )
  }

  const hidden = new Set(hiddenLineIndices(fresh))
  const gaps: GapsResult = {
    reviewedFrom: fresh.addedAt,
    judge: judged.judge,
    ranAt: now(),
    roleFamily: family.title,
    postingsUsed,
    onetRelease: ONET_RELEASE,
    skills: bucketSkills({
      candidates: demanded,
      postingTerms: terms,
      factClaims: profile.facts.map((f) => f.claim),
      // The visible lines, so "named in your resume" and the line the page quotes back are one
      // the reader can see (§8, R37, F2).
      resumeLines: fresh.lines.filter((_, i) => !hidden.has(i)).map((l) => l.text),
      judgements: judged.judgements,
    }),
  }
  await patchResume(user.uid, id, { gaps })

  const saved = await getResume(user.uid, id)
  if (!saved) return bad('not found', 404)
  return Response.json(saved)
}
