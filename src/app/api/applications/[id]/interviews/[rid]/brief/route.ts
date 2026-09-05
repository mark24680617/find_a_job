import { runPrepBrief } from '@/ai/flows/prepBrief'
import { FlowOutputError } from '@/ai/genkit'
import { requireUser } from '@/lib/auth'
import {
  getApplication,
  getInterview,
  getProfile,
  listInterviews,
  updateInterview,
} from '@/lib/db'
import { placeRound, reportedQuestions } from '@/lib/practice'
import type { PrepBrief } from '@/lib/types'

// Rewrite one round's brief, on demand. A round is born with a brief written from the posting
// and the candidate's facts; once the loop has been researched there is more to write it from
// — the stage this round maps to, and the questions people report being asked here — and a
// round logged before the research would otherwise keep the thinner brief forever.
// Node runtime (the default): `@/lib/db` reaches Firestore through firebase-admin and the
// Genkit call needs it too; requireUser runs before either.
//
// The brief is composed exactly as the logging route composes it — the same flow, the same
// verbatim guard on the rehearsal lines, the same `basis` — and the two are meant to be read
// together. What differs is what a failure costs: at logging the round has just been written
// and a brief that cannot be written is reported beside it; here there is a brief on the
// screen already, so a failure writes nothing and leaves it standing.
//
// Idempotent, and it replaces the brief whole rather than merging into it: a brief is one
// judgment about one round, and half an old one beside half a new one is neither.

type Ctx = { params: Promise<{ id: string; rid: string }> }

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id, rid } = await ctx.params
  // Both before the model call: the brief is written FOR this posting and stored ON this
  // round, and neither is worth a model call spent on a record that is not there.
  const [app, round] = await Promise.all([
    getApplication(user.uid, id),
    getInterview(user.uid, id, rid),
  ])
  if (!app || !round) return Response.json({ error: 'not found' }, { status: 404 })
  // The same refusal logging makes: the topics, the questions to ask and the red flags all come
  // out of the parsed posting, so without one there is no company to prepare for.
  if (!app.parsed) {
    return Response.json({ error: 'interpret the posting before writing a brief' }, { status: 400 })
  }

  const [profile, rounds] = await Promise.all([
    getProfile(user.uid),
    listInterviews(user.uid, id),
  ])
  // Which stage this round claims is decided against every round logged under the application,
  // not this one alone — two rounds of the same kind take the first and second stage of that
  // kind in the order they were booked.
  const placement = app.process ? placeRound(round, rounds, app.process) : null
  // Handed over whenever there is a map, placed or not: a question somebody was actually asked
  // at this company is worth reading even when we could not say which stage this round is.
  const reported = app.process ? reportedQuestions(app.process) : undefined

  let written
  try {
    written = await runPrepBrief({
      roundType: round.roundType,
      parsed: app.parsed,
      facts: profile.facts,
      stage: placement ?? undefined,
      reported,
    })
  } catch (error) {
    // Nothing has been written, so the brief they clicked from is still the brief they have.
    // 422 with the flow's own message, the way every other flow failure in this product reaches
    // the wire — a 500 would lose the one account of what went wrong.
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, briefFailed: true }, { status: 422 })
    }
    throw error
  }

  // The same guard the logging route applies, for the same reason: a rehearsal line that is not
  // one of the candidate's own claims is a sentence the model composed for them to say out loud
  // in an interview, which is the one thing this product may never hand anybody. Asked for in
  // the prompt, enforced here. Dropped rather than retried — the section renders shorter.
  const claims = new Set(profile.facts.map((f) => f.claim.trim()))
  // Annotated for the reason the logging route's copy is: composed into a variable, this loses
  // excess property checking, and a misspelled key would be written beside the right one.
  const prepBrief: PrepBrief = {
    ...written,
    factsToRehearse: written.factsToRehearse.filter((line) => claims.has(line.trim())),
    // What this brief was written from. `stageOrder: null` says the map existed and this round
    // is not on the reported loop; no `basis` at all says there was no map to read.
    ...(app.process
      ? {
          basis: {
            stageOrder: placement?.stage.order ?? null,
            researchedAt: app.process.researchedAt,
          },
        }
      : {}),
  }
  await updateInterview(user.uid, id, rid, { prepBrief })

  // Read back rather than composed, so the page replaces its copy with the round exactly as it
  // is stored — the same discipline the logging route ends on.
  const fresh = await getInterview(user.uid, id, rid)
  if (!fresh) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(fresh)
}
