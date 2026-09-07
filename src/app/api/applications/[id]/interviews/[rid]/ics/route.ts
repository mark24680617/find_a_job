import { requireUser } from '@/lib/auth'
import { getApplication, getInterview } from '@/lib/db'
import { buildIcs } from '@/lib/ics'
import { ROUND_LABEL } from '@/lib/rounds'

// One interview round as a calendar file. The event is written to be read on a phone, away
// from this app, so it carries the role and the interviewers rather than a link back here.
// Node runtime (the default): `@/lib/db` reaches Firestore through firebase-admin.

/** No notice ever says how long it runs; an hour is the round most of them turn out to be. */
const DEFAULT_MINUTES = 60

type Ctx = { params: Promise<{ id: string; rid: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id, rid } = await ctx.params
  const [app, round] = await Promise.all([
    getApplication(user.uid, id),
    getInterview(user.uid, id, rid),
  ])
  if (!app || !round) return Response.json({ error: 'not found' }, { status: 404 })

  // A round whose notice never yielded a time — or yielded something unparseable — has
  // nothing to put in a calendar. Saying so is a 400: the record exists, the export doesn't.
  if (!round.datetime || Number.isNaN(Date.parse(round.datetime))) {
    return Response.json({ error: 'this round has no scheduled time yet' }, { status: 400 })
  }

  // A take-home's `datetime` is a deadline, not a meeting: nothing happens at it, everything is
  // due by it. So the event is the hour that ENDS there — `DEFAULT_MINUTES` before it, for
  // exactly `DEFAULT_MINUTES` — which keeps the two tied together, and keeps a deadline stated
  // as a date alone (23:59, spec §3.1) off the following day's page.
  const takeHome = round.roundType === 'take-home'
  const due = Date.parse(round.datetime)

  const ics = buildIcs({
    // The round's own id, so a re-export after a reschedule or a changed interviewer list
    // replaces the calendar entry instead of leaving the old time beside the new one.
    uid: `${rid}@find-a-job`,
    title: takeHome
      ? `Take-home due — ${app.company}`
      : `${ROUND_LABEL[round.roundType]} — ${app.company}`,
    startIso: takeHome ? new Date(due - DEFAULT_MINUTES * 60_000).toISOString() : round.datetime,
    durationMin: DEFAULT_MINUTES,
    description: [
      `${app.company} — ${app.role}`,
      round.people.length ? `With ${round.people.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  })

  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="interview.ics"',
    },
  })
}
