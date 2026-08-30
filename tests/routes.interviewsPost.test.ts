import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FlowOutputError } from '@/ai/genkit'
import type { Application, Fact, InterviewRound, PrepBrief, Profile } from '@/lib/types'

// The handler with everything behind it faked: no Admin SDK, no model calls. What is under
// test is the logging contract — the round (the human's own data) is written BEFORE the brief
// is attempted, and nothing the brief can do costs them the round.

const {
  requireUser,
  getApplication,
  updateApplication,
  getProfile,
  createInterview,
  updateInterview,
  getInterview,
  listInterviews,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
  getProfile: vi.fn(),
  createInterview: vi.fn(),
  updateInterview: vi.fn(),
  getInterview: vi.fn(),
  listInterviews: vi.fn(),
}))
const { runInterviewInterpret, runPrepBrief } = vi.hoisted(() => ({
  runInterviewInterpret: vi.fn(),
  runPrepBrief: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({
  getApplication,
  updateApplication,
  getProfile,
  createInterview,
  updateInterview,
  getInterview,
  listInterviews,
}))
vi.mock('@/ai/flows/interviewInterpret', () => ({ runInterviewInterpret }))
vi.mock('@/ai/flows/prepBrief', () => ({ runPrepBrief }))

import { POST } from '@/app/api/applications/[id]/interviews/route'

const NOTICE = `Hi Tom — a 30-minute call with our recruiter Ana Reyes next Thursday at 2pm PT.`

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
  questions: [],
  status: 'applied',
  timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }],
  createdAt: '2026-08-20T09:00:00.000Z',
  ...over,
})

// One fact, whose claim is exactly the brief's rehearsal line below — the verbatim guard on
// factsToRehearse drops any line that is not one of these, so a fact bank that does not back
// the brief would silently empty the section.
const FACTS: Fact[] = [
  {
    id: 'f1',
    claim: 'Owns a payments service',
    sourceSnippet: 'Owns the payments service',
    tags: ['payments'],
  },
]

const profile: Profile = { facts: FACTS, standardAnswers: {}, voiceRules: [], gaps: [] }

const interpreted = {
  roundType: 'recruiter-screen' as const,
  datetime: '2026-09-03T21:00:00.000Z',
  people: ['Ana Reyes — Recruiting'],
  askHuman: [{ question: 'Is there a take-home after this?', why: 'The notice does not say.' }],
}

const brief = {
  likelyTopics: ['Why this role'],
  questionsToPrepare: [{ q: 'Walk me through your background', angle: 'f1' }],
  questionsToAsk: ['Who owns reconciliation today?'],
  factsToRehearse: ['Owns a payments service'],
  redFlags: [],
}

const stored: InterviewRound = {
  id: 'r-1',
  noticeRaw: NOTICE,
  roundType: 'recruiter-screen',
  datetime: '2026-09-03T21:00:00.000Z',
  people: ['Ana Reyes — Recruiting'],
  askHuman: interpreted.askHuman,
  prepBrief: brief,
  chat: [],
  createdAt: '2026-08-29T10:00:00.000Z',
}

const post = (body: unknown = { noticeText: NOTICE }) =>
  POST(
    new Request('https://example.test/api/applications/app-1/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'app-1' }) },
  )

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  getProfile.mockResolvedValue(profile)
  createInterview.mockResolvedValue('r-1')
  updateInterview.mockResolvedValue(undefined)
  updateApplication.mockResolvedValue(undefined)
  getInterview.mockResolvedValue(stored)
  runInterviewInterpret.mockResolvedValue(interpreted)
  runPrepBrief.mockResolvedValue(brief)
})

describe('POST /api/applications/[id]/interviews — the guards', () => {
  it('returns the auth guard verbatim and never reads or writes anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post()).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runInterviewInterpret).not.toHaveBeenCalled()
    expect(createInterview).not.toHaveBeenCalled()
  })

  it('refuses an empty or non-text notice before spending a model call', async () => {
    for (const body of [{}, { noticeText: '' }, { noticeText: '   ' }, { noticeText: 42 }]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/notice/i)
    }
    expect(runInterviewInterpret).not.toHaveBeenCalled()
  })

  it('is a 404 when the application is gone', async () => {
    getApplication.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(runInterviewInterpret).not.toHaveBeenCalled()
  })

  it('refuses to write a brief for a posting that was never interpreted', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    const res = await post()
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/interpret the posting/i)
    expect(createInterview).not.toHaveBeenCalled()
  })
})

describe('POST /api/applications/[id]/interviews — the happy path', () => {
  it('interprets, then writes the round, then writes the brief onto it', async () => {
    const res = await post()
    expect(res.status).toBe(200)

    // The round goes down before the brief is even attempted: it is the human's own data.
    expect(runInterviewInterpret.mock.invocationCallOrder[0]).toBeLessThan(
      createInterview.mock.invocationCallOrder[0],
    )
    expect(createInterview.mock.invocationCallOrder[0]).toBeLessThan(
      runPrepBrief.mock.invocationCallOrder[0],
    )
    expect(runPrepBrief.mock.invocationCallOrder[0]).toBeLessThan(
      updateInterview.mock.invocationCallOrder[0],
    )
  })

  it('sends the notice to the interpret flow and the round type to the brief', async () => {
    await post()
    expect(runInterviewInterpret).toHaveBeenCalledWith({ noticeText: NOTICE })
    expect(runPrepBrief).toHaveBeenCalledWith({
      roundType: 'recruiter-screen',
      parsed: application().parsed,
      facts: FACTS,
    })
  })

  it('stores the notice as it arrived, with the type, time, people and open questions', async () => {
    await post()
    expect(createInterview).toHaveBeenCalledWith('user-1', 'app-1', {
      noticeRaw: NOTICE,
      roundType: 'recruiter-screen',
      datetime: '2026-09-03T21:00:00.000Z',
      people: ['Ana Reyes — Recruiting'],
      askHuman: interpreted.askHuman,
      chat: [],
    })
    expect(updateInterview).toHaveBeenCalledWith('user-1', 'app-1', 'r-1', { prepBrief: brief })
  })

  it('stores only the rehearsal lines that are the candidate’s own claims, verbatim', async () => {
    // The prompt asks for verbatim claims; the record enforces it. A line the model composed —
    // however plausible — is a sentence somebody would say out loud in an interview believing
    // it came from their own history.
    runPrepBrief.mockResolvedValue({
      ...brief,
      factsToRehearse: [
        'Owns a payments service', // f1, word for word
        '  Owns a payments service  ', // the same claim, whitespace around it
        'Owns a payments service at 99.95% success', // embellished — not a claim on file
        'Led a team of twelve', // nowhere in the fact bank at all
      ],
    })

    await post()
    const written = updateInterview.mock.calls[0][3] as { prepBrief: PrepBrief }
    expect(written.prepBrief.factsToRehearse).toEqual([
      'Owns a payments service',
      '  Owns a payments service  ',
    ])
    // The rest of the brief is untouched — this guard is about one section.
    expect(written.prepBrief.likelyTopics).toEqual(brief.likelyTopics)
    expect(written.prepBrief.redFlags).toEqual(brief.redFlags)
  })

  it('omits datetime entirely when the notice never stated a time', async () => {
    runInterviewInterpret.mockResolvedValue({ ...interpreted, datetime: null })
    await post()
    const written = createInterview.mock.calls[0][2] as Record<string, unknown>
    expect('datetime' in written).toBe(false)
  })

  it('moves the application to interviewing and appends one timeline event', async () => {
    await post()
    const patch = updateApplication.mock.calls[0][2] as Application
    expect(patch.status).toBe('interviewing')
    expect(patch.timeline).toHaveLength(2)
    expect(patch.timeline[0]).toEqual(application().timeline[0])
    expect(patch.timeline[1].event).toBe('interview round added: recruiter-screen')
  })

  it('does not drag an offer or a rejection back to interviewing, but still records the round', async () => {
    // The final loop of an offer process is still a round worth logging. Moving the record
    // back a column for it would lose where it actually stands.
    for (const status of ['offer', 'rejected'] as const) {
      vi.clearAllMocks()
      getApplication.mockResolvedValue(application({ status }))
      runInterviewInterpret.mockResolvedValue(interpreted)
      runPrepBrief.mockResolvedValue(brief)
      createInterview.mockResolvedValue('r-1')
      getInterview.mockResolvedValue(stored)

      expect((await post()).status).toBe(200)
      const patch = updateApplication.mock.calls[0][2] as Partial<Application>
      expect('status' in patch).toBe(false)
      expect(patch.timeline).toHaveLength(2)
      expect(patch.timeline![1].event).toBe('interview round added: recruiter-screen')
    }
  })

  it('composes the timeline from a read taken after the model calls, not before them', async () => {
    // A status change landing in another tab while the two flows run. Composing from the copy
    // read at the top would write the old timeline straight back out.
    const late = application({
      timeline: [
        { event: 'created', at: '2026-08-20T09:00:00.000Z' },
        { event: 'status → applied', at: '2026-08-28T09:00:00.000Z' },
      ],
    })
    getApplication.mockResolvedValueOnce(application()).mockResolvedValueOnce(late)

    await post()
    const patch = updateApplication.mock.calls[0][2] as Application
    expect(patch.timeline).toHaveLength(3)
    expect(patch.timeline[1].event).toBe('status → applied')
  })

  it('answers with the round exactly as it is stored', async () => {
    const res = await post()
    expect(await res.json()).toEqual({ round: stored })
    expect(getInterview).toHaveBeenCalledWith('user-1', 'app-1', 'r-1')
  })
})

describe('POST /api/applications/[id]/interviews — when a flow fails', () => {
  it('is a 422 when the notice cannot be read, and writes nothing', async () => {
    runInterviewInterpret.mockRejectedValue(new FlowOutputError('roundType: required'))
    const res = await post()

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'roundType: required', interviewFailed: true })
    expect(createInterview).not.toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('keeps the round when the brief cannot be written, and says so', async () => {
    runPrepBrief.mockRejectedValue(new FlowOutputError('redFlags: required'))
    getInterview.mockResolvedValue({ ...stored, prepBrief: undefined })

    const res = await post()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { round: InterviewRound; briefFailed: boolean }
    expect(body.briefFailed).toBe(true)
    expect(body.round.id).toBe('r-1')
    expect(body.round.prepBrief).toBeUndefined()

    // The round stands, the status still moves, and nothing was written onto the round.
    expect(createInterview).toHaveBeenCalledTimes(1)
    expect(updateInterview).not.toHaveBeenCalled()
    expect(updateApplication).toHaveBeenCalledTimes(1)
  })

  it('does not swallow a database failure while writing the brief', async () => {
    updateInterview.mockRejectedValue(new Error('firestore unavailable'))
    await expect(post()).rejects.toThrow(/firestore unavailable/)
  })
})
