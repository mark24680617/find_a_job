import { runMockDebrief } from '@/ai/flows/mockDebrief'
import { runMockTurn } from '@/ai/flows/mockTurn'
import { FlowOutputError } from '@/ai/genkit'
import { describeStage } from '@/ai/prompts/mockTurn'
import type { MockTurnOut } from '@/ai/schemas'
import { requireUser } from '@/lib/auth'
import { getApplication, getInterview, getProfile, listInterviews, updateInterview } from '@/lib/db'
import {
  CLOSING_LINE,
  MAX_ANSWER_CHARS,
  MAX_QUESTIONS,
  placeRound,
  practiceMode,
  reportedQuestions,
} from '@/lib/practice'
import { roleFamily } from '@/lib/research/roleFamily'
import type {
  InterviewRound,
  MockDebrief,
  MockSession,
  MockTurn,
  ParsedJob,
  ProcessMap,
} from '@/lib/types'

// One mock round, as a session on the round record. Node runtime (the default): `@/lib/db`
// reaches Firestore through firebase-admin and the Genkit calls need it too; requireUser runs
// before either.
//
// Four actions on one endpoint, because they are four moves in one conversation and every one
// of them answers with the same thing — the round exactly as it is now, read back after the
// write, so the screen can redraw without a reload.
//
// The order inside `answer` is the contract, and it is the logging route's discipline again:
// the candidate's own words go down FIRST, unconditionally, before any model call. What they
// typed is theirs; an interviewer that cannot reply must not be able to lose it. That is why a
// 422 here still carries the round — their answer is in it.
//
// Two things are ours and never the model's. The six-question cap is counted here and the
// closing line is written here, so a model that wants to keep going cannot; and `factsChecked`
// is counted here, because the debrief screen says "nothing you said could be checked" only
// when the bank really was empty at this moment.

/** How many earlier questions a new session is told to avoid re-asking (spec §5.5). */
const PREVIOUS_QUESTIONS = 30

type Ctx = { params: Promise<{ id: string; rid: string }> }

/**
 * Everything the four actions share, resolved once by POST. `parsed` travels separately from
 * the application because it is the one field they all require and the guard has already
 * proved it is there.
 */
interface MockContext {
  uid: string
  appId: string
  rid: string
  role: string
  parsed: ParsedJob
  round: InterviewRound
  map: ProcessMap | undefined
  body: Record<string, unknown>
}

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })

const now = (): string => new Date().toISOString()

/** The round as it is stored — what every successful action answers with. */
async function answered(c: MockContext): Promise<Response> {
  const round = await getInterview(c.uid, c.appId, c.rid)
  if (!round) return bad('not found', 404)
  return Response.json(round)
}

/** The model's turn as it is stored. A citation the guard dropped is absent, never null. */
function modelTurn(out: MockTurnOut, at: string): MockTurn {
  return {
    role: 'model',
    text: out.say,
    kind: out.kind,
    ...(out.sourceId ? { sourceId: out.sourceId } : {}),
    at,
  }
}

/** The session `answer` and `end` both need, or the 400 that says why there isn't one. */
function openSession(c: MockContext): MockSession | Response {
  const mock = c.round.mock
  if (!mock) return bad('there is no mock running — start one first')
  if (mock.status !== 'open') return bad('this mock is already debriefed — start over for a new one')
  return mock
}

/**
 * `answer`, `end` and `added` each carry the session they think they are in. A token that is
 * not the stored one is a tab looking at a mock that has since been restarted — writing what
 * was typed against the old session into the new one is the one thing this must not do, so it
 * is a 409 and the screen offers a reload rather than silently merging two conversations.
 */
function tokenMismatch(c: MockContext, mock: MockSession): Response | null {
  return c.body.session === mock.startedAt
    ? null
    : bad('this mock was restarted elsewhere — reload the round', 409)
}

/**
 * The same question again, after the model call. `tokenMismatch` only asks it on the way in,
 * and a turn spends ten seconds inside the model and a debrief thirty — long enough for another
 * tab's **Start over** to land in between. The write that follows was composed from the record
 * as it was before that: it would put this session's reply on top of the new session's
 * transcript, or restore the session that was replaced, and no later 409 would fire for it,
 * because the write itself is what makes the record incoherent. One read, on a path that has
 * just spent seconds waiting, buys the same refusal the entry check gives.
 */
async function restartedDuring(c: MockContext, mock: MockSession): Promise<Response | null> {
  const round = await getInterview(c.uid, c.appId, c.rid)
  return round?.mock?.startedAt === mock.startedAt
    ? null
    : bad('this mock was restarted elsewhere — reload the round', 409)
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const parsedBody: unknown = await req.json().catch(() => null)
  const body = (parsedBody as Record<string, unknown> | null) ?? {}

  const { id, rid } = await ctx.params
  const [app, round] = await Promise.all([
    getApplication(user.uid, id),
    getInterview(user.uid, id, rid),
  ])
  if (!app || !round) return bad('not found', 404)
  // Every action, `added` among them. Three of them end in a prompt built around the posting —
  // without it there is no company to be interviewed by, only a round type — and a round under
  // an uninterpreted posting has no mock for `added` to mark a claim on. Refused rather than run
  // against a blank, the same way the logging route refuses to write a brief for an
  // uninterpreted posting.
  if (!app.parsed) return bad('interpret the posting before starting a mock')

  const c: MockContext = {
    uid: user.uid,
    appId: id,
    rid,
    role: app.role,
    parsed: app.parsed,
    round,
    map: app.process,
    body,
  }

  switch (body.action) {
    case 'start':
      return start(c)
    case 'answer':
      return answer(c)
    case 'end':
      return end(c)
    case 'added':
      return added(c)
    default:
      return bad('action must be start, answer, end or added')
  }
}

/**
 * A new session, at any time — this is "Start over" as well as the first one. The stage is
 * decided here and then stored: a round logged into this application while the mock runs must
 * not move the interviewer to a different stage mid-conversation.
 */
async function start(c: MockContext): Promise<Response> {
  const rounds = c.map ? await listInterviews(c.uid, c.appId) : []
  const placement = c.map ? placeRound(c.round, rounds, c.map) : null
  // Off the loop, or with no loop at all, the round's own type is the best the mode has to go
  // on — which is exactly what the notice said this round was.
  const mode = practiceMode(placement?.stage.kind ?? c.round.roundType, roleFamily(c.role))

  // What has already been asked, newest first: this transcript's questions ahead of the list
  // the session before it was carrying. The list accumulates across restarts, so a fourth
  // session still knows what the first one asked.
  const previousQuestions = [
    ...c.round.chat
      .filter((t) => t.role === 'model' && t.kind === 'question')
      .map((t) => t.text)
      .reverse(),
    ...(c.round.mock?.previousQuestions ?? []),
  ].slice(0, PREVIOUS_QUESTIONS)

  const session: MockSession = {
    mode,
    // Omitted rather than written as undefined: the record then says what it means — this
    // session has no stage, either because the round is not on the loop or because there is
    // no loop to be on. `describeStage` reads the difference and tells the interviewer which.
    ...(placement ? { stageOrder: placement.stage.order } : {}),
    ...(c.map ? { researchedAt: c.map.researchedAt } : {}),
    startedAt: now(),
    questionsAsked: 1,
    status: 'open',
    previousQuestions,
  }

  const profile = await getProfile(c.uid)
  let out: MockTurnOut
  try {
    out = await runMockTurn({
      parsed: c.parsed,
      stageSummary: describeStage(c.round.roundType, session, c.map),
      // From the map as it is now, always — only the stage is frozen for the session.
      reported: c.map ? reportedQuestions(c.map) : [],
      facts: profile.facts,
      mode,
      // None yet: the session stores 1 because it is about to have asked one.
      questionsAsked: 0,
      previousQuestions,
      transcript: [],
    })
  } catch (error) {
    if (error instanceof FlowOutputError) {
      // Nothing is written, which is the point: a session whose first question the model could
      // not write is not a session, and the previous one — transcript, debrief and all —
      // still stands on the record the response carries back.
      return Response.json({ error: error.message, turnFailed: true, round: c.round }, { status: 422 })
    }
    throw error
  }

  // One write. A transcript with a question in it and no session, or a session with an empty
  // transcript, is a state the screen has no way to read.
  await updateInterview(c.uid, c.appId, c.rid, { chat: [modelTurn(out, now())], mock: session })
  return answered(c)
}

async function answer(c: MockContext): Promise<Response> {
  const mock = openSession(c)
  if (mock instanceof Response) return mock
  const mismatch = tokenMismatch(c, mock)
  if (mismatch) return mismatch

  if (c.body.text !== undefined && typeof c.body.text !== 'string') return bad('an answer is text')
  const text = c.body.text as string | undefined
  const last = c.round.chat.at(-1)

  if (text === undefined) {
    // The retry after a turn the model could not write: their answer is already the last thing
    // in the transcript, so this asks the interviewer again and appends nothing.
    if (last?.role !== 'user') return bad('there is nothing to retry — write an answer')
  } else {
    if (last?.kind === 'closing') return bad('the mock is over — end it for the feedback')
    if (last?.role !== 'model') return bad('the interviewer has not replied yet — try again for the next question')
    if (text.trim() === '') return bad('write an answer before sending it')
    if (text.length > MAX_ANSWER_CHARS) return bad(`an answer is at most ${MAX_ANSWER_CHARS} characters`)
  }

  // Their words, first, on their own write.
  let chat = c.round.chat
  if (text !== undefined) {
    const spoken: MockTurn = { role: 'user', text, at: now() }
    chat = [...chat, spoken]
    await updateInterview(c.uid, c.appId, c.rid, { chat })
  }

  if (mock.questionsAsked >= MAX_QUESTIONS) {
    // The cap is enforced here and the line that ends the mock is written here, so the model
    // is never in a position to ask a seventh question or to decide the round is over.
    const closing: MockTurn = { role: 'model', text: CLOSING_LINE, kind: 'closing', at: now() }
    await updateInterview(c.uid, c.appId, c.rid, { chat: [...chat, closing] })
    return answered(c)
  }

  const profile = await getProfile(c.uid)
  let out: MockTurnOut
  try {
    out = await runMockTurn({
      parsed: c.parsed,
      stageSummary: describeStage(c.round.roundType, mock, c.map),
      reported: c.map ? reportedQuestions(c.map) : [],
      facts: profile.facts,
      mode: mock.mode,
      questionsAsked: mock.questionsAsked,
      previousQuestions: mock.previousQuestions,
      transcript: chat,
    })
  } catch (error) {
    if (error instanceof FlowOutputError) {
      // Their turn is already stored; the response carries the record as it now is so the
      // screen can offer "Try again" against the answer they can still see.
      const round = (await getInterview(c.uid, c.appId, c.rid)) ?? { ...c.round, chat }
      return Response.json({ error: error.message, turnFailed: true, round }, { status: 422 })
    }
    throw error
  }

  const restarted = await restartedDuring(c, mock)
  if (restarted) return restarted

  const turn = modelTurn(out, now())
  await updateInterview(c.uid, c.appId, c.rid, {
    chat: [...chat, turn],
    // A follow-up is the same question, still being asked. Only a new question moves the count
    // — which is what keeps six questions six, however many follow-ups they take.
    ...(turn.kind === 'question' ? { mock: { ...mock, questionsAsked: mock.questionsAsked + 1 } } : {}),
  })
  return answered(c)
}

async function end(c: MockContext): Promise<Response> {
  const mock = openSession(c)
  if (mock instanceof Response) return mock
  const mismatch = tokenMismatch(c, mock)
  if (mismatch) return mismatch
  // A debrief of a conversation nobody spoke in would be a paragraph about silence.
  if (!c.round.chat.some((t) => t.role === 'user')) {
    return bad('answer at least one question before ending the mock')
  }

  const profile = await getProfile(c.uid)
  let out
  try {
    out = await runMockDebrief({
      parsed: c.parsed,
      stageSummary: describeStage(c.round.roundType, mock, c.map),
      mode: mock.mode,
      facts: profile.facts,
      transcript: c.round.chat,
    })
  } catch (error) {
    if (error instanceof FlowOutputError) {
      // The session stays open: the transcript is still theirs to end again, or to go on with.
      return Response.json({ error: error.message, debriefFailed: true, round: c.round }, { status: 422 })
    }
    throw error
  }

  const restarted = await restartedDuring(c, mock)
  if (restarted) return restarted

  // `code` is null outside coding mode and the stored shape says so by omission. `factsChecked`
  // is counted here rather than asked of the model: the panel's empty-bank wording turns on it,
  // and "how many facts was I given" is not a judgment.
  const { code, ...rest } = out
  const debrief: MockDebrief = {
    ...rest,
    ...(code ? { code } : {}),
    factsChecked: profile.facts.length,
  }
  await updateInterview(c.uid, c.appId, c.rid, {
    mock: { ...mock, status: 'debriefed', debrief, debriefedAt: now() },
  })
  return answered(c)
}

async function added(c: MockContext): Promise<Response> {
  const mock = c.round.mock
  if (!mock || mock.status !== 'debriefed' || !mock.debrief) {
    return bad('there is no feedback to add a claim from')
  }
  const mismatch = tokenMismatch(c, mock)
  if (mismatch) return mismatch
  const said = c.body.said
  if (typeof said !== 'string' || said === '') return bad('say which sentence reached the fact bank')

  // Every item quoting this sentence, across every answer: the claim is in the bank now, so an
  // identical sentence flagged under another question is not unsupported any more either, and
  // leaving it amber would tell the candidate to add what they have just added.
  let marked = 0
  const answers = mock.debrief.answers.map((a) => ({
    ...a,
    unsupported: a.unsupported.map((u) => {
      if (u.said !== said) return u
      marked += 1
      return { ...u, added: true }
    }),
  }))
  if (marked === 0) return bad('that sentence is not one this feedback flagged')

  await updateInterview(c.uid, c.appId, c.rid, {
    mock: { ...mock, debrief: { ...mock.debrief, answers } },
  })
  return answered(c)
}
