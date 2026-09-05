import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrepBriefInput } from '@/ai/flows/prepBrief'
import { FlowOutputError } from '@/ai/genkit'
import type { Application, Fact, InterviewRound, PrepBrief, ProcessMap, Profile } from '@/lib/types'

// Rewriting one round's brief, with everything behind it faked: no Admin SDK, no model call.
// `placeRound` and `reportedQuestions` are real — they are pure, and what they hand the flow is
// half of what this route exists for. Under test: the brief is written from the map when there
// is one, it replaces the old one whole, and a flow that fails costs the candidate nothing.

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
const { runPrepBrief } = vi.hoisted(() => ({ runPrepBrief: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({
  getApplication,
  getInterview,
  getProfile,
  listInterviews,
  updateInterview,
}))
vi.mock('@/ai/flows/prepBrief', () => ({ runPrepBrief }))

import { POST } from '@/app/api/applications/[id]/interviews/[rid]/brief/route'

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
  status: 'interviewing',
  timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }],
  createdAt: '2026-08-20T09:00:00.000Z',
  ...over,
})

const researched = (): ProcessMap => ({
  stages: [
    { order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', duration: '30 min', whatItProbes: 'Motivation and comp.', tips: ['Have a number ready.'], sourceIds: ['s1'], confidence: 'community' },
    { order: 2, name: 'Coding interview', kind: 'technical', format: 'video', whatItProbes: 'Code in a shared editor.', tips: [], sourceIds: ['s1'], confidence: 'community' },
    { order: 3, name: 'Onsite loop', kind: 'onsite', format: 'onsite', whatItProbes: 'The team.', tips: [], sourceIds: [], confidence: 'inferred' },
  ],
  takeHome: { present: 'no', description: '', tips: [], sourceIds: [] },
  sources: [
    { id: 's1', title: 'My Marram loop', url: 'https://www.reddit.com/r/cscareerquestions/1/', host: 'reddit.com', kind: 'community', snippet: 'I interviewed at Marram', publishedAt: '2026-03-01T00:00:00.000Z', fetched: true },
  ],
  guides: [
    { sourceId: 's1', takeaways: ['Two coding rounds'], questionsReported: ['Why Marram?'], quotes: [], stale: false, firstHand: true },
  ],
  askRecruiter: [], caveats: [], grounded: true, researchedAt: '2026-09-01T00:00:00.000Z',
})

// One fact, whose claim is exactly the rehearsal line the flow returns below — the verbatim
// guard drops any line that is not one of these, here as much as at logging.
const FACTS: Fact[] = [
  {
    id: 'f1',
    claim: 'Owns a payments service',
    sourceSnippet: 'Owns the payments service',
    tags: ['payments'],
  },
]
const profile: Profile = { facts: FACTS, standardAnswers: {}, voiceRules: [], gaps: [] }

const oldBrief: PrepBrief = {
  likelyTopics: ['Why this role'],
  questionsToPrepare: [{ q: 'Walk me through your background', angle: 'f1' }],
  questionsToAsk: ['Who owns reconciliation today?'],
  factsToRehearse: ['Owns a payments service'],
  redFlags: [],
}

/** What the flow returns once it has the stage and the reported questions to read. */
const rewritten = {
  likelyTopics: ['Idempotent writes'],
  questionsToPrepare: [
    { q: 'Why Marram?', angle: 'f1', sourceId: 's1' },
    { q: 'Tell me about a write path you fixed', angle: 'f1' },
  ],
  questionsToAsk: ['What broke last quarter?'],
  factsToRehearse: ['Owns a payments service'],
  redFlags: [],
}

const round: InterviewRound = {
  id: 'r-1',
  noticeRaw: 'a notice',
  roundType: 'technical',
  people: [],
  prepBrief: oldBrief,
  chat: [],
  createdAt: '2026-08-29T10:00:00.000Z',
}
/** The round as it is after the write — what the read-back has to return, not `round`. */
const stored: InterviewRound = {
  ...round,
  prepBrief: { ...rewritten, basis: { stageOrder: 2, researchedAt: '2026-09-01T00:00:00.000Z' } },
}

const post = () =>
  POST(
    new Request('https://example.test/api/applications/app-1/interviews/r-1/brief', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'app-1', rid: 'r-1' }) },
  )

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application({ process: researched() }))
  // The guard read sees the round as it was; every later read sees it as it now is.
  getInterview.mockResolvedValueOnce(round).mockResolvedValue(stored)
  getProfile.mockResolvedValue(profile)
  listInterviews.mockResolvedValue([round])
  updateInterview.mockResolvedValue(undefined)
  runPrepBrief.mockResolvedValue(rewritten)
})

describe('POST /api/applications/[id]/interviews/[rid]/brief — the guards', () => {
  it('returns the auth guard verbatim and never reads or writes anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post()).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runPrepBrief).not.toHaveBeenCalled()
  })

  it('is a 404 when the application is gone', async () => {
    getApplication.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(runPrepBrief).not.toHaveBeenCalled()
  })

  it('is a 404 when the round is gone', async () => {
    getInterview.mockReset()
    getInterview.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(runPrepBrief).not.toHaveBeenCalled()
  })

  it('refuses to write a brief for a posting that was never interpreted', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined, process: researched() }))
    const res = await post()
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/interpret the posting/i)
    expect(runPrepBrief).not.toHaveBeenCalled()
  })
})

describe('POST /api/applications/[id]/interviews/[rid]/brief — writing it', () => {
  it('writes it from the stage this round maps to and the questions people report', async () => {
    await post()
    const input = runPrepBrief.mock.calls[0][0] as PrepBriefInput
    expect(input.roundType).toBe('technical')
    expect(input.parsed).toEqual(application().parsed)
    expect(input.facts).toEqual(FACTS)
    expect(input.stage?.stage.order).toBe(2)
    expect(input.stage?.stage.name).toBe('Coding interview')
    expect(input.stage?.of).toBe(3)
    expect(input.reported?.[0]).toMatchObject({ sourceId: 's1', text: 'Why Marram?' })
  })

  it('replaces the brief whole and answers with the round as it is stored', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(updateInterview).toHaveBeenCalledWith('user-1', 'app-1', 'r-1', {
      prepBrief: {
        ...rewritten,
        basis: { stageOrder: 2, researchedAt: '2026-09-01T00:00:00.000Z' },
      },
    })
    // Read back after the write rather than composed, so the page replaces its copy with the
    // record: the response carries the new brief, not the one the request started from.
    expect(await res.json()).toEqual(stored)
    expect(getInterview).toHaveBeenCalledTimes(2)
  })

  it('keeps only the rehearsal lines that are the candidate’s own claims, verbatim', async () => {
    runPrepBrief.mockResolvedValue({
      ...rewritten,
      factsToRehearse: ['Owns a payments service', 'Led a team of twelve'],
    })
    await post()
    const written = updateInterview.mock.calls[0][3] as { prepBrief: PrepBrief }
    expect(written.prepBrief.factsToRehearse).toEqual(['Owns a payments service'])
  })

  it('works without a map — the brief logging writes today, and no basis', async () => {
    getApplication.mockResolvedValue(application())
    await post()
    const input = runPrepBrief.mock.calls[0][0] as PrepBriefInput
    expect(input.stage).toBeUndefined()
    expect(input.reported).toBeUndefined()
    const written = updateInterview.mock.calls[0][3] as { prepBrief: PrepBrief }
    expect('basis' in written.prepBrief).toBe(false)
  })
})

describe('POST /api/applications/[id]/interviews/[rid]/brief — when the flow fails', () => {
  it('is a 422 with the flow’s reason, and the brief already there is untouched', async () => {
    runPrepBrief.mockRejectedValue(new FlowOutputError('redFlags: required'))
    const res = await post()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'redFlags: required', briefFailed: true })
    expect(updateInterview).not.toHaveBeenCalled()
  })
})
