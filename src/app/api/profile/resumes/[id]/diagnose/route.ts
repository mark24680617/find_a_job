import { judgeWithGemini } from '@/ai/flows/judgeFallback'
import { runResumeFindings } from '@/ai/flows/resumeFindings'
import { FlowOutputError } from '@/ai/genkit'
import { JevError, askNouls, type Judge } from '@/ai/jev'
import { requireUser } from '@/lib/auth'
import { utcToday } from '@/lib/dates'
import { getResume, patchResume } from '@/lib/db'
import { BOUND_MESSAGE, MAX_RESUME_BULLETS, RESUME_ID_RE } from '@/lib/resume/bounds'
import { runChecks, visibleBullets } from '@/lib/resume/checks'
import { CHECK_LANGUAGE, LANGUAGE_GATE_SENTENCE } from '@/lib/resume/checkSources'
import { buildFindingsInput } from '@/lib/resume/findingsInput'
import { judgeBullets } from '@/lib/resume/judge'
import { TOOLS_OFF_MESSAGE, diagnoseCost, permitRefusal, resumeToolsEnabled, takePermit } from '@/lib/resume/meter'
import type { DiagnoseResult } from '@/lib/types'

// Diagnose, on demand: the deterministic checks, then a judgement per bullet, then one Gemini call
// over the failures only. Node runtime (the default): `@/lib/db` reaches Firestore through
// firebase-admin, the judge reaches two vendors, and requireUser runs before any of them.
//
// The order below is the house one, with the permit inserted at the one place it belongs — after
// the record is read and after every refusal, and before the first thing that costs money. A
// permit taken earlier would be spent on a 404; taken later it would be spent after the spending.
// A document with no text layer costs nothing at all: it is stored without a permit (R27).
//
// The 409 is why this route re-reads. The run takes seconds, and in those seconds the candidate
// can upload a new PDF in another tab: a DiagnoseResult stamped `reviewedFrom` the old upload and
// stored on the new one would be a review of a document nobody is holding any more.

type Ctx = { params: Promise<{ id: string }> }

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  // The kill switch for the judged window, checked before anything is read: turning the tools off
  // has to work without a deploy and without touching the data. The sentence is meter.ts's (R49).
  if (!resumeToolsEnabled()) {
    return Response.json({ error: TOOLS_OFF_MESSAGE, disabled: true }, { status: 503 })
  }

  const { id } = await ctx.params
  // A malformed id and a document that is not there are the same 404, which says nothing about
  // whether it exists. The document is always resolved under this uid and never looked up by id.
  if (!RESUME_ID_RE.test(id)) return bad('not found', 404)

  const resume = await getResume(user.uid, id)
  if (!resume) return bad('not found', 404)

  // The gate covers the Noul layer as well as the checks, and for the sharper reason: a cut point
  // is a fixed number gating a user-visible count, and the same resume can score differently in
  // two languages by enough to cross it (§6.1, risk 11). Lifting it is a deps.md entry. The page
  // says the same sentence from `resume.language` before any run and offers no trigger, so this
  // 400 is reached only by a stale tab (R26).
  if (resume.language !== CHECK_LANGUAGE) {
    return Response.json({ error: LANGUAGE_GATE_SENTENCE, languageGate: true }, { status: 400 })
  }

  // Pure and free, so it runs before the permit: it is what decides whether anything here costs.
  const checks = runChecks(resume)
  // R27: with no text layer there is nothing to judge, and no quote could pass C9's guard against
  // an empty text — so no permit, no judge, no findings; the checks alone are stored.
  const noText = checks.some((c) => c.checkId === 'text-layer' && c.state === 'fail')

  let judgements: DiagnoseResult['judgements'] = []
  let findings: DiagnoseResult['findings'] = []

  if (!noText) {
    // (final review, extract-4 / routes-2) Every visible bullet is one judge call, so the permit
    // is priced by them, and a document stored before the upload bound existed is refused here,
    // before the permit, rather than judged a thousand bullets deep.
    const judged = visibleBullets(resume)
    if (judged.length > MAX_RESUME_BULLETS) {
      return Response.json({ error: BOUND_MESSAGE.bullets, diagnoseFailed: true }, { status: 422 })
    }
    const permit = await takePermit(user.uid, 'diagnose', utcToday(), diagnoseCost(judged.length))
    if (permit !== 'ok') {
      const refusal = permitRefusal(permit)
      return Response.json(refusal.body, { status: refusal.status })
    }

    try {
      judgements = await judgeBullets(judged, resume.entries, {
        askNouls,
        fallback: judgeWithGemini,
      })
    } catch (error) {
      if (error instanceof JevError) {
        // A 422 is our bug in a question shape. The field name is ours and carries nothing of the
        // resume, so it is the one thing worth logging; the body says no more than that.
        console.warn('jev refused a question shape:', error.field)
        return Response.json(
          { error: 'The judge refused the shape of a question. Nothing was stored.', diagnoseFailed: true },
          { status: 422 },
        )
      }
      if (error instanceof FlowOutputError) {
        return Response.json({ error: error.message, diagnoseFailed: true }, { status: 422 })
      }
      throw error
    }

    // Only the failures go to the model, and the gap is not among them: D4 allows the period to be
    // stated and nothing else, and an explanation written by a model would be advice about hiding
    // it. Leaving the id out of the handed-over set is what makes that structural — C9's guard
    // refuses a finding whose checkId was not handed over. `buildFindingsInput` is where that,
    // the hidden-line filter and the visible text all happen (R25).
    try {
      const out = await runResumeFindings(buildFindingsInput(resume, checks, judgements, utcToday()))
      findings = out.findings
    } catch (error) {
      if (error instanceof FlowOutputError) {
        return Response.json({ error: error.message, diagnoseFailed: true }, { status: 422 })
      }
      throw error
    }
  }

  const fresh = await getResume(user.uid, id)
  if (!fresh) return bad('not found', 404)
  if (fresh.addedAt !== resume.addedAt) {
    return Response.json(
      { error: 'The resume changed while this was running — run it again.', basisMoved: true },
      { status: 409 },
    )
  }

  const diagnose: DiagnoseResult = {
    reviewedFrom: resume.addedAt,
    // One judge per run, and the honest reading of a mixed one is the weaker label: `jev` only
    // when every judgement carries it. A run with nothing to judge is `gemini`, because the
    // fallback is the judge this deployment always has (D5).
    judge: (judgements.length > 0 && judgements.every((j) => j.judge === 'jev') ? 'jev' : 'gemini') as Judge,
    ranAt: new Date().toISOString(),
    // The stored slice drops `lines`: a per-line index list is document weight, and `runChecks`
    // over the same stored resume gives them back. On a fresh review the page recomputes them
    // (DiagnoseSection's checkEvidence, F1), and a failing row shows its own lines and a fixed fix
    // sentence; a stale review's rows show no lines.
    checks: checks.map(({ checkId, state, source }) => ({ checkId, state, source })),
    judgements,
    findings,
  }
  await patchResume(user.uid, id, { diagnose })

  // Read back rather than composed, so the page replaces its copy with the document exactly as it
  // is stored — the discipline every write route here ends on.
  const saved = await getResume(user.uid, id)
  if (!saved) return bad('not found', 404)
  return Response.json(saved)
}
