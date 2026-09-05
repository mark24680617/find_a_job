import { runInterviewInterpret } from '@/ai/flows/interviewInterpret'
import { runPrepBrief } from '@/ai/flows/prepBrief'
import { FlowOutputError } from '@/ai/genkit'
import { requireUser } from '@/lib/auth'
import {
  createInterview,
  getApplication,
  getInterview,
  getProfile,
  listInterviews,
  updateApplication,
  updateInterview,
} from '@/lib/db'
import { placeRound, reportedQuestions } from '@/lib/practice'
import type { AppStatus, Application, InterviewRound, PrepBrief } from '@/lib/types'

// The rounds recorded under one application. GET lists them; POST takes the scheduling notice
// as it arrived — an email, pasted whole — and turns it into a round with a prep brief on it.
// Node runtime (the default): `@/lib/db` reaches Firestore through firebase-admin and the
// Genkit calls need it too; requireUser runs before either.
//
// The order below is the contract, and it is the same discipline the finalize route follows:
// the human's own data goes down FIRST and unconditionally. The notice they pasted becomes a
// round before the second model call is made, so a brief the model cannot write costs them a
// brief and not the round — an interview they have booked is a fact about their week, and no
// failure of ours gets to lose it.

/** The statuses a logged round moves forward; 'offer' and 'rejected' are past this point. */
const ADVANCES_TO_INTERVIEWING = new Set<AppStatus>(['draft', 'applied', 'interviewing'])

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  return Response.json(await listInterviews(user.uid, id))
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const body: unknown = await req.json().catch(() => null)
  const noticeText = (body as Record<string, unknown> | null)?.noticeText
  if (typeof noticeText !== 'string' || noticeText.trim() === '') {
    return Response.json({ error: 'paste the interview notice first' }, { status: 400 })
  }

  const { id } = await ctx.params
  // Read before the model calls: a round is written under this application, and the brief is
  // written FOR the posting. Neither is worth a model call spent on a record that is not there.
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })
  // The brief's topics, its questions-to-ask and its red flags all come out of the parsed
  // posting. Without it there is no company to prepare for, only a round type — so this is
  // refused rather than run against a blank.
  if (!app.parsed) {
    return Response.json({ error: 'interpret the posting before logging a round' }, { status: 400 })
  }

  let out
  try {
    out = await runInterviewInterpret({ noticeText })
  } catch (error) {
    // The model could not read the notice into the shape the record needs. Nothing has been
    // written, so this is the one failure here that ends the request: 422, with the flow's own
    // message, so the UI can say what happened rather than showing a 500.
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, interviewFailed: true }, { status: 422 })
    }
    throw error
  }

  // `datetime` is omitted rather than written as undefined when the notice never stated a
  // time. Firestore is configured to ignore undefined properties, so both would store the
  // same thing — but the record then says what it means: this round has no time on it yet,
  // which is exactly what the strip and the .ics export check for.
  const rid = await createInterview(user.uid, id, {
    noticeRaw: noticeText,
    roundType: out.roundType,
    ...(out.datetime ? { datetime: out.datetime } : {}),
    people: out.people,
    // Kept on the record, not merely returned: what the notice does not say is a first-class
    // thing to display, and it has to still be there tomorrow.
    askHuman: out.askHuman,
    chat: [],
  } satisfies Omit<InterviewRound, 'id' | 'createdAt'>)

  // From here the round is safe. The brief is the machine's optional extra: a FlowOutputError
  // is caught and reported as `briefFailed`, so the round comes back either way. Anything else
  // — a Firestore outage, a bug — is not the human's to act on and goes up as a 500, with the
  // round already written.
  let briefFailed = false
  try {
    // `placeRound` settles which stage this round claims from the round as it is STORED — its
    // id and its createdAt are what break a tie between two rounds of the same kind — so it is
    // read back here, with the whole list beside it, rather than composed from `out`.
    const [profile, created, rounds] = await Promise.all([
      getProfile(user.uid),
      getInterview(user.uid, id, rid),
      listInterviews(user.uid, id),
    ])
    const placement = created && app.process ? placeRound(created, rounds, app.process) : null
    // Handed over whenever there is a map, placed or not: a question somebody was actually
    // asked at this company is worth reading even when we could not say which stage this is.
    const reported = app.process ? reportedQuestions(app.process) : undefined
    const written = await runPrepBrief({
      roundType: out.roundType,
      parsed: app.parsed,
      facts: profile.facts,
      stage: placement ?? undefined,
      reported,
    })
    // The prompt asks for the candidate's claims verbatim; this is where that stops being a
    // request and becomes a property of the record. A rehearsal line that is not one of their
    // claims is a sentence the model composed for them to say out loud in an interview, which
    // is the one thing this product may never hand anybody. Same discipline as the citation
    // guard: asked for in the prompt, enforced in code. Dropped rather than retried — the
    // brief is the optional half of this request, and the section simply renders shorter.
    const claims = new Set(profile.facts.map((f) => f.claim.trim()))
    // Annotated: composed into a variable rather than passed as a literal, this loses excess
    // property checking, and a misspelled key would be written to Firestore beside the right one.
    const prepBrief: PrepBrief = {
      ...written,
      factsToRehearse: written.factsToRehearse.filter((line) => claims.has(line.trim())),
      // What this brief was written from, so the round page can offer a rewrite once the map
      // is newer than the brief. `stageOrder: null` says the map existed and this round is not
      // on the reported loop; no `basis` at all says there was no map to read. Written by the
      // route and never by the model — it is a fact about this request, not a judgment.
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
  } catch (error) {
    if (!(error instanceof FlowOutputError)) throw error
    briefFailed = true
  }

  // Composed from a read taken AFTER the model calls, not from the copy above: `timeline` is
  // replaced whole by an update, and the two calls take tens of seconds — long enough for a
  // status change in another tab to land. Composing from the stale copy would revert it.
  const fresh = await getApplication(user.uid, id)
  if (fresh) {
    await updateApplication(user.uid, id, {
      // A record that has already reached an offer, or been rejected, is further along than
      // this — a round logged against it (the final loop, a re-interview after a no) must not
      // drag it back a column. The event is written either way: it happened.
      ...(ADVANCES_TO_INTERVIEWING.has(fresh.status) ? { status: 'interviewing' as const } : {}),
      timeline: [
        ...fresh.timeline,
        { event: `interview round added: ${out.roundType}`, at: new Date().toISOString() },
      ],
    } satisfies Partial<Application>)
  }

  // Read back rather than composed, so the client gets the round exactly as it is stored —
  // `createdAt` and all, which is what the list is ordered by.
  const round = await getInterview(user.uid, id, rid)
  if (!round) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(briefFailed ? { round, briefFailed } : { round })
}
