import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockDebriefInput } from '@/ai/flows/mockDebrief'
import type { MockTurnInput } from '@/ai/flows/mockTurn'
import { FlowOutputError } from '@/ai/genkit'
import { CLOSING_LINE, MAX_ANSWER_CHARS, MAX_QUESTIONS } from '@/lib/practice'
import type {
  Application,
  CommunityGuide,
  Fact,
  InterviewRound,
  MockSession,
  MockTurn,
  ProcessMap,
  Profile,
  ResearchSource,
} from '@/lib/types'

// The handler with the database, the auth guard and the two flows faked: no Admin SDK, no
// model calls. `describeStage`, `placeRound`, `practiceMode` and `reportedQuestions` are the
// real ones — they are pure, and what this route is FOR is handing them the right inputs.
//
// What is under test is the session contract: the candidate's words are written before any
// model call, the stage is frozen at `start` while the question list is not, the six-question
// cap is ours and not the model's, and a stale tab cannot write into a session it is not
// looking at.

const {
  requireUser,
  getApplication,
  getInterview,
  getProfile,
  listInterviews,
  updateInterview,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  getInterview: vi.fn(),
  getProfile: vi.fn(),
  listInterviews: vi.fn(),
  updateInterview: vi.fn(),
}))
const { runMockTurn, runMockDebrief } = vi.hoisted(() => ({
  runMockTurn: vi.fn(),
  runMockDebrief: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, getInterview, getProfile, listInterviews, updateInterview }))
vi.mock('@/ai/flows/mockTurn', () => ({ runMockTurn }))
vi.mock('@/ai/flows/mockDebrief', () => ({ runMockDebrief }))

import { POST } from '@/app/api/applications/[id]/interviews/[rid]/mock/route'

const RESEARCHED_AT = '2026-09-01T00:00:00.000Z'
const STARTED = '2026-09-03T12:00:00.000Z'

const source: ResearchSource = {
  id: 's1',
  title: 'My Marram loop, start to finish',
  url: 'https://www.reddit.com/r/cscareerquestions/comments/1/marram/',
  host: 'reddit.com',
  kind: 'community',
  snippet: 'Three rounds.',
  fetched: true,
}

const guide = (questionsReported: string[]): CommunityGuide => ({
  sourceId: 's1',
  takeaways: [],
  questionsReported,
  quotes: [],
  stale: false,
  firstHand: true,
})

const map = (over: Partial<ProcessMap> = {}): ProcessMap => ({
  stages: [
    { order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', whatItProbes: 'Fit and money.', tips: [], sourceIds: ['s1'], confidence: 'community' },
    { order: 2, name: 'Technical screen', kind: 'technical', format: 'video', duration: '60 minutes', whatItProbes: 'Code on a shared editor.', tips: ['Think out loud.'], sourceIds: ['s1'], confidence: 'community' },
    { order: 3, name: 'Onsite', kind: 'onsite', format: 'onsite', whatItProbes: 'The team.', tips: [], sourceIds: ['s1'], confidence: 'community' },
  ],
  takeHome: { present: 'no', description: '', tips: [], sourceIds: [] },
  sources: [source],
  guides: [guide(['Walk me through a system you owned.'])],
  askRecruiter: [],
  caveats: [],
  grounded: true,
  researchedAt: RESEARCHED_AT,
  ...over,
})

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'a posting',
  adapter: 'manual',
  parsed: {
    company: 'Marram Systems',
    role: 'Senior Backend Engineer',
    roleFacts: ['Owns the ledger write path'],
    gates: [],
    themes: ['payments'],
    scope: 'per-application',
    advisory: '',
  },
  process: map(),
  questions: [],
  status: 'interviewing',
  timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }],
  createdAt: '2026-08-20T09:00:00.000Z',
  ...over,
})

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r-1',
  noticeRaw: 'A 60-minute technical screen next Tuesday.',
  roundType: 'technical',
  people: [],
  chat: [],
  createdAt: '2026-08-29T10:00:00.000Z',
  ...over,
})

const session = (over: Partial<MockSession> = {}): MockSession => ({
  mode: 'coding',
  stageOrder: 2,
  researchedAt: RESEARCHED_AT,
  startedAt: STARTED,
  questionsAsked: 1,
  status: 'open',
  previousQuestions: [],
  ...over,
})

const ask = (text: string, kind: MockTurn['kind'] = 'question'): MockTurn => ({
  role: 'model',
  text,
  kind,
  at: '2026-09-03T12:00:00.000Z',
})
const said = (text: string): MockTurn => ({ role: 'user', text, at: '2026-09-03T12:01:00.000Z' })
const closingTurn: MockTurn = { role: 'model', text: CLOSING_LINE, kind: 'closing', at: '2026-09-03T12:30:00.000Z' }

const FACTS: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service', sourceSnippet: 'Owns the payments service', tags: ['payments'] },
  { id: 'f2', claim: 'Cut p99 latency to 120ms', sourceSnippet: 'p99 down to 120ms', tags: ['latency'] },
]
const profile: Profile = { facts: FACTS, standardAnswers: {}, voiceRules: [], gaps: [] }

// Two answers flagging the same sentence, so `added` has something to mark in both places.
const DEBRIEF_OUT = {
  overall: 'You told the ledger story clearly and lost time on the trade-offs.',
  answers: [
    {
      question: 'Walk me through a system you owned.',
      landed: ['Named the write path and who depended on it'],
      vague: ['No number on the throughput'],
      unsupported: [{ said: 'I led a team of twelve.', why: 'No fact says how many people you led.' }],
    },
    {
      question: 'What broke, and what did you do about it?',
      landed: [],
      vague: [],
      unsupported: [
        { said: 'I led a team of twelve.', why: 'The same claim, told again.' },
        { said: 'I owned a fleet of brokers.', why: 'No fact mentions brokers.' },
      ],
    },
  ],
  code: { strengths: ['The loop is easy to follow'], gaps: ['No empty-input case'] },
  rehearse: ['Owns a payments service'],
}

const debriefed = (): InterviewRound =>
  round({
    chat: [ask('Walk me through a system you owned.'), said('I led a team of twelve. I owned a fleet of brokers.')],
    mock: session({
      status: 'debriefed',
      debrief: { ...DEBRIEF_OUT, factsChecked: 2 },
      debriefedAt: '2026-09-03T12:40:00.000Z',
    }),
  })

const post = (body: unknown) =>
  POST(
    new Request('https://example.test/api/applications/app-1/interviews/r-1/mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'app-1', rid: 'r-1' }) },
  )

// The stored round, mutated by the writes, so a read-back answers what was actually written.
let stored: InterviewRound

beforeEach(() => {
  vi.resetAllMocks()
  stored = round()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockImplementation(async () => application())
  getInterview.mockImplementation(async () => stored)
  listInterviews.mockImplementation(async () => [stored])
  getProfile.mockResolvedValue(profile)
  updateInterview.mockImplementation(
    async (_uid: string, _appId: string, _rid: string, patch: Partial<InterviewRound>) => {
      stored = { ...stored, ...patch }
    },
  )
  runMockTurn.mockResolvedValue({ say: 'Walk me through a system you owned.', sourceId: 's1', kind: 'question' })
  runMockDebrief.mockResolvedValue(DEBRIEF_OUT)
})

describe('POST /api/applications/[id]/interviews/[rid]/mock — the guards', () => {
  it('returns the auth guard verbatim and never reads or writes anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post({ action: 'start' })).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runMockTurn).not.toHaveBeenCalled()
  })

  it('is a 404 when the application or the round is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    expect((await post({ action: 'start' })).status).toBe(404)

    getApplication.mockImplementation(async () => application())
    getInterview.mockResolvedValue(null)
    expect((await post({ action: 'start' })).status).toBe(404)
    expect(runMockTurn).not.toHaveBeenCalled()
  })

  it('refuses a posting that was never interpreted — there is no company to interview for', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    const res = await post({ action: 'start' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/interpret the posting/i) })
    expect(runMockTurn).not.toHaveBeenCalled()
  })

  it('refuses an action it does not know', async () => {
    const res = await post({ action: 'restart' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/start, answer, end or added/) })
    expect(updateInterview).not.toHaveBeenCalled()
  })
})

describe('POST …/mock — start', () => {
  it('writes the first question and the session it belongs to in one write', async () => {
    const res = await post({ action: 'start' })
    expect(res.status).toBe(200)

    expect(updateInterview).toHaveBeenCalledTimes(1)
    const patch = updateInterview.mock.calls[0][3] as Partial<InterviewRound>
    expect(patch.chat).toEqual([
      {
        role: 'model',
        text: 'Walk me through a system you owned.',
        kind: 'question',
        sourceId: 's1',
        at: expect.any(String),
      },
    ])
    expect(patch.mock).toMatchObject({
      mode: 'coding',
      stageOrder: 2,
      researchedAt: RESEARCHED_AT,
      questionsAsked: 1,
      status: 'open',
      previousQuestions: [],
    })
    expect(patch.mock!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // Answered with the round as stored, read back after the write.
    await expect(res.json()).resolves.toMatchObject({ id: 'r-1', mock: { status: 'open' } })
  })

  it('runs the first turn against the placed stage, the mode and the map as it is now', async () => {
    await post({ action: 'start' })
    const input = runMockTurn.mock.calls[0][0] as MockTurnInput
    expect(input.parsed).toEqual(application().parsed)
    expect(input.mode).toBe('coding')
    expect(input.questionsAsked).toBe(0)
    expect(input.transcript).toEqual([])
    expect(input.previousQuestions).toEqual([])
    expect(input.facts).toEqual(FACTS)
    expect(input.stageSummary).toContain('Stage 2 of 3: Technical screen')
    expect(input.reported.map((r) => r.text)).toEqual(['Walk me through a system you owned.'])
    expect(input.reported[0].sourceId).toBe('s1')
  })

  it('carries the questions of earlier sessions forward, newest first', async () => {
    // A third session: this transcript's questions ahead of the two the session before it was
    // already carrying. Follow-ups are not questions and do not join the list.
    stored = round({
      chat: [ask('Q3a'), said('…'), ask('Q3b', 'follow-up'), said('…'), ask('Q3c')],
      mock: session({ previousQuestions: ['Q2', 'Q1'] }),
    })
    await post({ action: 'start' })

    const patch = updateInterview.mock.calls[0][3] as Partial<InterviewRound>
    expect(patch.mock!.previousQuestions).toEqual(['Q3c', 'Q3a', 'Q2', 'Q1'])
    expect((runMockTurn.mock.calls[0][0] as MockTurnInput).previousQuestions).toEqual(['Q3c', 'Q3a', 'Q2', 'Q1'])
    // The transcript starts over; only the questions survive.
    expect(patch.chat).toHaveLength(1)
  })

  it('keeps at most thirty carried questions', async () => {
    stored = round({
      chat: [ask('newest')],
      mock: session({ previousQuestions: Array.from({ length: 40 }, (_, i) => `old${i}`) }),
    })
    await post({ action: 'start' })
    const carried = (updateInterview.mock.calls[0][3] as Partial<InterviewRound>).mock!.previousQuestions
    expect(carried).toHaveLength(30)
    expect(carried[0]).toBe('newest')
    expect(carried[29]).toBe('old28')
  })

  it('writes nothing when the interviewer cannot ask a first question, and answers with the round', async () => {
    runMockTurn.mockRejectedValue(new FlowOutputError('say: required'))
    const res = await post({ action: 'start' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'say: required', turnFailed: true, round: round() })
    expect(updateInterview).not.toHaveBeenCalled()
  })
})

describe('POST …/mock — answer', () => {
  it('refuses a session token that is not the stored one', async () => {
    stored = round({ chat: [ask('Q1')], mock: session() })
    const res = await post({ action: 'answer', text: 'An answer.', session: '2026-09-03T09:00:00.000Z' })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/restarted/) })
    expect(updateInterview).not.toHaveBeenCalled()
    expect(runMockTurn).not.toHaveBeenCalled()
  })

  it('refuses the reply when a start landed while the interviewer was thinking', async () => {
    // The token is checked on the way in and the model then takes ten seconds. A **Start over**
    // landing inside that window leaves the reply composed against a session that no longer
    // exists: writing it would drop this transcript's tail on top of the new one, and no later
    // request would ever see a token to disagree with.
    stored = round({ chat: [ask('Q1')], mock: session() })
    runMockTurn.mockImplementation(async () => {
      stored = round({
        chat: [ask('A brand new first question.')],
        mock: session({ startedAt: '2026-09-03T13:00:00.000Z' }),
      })
      return { say: 'And what did that cost?', sourceId: null, kind: 'follow-up' }
    })

    const res = await post({ action: 'answer', text: 'I owned the ledger write path.', session: STARTED })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/restarted/) })
    // Their turn went down before the model call, by design; the reply after it did not.
    expect(updateInterview).toHaveBeenCalledTimes(1)
    expect(stored.chat).toEqual([ask('A brand new first question.')])
  })

  it('refuses an answer whose preconditions do not hold, naming the one that failed', async () => {
    stored = round()
    let res = await post({ action: 'answer', text: 'An answer.', session: STARTED })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/no mock running/) })

    stored = round({ chat: [ask('Q1')], mock: session() })
    res = await post({ action: 'answer', text: '   ', session: STARTED })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/write an answer/) })

    stored = round({ chat: [ask('Q1'), said('An answer.')], mock: session({ status: 'debriefed' }) })
    res = await post({ action: 'answer', text: 'One more.', session: STARTED })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/already debriefed/) })

    expect(updateInterview).not.toHaveBeenCalled()
    expect(runMockTurn).not.toHaveBeenCalled()
  })

  it('writes the candidate’s turn before the interviewer is asked, and the reply after it', async () => {
    stored = round({ chat: [ask('Q1')], mock: session() })
    runMockTurn.mockResolvedValue({ say: 'And what did that cost?', sourceId: null, kind: 'follow-up' })

    const res = await post({ action: 'answer', text: 'I owned the ledger write path.', session: STARTED })
    expect(res.status).toBe(200)
    expect(updateInterview.mock.invocationCallOrder[0]).toBeLessThan(runMockTurn.mock.invocationCallOrder[0])

    const first = updateInterview.mock.calls[0][3] as Partial<InterviewRound>
    expect(first.chat!.at(-1)).toEqual({ role: 'user', text: 'I owned the ledger write path.', at: expect.any(String) })
    expect('mock' in first).toBe(false)

    // The model sees the answer it is replying to.
    expect((runMockTurn.mock.calls[0][0] as MockTurnInput).transcript).toHaveLength(2)

    const second = updateInterview.mock.calls[1][3] as Partial<InterviewRound>
    expect(second.chat!.at(-1)).toEqual({ role: 'model', text: 'And what did that cost?', kind: 'follow-up', at: expect.any(String) })
    // A follow-up is the same question still being asked: the count does not move.
    expect('mock' in second).toBe(false)
  })

  it('counts a new question, and stores an uncited turn without a sourceId', async () => {
    stored = round({ chat: [ask('Q1')], mock: session({ questionsAsked: 1 }) })
    runMockTurn.mockResolvedValue({ say: 'What did the rollback cost?', sourceId: null, kind: 'question' })

    await post({ action: 'answer', text: 'An answer.', session: STARTED })
    const patch = updateInterview.mock.calls[1][3] as Partial<InterviewRound>
    expect(patch.chat!.at(-1)).toEqual({ role: 'model', text: 'What did the rollback cost?', kind: 'question', at: expect.any(String) })
    expect(patch.mock).toMatchObject({ questionsAsked: 2, status: 'open', startedAt: STARTED })
  })

  it('keeps the candidate’s turn when the interviewer fails, and answers with the round as stored', async () => {
    stored = round({ chat: [ask('Q1')], mock: session() })
    runMockTurn.mockRejectedValue(new FlowOutputError('kind: required'))

    const res = await post({ action: 'answer', text: 'I owned the ledger write path.', session: STARTED })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; turnFailed: boolean; round: InterviewRound }
    expect(body).toMatchObject({ error: 'kind: required', turnFailed: true })
    expect(body.round.chat.at(-1)).toMatchObject({ role: 'user', text: 'I owned the ledger write path.' })
    expect(updateInterview).toHaveBeenCalledTimes(1)
  })

  it('retries without a new answer when the last turn is already the candidate’s', async () => {
    stored = round({ chat: [ask('Q1'), said('I owned the ledger write path.')], mock: session() })
    const res = await post({ action: 'answer', session: STARTED })

    expect(res.status).toBe(200)
    expect(runMockTurn).toHaveBeenCalledTimes(1)
    expect(updateInterview).toHaveBeenCalledTimes(1)
    const patch = updateInterview.mock.calls[0][3] as Partial<InterviewRound>
    expect(patch.chat!.filter((t) => t.role === 'user')).toHaveLength(1)
    expect(patch.chat!.at(-1)!.role).toBe('model')
    expect((runMockTurn.mock.calls[0][0] as MockTurnInput).transcript).toHaveLength(2)
  })

  it('closes the mock in code after the sixth question, with no model call', async () => {
    stored = round({ chat: [ask('Q6')], mock: session({ questionsAsked: MAX_QUESTIONS }) })
    const res = await post({ action: 'answer', text: 'My last answer.', session: STARTED })

    expect(res.status).toBe(200)
    expect(runMockTurn).not.toHaveBeenCalled()
    expect(updateInterview).toHaveBeenCalledTimes(2)
    const chat = ((await res.json()) as InterviewRound).chat
    expect(chat.at(-2)).toMatchObject({ role: 'user', text: 'My last answer.' })
    expect(chat.at(-1)).toEqual({ role: 'model', text: CLOSING_LINE, kind: 'closing', at: expect.any(String) })
  })

  it('refuses an answer after the closing line, in the words the screen shows', async () => {
    stored = round({ chat: [ask('Q6'), said('My last answer.'), closingTurn], mock: session({ questionsAsked: 6 }) })
    const res = await post({ action: 'answer', text: 'One more thing.', session: STARTED })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'the mock is over — end it for the feedback' })
    expect(updateInterview).not.toHaveBeenCalled()
  })

  it('refuses an answer over the cap before writing a word of it', async () => {
    stored = round({ chat: [ask('Q1')], mock: session() })
    const res = await post({ action: 'answer', text: 'x'.repeat(MAX_ANSWER_CHARS + 1), session: STARTED })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining(String(MAX_ANSWER_CHARS)) })
    expect(updateInterview).not.toHaveBeenCalled()
    expect(runMockTurn).not.toHaveBeenCalled()
  })
})

describe('POST …/mock — end', () => {
  it('refuses to end a mock nobody has answered', async () => {
    stored = round({ chat: [ask('Q1')], mock: session() })
    const res = await post({ action: 'end', session: STARTED })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/answer at least one/) })
    expect(runMockDebrief).not.toHaveBeenCalled()
  })

  it('writes the debrief with the size of the bank it was checked against', async () => {
    stored = round({ chat: [ask('Q1'), said('I led a team of twelve.')], mock: session() })
    const res = await post({ action: 'end', session: STARTED })
    expect(res.status).toBe(200)

    const patch = updateInterview.mock.calls[0][3] as Partial<InterviewRound>
    expect(patch.mock).toMatchObject({ status: 'debriefed', debriefedAt: expect.any(String), startedAt: STARTED })
    expect(patch.mock!.debrief).toEqual({ ...DEBRIEF_OUT, factsChecked: 2 })

    const input = runMockDebrief.mock.calls[0][0] as MockDebriefInput
    expect(input.mode).toBe('coding')
    expect(input.facts).toEqual(FACTS)
    expect(input.transcript).toHaveLength(2)
    expect(input.stageSummary).toContain('Stage 2 of 3: Technical screen')
  })

  it('leaves `code` off a debrief that has none', async () => {
    stored = round({ chat: [ask('Q1'), said('An answer.')], mock: session() })
    runMockDebrief.mockResolvedValue({ ...DEBRIEF_OUT, code: null })
    await post({ action: 'end', session: STARTED })

    const debrief = (updateInterview.mock.calls[0][3] as Partial<InterviewRound>).mock!.debrief!
    expect('code' in debrief).toBe(false)
    expect(debrief.factsChecked).toBe(2)
  })

  it('leaves the session open when the debrief cannot be written', async () => {
    stored = round({ chat: [ask('Q1'), said('An answer.')], mock: session() })
    runMockDebrief.mockRejectedValue(new FlowOutputError('overall: required'))

    const res = await post({ action: 'end', session: STARTED })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { debriefFailed: boolean; round: InterviewRound }
    expect(body.debriefFailed).toBe(true)
    expect(body.round.mock!.status).toBe('open')
    expect(updateInterview).not.toHaveBeenCalled()
  })

  it('refuses the debrief when a start landed while it was being written', async () => {
    // Thirty seconds is the longest window on this route, and the write at the end of it
    // replaces the whole session — a debrief of a conversation the candidate has just discarded.
    stored = round({ chat: [ask('Q1'), said('An answer.')], mock: session() })
    runMockDebrief.mockImplementation(async () => {
      stored = round({
        chat: [ask('A brand new first question.')],
        mock: session({ startedAt: '2026-09-03T13:00:00.000Z' }),
      })
      return DEBRIEF_OUT
    })

    const res = await post({ action: 'end', session: STARTED })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/restarted/) })
    expect(updateInterview).not.toHaveBeenCalled()
  })
})

describe('POST …/mock — added', () => {
  it('marks every item that quotes the same sentence, wherever it sits', async () => {
    stored = debriefed()
    const res = await post({ action: 'added', said: 'I led a team of twelve.', session: STARTED })
    expect(res.status).toBe(200)

    const patch = updateInterview.mock.calls[0][3] as Partial<InterviewRound>
    const items = patch.mock!.debrief!.answers.flatMap((a) => a.unsupported)
    expect(items.filter((u) => u.added === true).map((u) => u.said)).toEqual([
      'I led a team of twelve.',
      'I led a team of twelve.',
    ])
    expect(items.find((u) => u.said === 'I owned a fleet of brokers.')!.added).toBeUndefined()
    // Everything else about the debrief is left exactly as it was.
    expect(patch.mock!.debrief!.overall).toBe(DEBRIEF_OUT.overall)
    expect(patch.mock!.debrief!.factsChecked).toBe(2)
  })

  it('refuses a sentence this feedback never flagged', async () => {
    stored = debriefed()
    const res = await post({ action: 'added', said: 'Something nobody said.', session: STARTED })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/not one this feedback flagged/) })
    expect(updateInterview).not.toHaveBeenCalled()
  })
})

describe('POST …/mock — the stage the session was started against', () => {
  it('resolves the stored stageOrder while the map is the one it was read from', async () => {
    stored = round({ chat: [ask('Q1'), said('An answer.')], mock: session() })
    await post({ action: 'answer', session: STARTED })
    expect((runMockTurn.mock.calls[0][0] as MockTurnInput).stageSummary).toContain('Stage 2 of 3: Technical screen')
  })

  it('drops the stage when the loop was re-researched mid-mock, but still asks from the map as it is now', async () => {
    stored = round({ chat: [ask('Q1'), said('An answer.')], mock: session() })
    getApplication.mockResolvedValue(
      application({
        process: map({ researchedAt: '2026-09-03T08:00:00.000Z', guides: [guide(['What broke last?'])] }),
      }),
    )

    await post({ action: 'answer', session: STARTED })
    const input = runMockTurn.mock.calls[0][0] as MockTurnInput
    expect(input.stageSummary).toBe('Round type: technical — the loop was re-researched during this mock')
    expect(input.reported.map((r) => r.text)).toEqual(['What broke last?'])
  })
})
