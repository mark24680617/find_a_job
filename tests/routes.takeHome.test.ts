import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FlowOutputError } from '@/ai/genkit'
import { MAX_BRIEF_CHARS } from '@/lib/assignment'
import type { TakeHomeResearchInput } from '@/lib/research/takeHome'
import type { Application, Assignment, InterviewRound, TakeHomeGuide } from '@/lib/types'

// The handler with the database, the auth guard and the research run faked: no Admin SDK, no
// model calls, no network. `briefInUse` is the real one — it is pure, and which text this route
// plans from is most of what it decides.
//
// What is under test is the contract around a run that takes a minute: which brief goes in and
// under which identity, that the plan is written whole or not at all, that a brief replaced
// while the run was out is a refusal rather than a plan quoting a document nobody is holding
// any more, and that a failed run leaves the plan they already had standing.

const { requireUser, getApplication, getInterview, updateInterview } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  getInterview: vi.fn(),
  updateInterview: vi.fn(),
}))
const { researchTakeHome } = vi.hoisted(() => ({ researchTakeHome: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, getInterview, updateInterview }))
vi.mock('@/lib/research/takeHome', () => ({ researchTakeHome }))

import { POST } from '@/app/api/applications/[id]/interviews/[rid]/take-home/route'

// Long enough to plan from: MIN_BRIEF_CHARS is 200, and a real take-home notice is this size.
const NOTICE =
  'Your take-home is attached. Build a small ledger service that records transfers and ' +
  'reconciles them nightly, and send us a repository link by Friday 11 September, end of day. ' +
  'Please spend no more than four hours on it — we would rather see your judgement than your stamina.'

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'a posting',
  sourceUrl: 'https://jobs.marram.dev/senior-backend',
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

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r-1',
  noticeRaw: NOTICE,
  roundType: 'take-home',
  datetime: '2026-09-11T23:59:00.000Z',
  people: [],
  chat: [],
  createdAt: '2026-09-05T08:00:00.000Z',
  ...over,
})

const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  text: 'Build the ledger service described below. '.repeat(8),
  source: 'pasted',
  addedAt: '2026-09-05T09:00:00.000Z',
  cut: false,
  ...over,
})

const guide = (over: Partial<TakeHomeGuide> = {}): TakeHomeGuide => ({
  brief: {
    task: 'A small ledger service, handed in as a repository.',
    deliverables: [],
    constraints: [],
    evaluation: [],
  },
  reported: { tasks: [], evaluation: [], pitfalls: [], time: [] },
  plan: [{ step: 'Read the brief twice and list its deliverables.' }],
  askRecruiter: [],
  caveats: ['Only two write-ups mention this take-home.'],
  sources: [
    {
      id: 's1',
      title: 'My Marram take-home',
      url: 'https://www.reddit.com/r/cscareerquestions/1/',
      host: 'reddit.com',
      kind: 'community',
      snippet: '',
      fetched: true,
    },
  ],
  guides: [
    { sourceId: 's1', takeaways: ['Four hours, and they read the README'], quotes: [], stale: false, firstHand: true },
  ],
  grounded: true,
  plannedFrom: 'notice',
  plannedAt: '2026-09-05T10:00:00.000Z',
  ...over,
})

const post = () =>
  POST(
    new Request('https://example.test/api/applications/app-1/interviews/r-1/take-home', {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: 'app-1', rid: 'r-1' }) },
  )

const planned = (): TakeHomeResearchInput => researchTakeHome.mock.calls[0][0] as TakeHomeResearchInput
const written = (): TakeHomeGuide =>
  (updateInterview.mock.calls[0][3] as Partial<InterviewRound>).takeHome as TakeHomeGuide

// The stored round, mutated by the write, so the read-back answers what was actually written.
let stored: InterviewRound

beforeEach(() => {
  vi.resetAllMocks()
  stored = round()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockImplementation(async () => application())
  getInterview.mockImplementation(async () => stored)
  updateInterview.mockImplementation(
    async (_uid: string, _appId: string, _rid: string, patch: Partial<InterviewRound>) => {
      stored = { ...stored, ...patch }
    },
  )
  // The run copies through whichever brief the route handed it, as the real one does.
  researchTakeHome.mockImplementation(async (i: TakeHomeResearchInput) =>
    guide({ plannedFrom: i.plannedFrom }),
  )
})

describe('POST …/interviews/[rid]/take-home — the guards', () => {
  it('returns the auth guard verbatim and never reads or plans anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post()).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(researchTakeHome).not.toHaveBeenCalled()
  })

  it('is a 404 when the application or the round is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    expect((await post()).status).toBe(404)

    getApplication.mockImplementation(async () => application())
    getInterview.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(researchTakeHome).not.toHaveBeenCalled()
  })

  it('refuses a round that is not a take-home — there is no brief to plan from', async () => {
    stored = round({ roundType: 'technical' })
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'only a take-home round has a plan' })
    expect(researchTakeHome).not.toHaveBeenCalled()
  })

  it('refuses a posting that was never interpreted — the plan is written for the job', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'interpret the posting before planning' })
    expect(researchTakeHome).not.toHaveBeenCalled()
  })

  it('refuses a brief too short to plan from, before spending a minute on it', async () => {
    stored = round({ noticeRaw: 'Take-home attached. Due Friday.' })
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'the brief is too short to plan from — add the brief',
    })
    expect(researchTakeHome).not.toHaveBeenCalled()
  })
})

describe('POST …/interviews/[rid]/take-home — which brief it plans from', () => {
  it('plans from the notice until a brief is added, and says so', async () => {
    await post()
    expect(planned()).toEqual({
      company: 'Marram Systems',
      role: 'Senior Backend Engineer',
      parsed: application().parsed,
      brief: NOTICE,
      plannedFrom: 'notice',
      // The posting's address, so the gather can call a page on that host the posting rather
      // than somebody's write-up — the same argument the process route hands its run.
      sourceUrl: 'https://jobs.marram.dev/senior-backend',
    })
  })

  it('cuts a notice longer than the cap before it reaches the research', async () => {
    // 25,000 characters of notice is a forwarded thread, not a brief. The cap is `briefInUse`'s
    // and applies to the notice as much as to a pasted brief — the prompt is built to hold one.
    stored = round({ noticeRaw: 'a'.repeat(25_000) })
    await post()
    expect(planned().brief).toHaveLength(MAX_BRIEF_CHARS)
    expect(planned().plannedFrom).toBe('notice')
  })

  it('plans from the stored brief once there is one, and remembers which one', async () => {
    stored = round({ assignment: assignment() })
    await post()
    expect(planned().brief).toBe(assignment().text.trim())
    expect(planned().plannedFrom).toBe('2026-09-05T09:00:00.000Z')
  })
})

describe('POST …/interviews/[rid]/take-home — the write', () => {
  it('writes the guide whole and answers with the round as it is stored', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(updateInterview).toHaveBeenCalledTimes(1)
    expect(updateInterview.mock.calls[0].slice(0, 3)).toEqual(['user-1', 'app-1', 'r-1'])
    // Whole: the sources, the digests, whether the web was reached, which brief and when — all
    // of it is the run's, and a page that had half of it could not show where a sentence came from.
    expect(written()).toEqual(guide())
    expect(await res.json()).toEqual(stored)
    expect(stored.takeHome).toEqual(guide())
  })

  it('adds the PDF caveat when the brief was transcribed from one', async () => {
    stored = round({ assignment: assignment({ source: 'pdf' }) })
    await post()
    expect(written().caveats).toEqual([
      'Only two write-ups mention this take-home.',
      'The brief was transcribed from a PDF by the model; check its quotes against your copy.',
    ])
  })

  it('adds no caveat for a pasted brief — it is what it says it is', async () => {
    stored = round({ assignment: assignment() })
    await post()
    expect(written().caveats).toEqual(['Only two write-ups mention this take-home.'])
  })

  it('adds no caveat when the notice is still the brief', async () => {
    await post()
    expect(written().caveats).toEqual(['Only two write-ups mention this take-home.'])
  })
})

describe('POST …/interviews/[rid]/take-home — when the ground moves', () => {
  it('refuses to store a plan whose brief was replaced while it was being drawn', async () => {
    // A minute is long enough for the candidate to paste the real brief in another tab. The
    // plan in hand quotes the document that is gone; storing it would put quotes on screen that
    // are in nothing the round now holds.
    getInterview.mockReset()
    getInterview
      .mockResolvedValueOnce(round())
      .mockResolvedValue(round({ assignment: assignment({ addedAt: '2026-09-05T10:30:00.000Z' }) }))

    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'the brief changed while the plan was being drawn — plan again',
    })
    expect(updateInterview).not.toHaveBeenCalled()
  })

  it('writes when the brief is still the one it started from', async () => {
    const withBrief = round({ assignment: assignment() })
    getInterview.mockReset()
    getInterview.mockResolvedValue(withBrief)
    expect((await post()).status).toBe(200)
    expect(updateInterview).toHaveBeenCalledTimes(1)
    expect(written().plannedFrom).toBe('2026-09-05T09:00:00.000Z')
  })

  it('is a 404 when the round is deleted while the plan is being drawn', async () => {
    getInterview.mockReset()
    getInterview.mockResolvedValueOnce(round()).mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(updateInterview).not.toHaveBeenCalled()
  })
})

describe('POST …/interviews/[rid]/take-home — when the run fails', () => {
  it('is a 422 with the run’s own reason, and the plan they had still stands', async () => {
    stored = round({ takeHome: guide() })
    researchTakeHome.mockRejectedValue(new FlowOutputError('the guide failed its guard twice'))

    const res = await post()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'the guide failed its guard twice',
      planFailed: true,
    })
    expect(updateInterview).not.toHaveBeenCalled()
    expect(stored.takeHome).toEqual(guide())
  })

  it('does not swallow anything that is not a flow failure', async () => {
    researchTakeHome.mockRejectedValue(new Error('firestore unavailable'))
    await expect(post()).rejects.toThrow(/firestore unavailable/)
  })
})
