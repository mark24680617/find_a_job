import { FlowOutputError } from '@/ai/genkit'
import { briefInUse, MIN_BRIEF_CHARS } from '@/lib/assignment'
import { requireUser } from '@/lib/auth'
import { getApplication, getInterview, updateInterview } from '@/lib/db'
import { researchTakeHome } from '@/lib/research/takeHome'

// The plan for one take-home, on demand, stored on the round. Node runtime (the default):
// `@/lib/db` reaches Firestore through firebase-admin and the Genkit calls under the research
// need it too; requireUser runs before either. The research itself is `researchTakeHome`; what
// is here is the request around it — who is asking, which text is the brief, and the one write.
//
// Nothing is written until the synthesis has passed its guard, so a failed run costs about a
// minute and not the plan the person already had. Idempotent: a second call replaces the plan.
//
// The 409 below is the whole reason this route re-reads. A run takes about a minute, and in
// that minute the candidate can paste the real brief in another tab. The plan in hand quotes
// the document that has just been replaced — every `Quoted` in it was checked against text the
// round no longer holds — so it is refused rather than stored. This is not the mock route's
// stale-tab problem, where two conversations would be merged; here one document was swapped for
// another underneath a judgment about the first.

type Ctx = { params: Promise<{ id: string; rid: string }> }

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })

/**
 * §4.3: a transcription is the model's reading of the file, not the file. Added by the route
 * rather than asked of the synthesis, because how the brief was read is a fact about this
 * request — the model that wrote the guide never saw the PDF, only the text it produced.
 */
const PDF_CAVEAT =
  'The brief was transcribed from a PDF by the model; check its quotes against your copy.'

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id, rid } = await ctx.params
  // Both before the research: the plan is drawn FOR this posting and stored ON this round, and
  // neither is worth a minute of searching spent on a record that is not there.
  const [app, round] = await Promise.all([
    getApplication(user.uid, id),
    getInterview(user.uid, id, rid),
  ])
  if (!app || !round) return bad('not found', 404)
  // The mirror of the 400 the brief and mock routes give a take-home round: a round that hands
  // over no assignment has no brief to read and nothing to plan inside.
  if (round.roundType !== 'take-home') return bad('only a take-home round has a plan')
  // The same refusal every other flow here makes: the job summary the synthesis reads comes out
  // of the parsed posting, so without one there is no role to plan for.
  if (!app.parsed) return bad('interpret the posting before planning')

  // The one place that decides which text is the brief — the stored assignment, or the notice
  // until there is one — and the identity that says which. The route reads it once and holds
  // onto it: the same identity is what the re-read below is compared against.
  const brief = briefInUse(round)
  if (brief.text.length < MIN_BRIEF_CHARS) {
    // The screen disables the button on the same rule before anyone can get here; the rule is
    // repeated rather than assumed, because a plan drawn from three lines of email would be
    // invention. This is the route's own sentence — the screen's line names the notice, because
    // there the reader can see which text is the brief; here all that is known is that it is short.
    return bad('the brief is too short to plan from — add the brief')
  }

  let guide
  try {
    guide = await researchTakeHome({
      company: app.company,
      role: app.role,
      parsed: app.parsed,
      brief: brief.text,
      plannedFrom: brief.identity,
      // The posting's host is classified as posting, as the map does.
      sourceUrl: app.sourceUrl,
    })
  } catch (error) {
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, planFailed: true }, { status: 422 })
    }
    throw error
  }

  const fresh = await getInterview(user.uid, id, rid)
  if (!fresh) return bad('not found', 404)
  if (briefInUse(fresh).identity !== brief.identity) {
    return bad('the brief changed while the plan was being drawn — plan again', 409)
  }

  // The identity matched, so `fresh.assignment` is the very assignment this was drawn from.
  const takeHome =
    fresh.assignment?.source === 'pdf'
      ? { ...guide, caveats: [...guide.caveats, PDF_CAVEAT] }
      : guide
  await updateInterview(user.uid, id, rid, { takeHome })

  // Read back rather than composed, so the page replaces its copy with the round exactly as it
  // is stored — the same discipline the brief route and the logging route end on.
  const saved = await getInterview(user.uid, id, rid)
  if (!saved) return bad('not found', 404)
  return Response.json(saved)
}
