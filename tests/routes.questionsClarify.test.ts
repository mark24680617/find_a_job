import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, ClarifyQuestion, ParsedJob, Profile, Question } from '@/lib/types'
import type { ClarifyDraftOut } from '@/ai/schemas'
import { FlowOutputError } from '@/ai/genkit'
import type { ClarifyDraftInput } from '@/ai/prompts/clarifyDraft'

// The handler with everything behind it faked: no Admin SDK, no model call. What is under
// test is the clarify contract — what has to be on the record before the role can be reasoned
// about, what the flow is given, and where the positioning questions land.

const { requireUser, getApplication, updateApplication, getProfile } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
  getProfile: vi.fn(),
}))
const { runClarifyDraft } = vi.hoisted(() => ({ runClarifyDraft: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, updateApplication, getProfile }))
vi.mock('@/ai/flows/clarifyDraft', () => ({ runClarifyDraft }))

import { POST } from '@/app/api/applications/[id]/questions/[idx]/clarify/route'

const profile: Profile = {
  facts: [{ id: 'f1', claim: 'Owns a payments service', sourceSnippet: 'x', tags: ['payments'] }],
  standardAnswers: { work_authorization: 'UK citizen', salary_expectation: 'UNKNOWN' },
  voiceRules: [],
  gaps: [],
}

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['remote'],
  gates: [],
  themes: ['payments'],
  scope: 'per-application',
  advisory: '',
}

const question = (over: Partial<Question> = {}): Question => ({
  q: 'Why do you want to work here?',
  constraints: { limit: 200, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
  ...over,
})

const other = question({ q: 'Where are you based?', constraints: { type: 'short-text', required: false } })

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Own the payments platform. Deep reliability work. Minimum 5 years.',
  adapter: 'ashby',
  parsed,
  questions: [question(), other],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00.000Z' }],
  createdAt: '2026-08-27T00:00:00.000Z',
  ...over,
})

const questions: ClarifyQuestion[] = [
  {
    id: 'c1',
    question: 'Which experience should lead?',
    why: 'The role rewards payments depth.',
    options: [
      { label: 'The payments service', value: 'payments' },
      { label: 'The Kafka migration', value: 'kafka' },
    ],
    recommended: 'payments',
    allowMultiple: false,
    allowOther: false,
  },
]
const out: ClarifyDraftOut = { questions }

const post = (body?: unknown) =>
  new Request('https://example.test/api/applications/app-1/questions/0/clarify', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const ctx = (id: string, idx: string) => ({ params: Promise.resolve({ id, idx }) })

const patchOf = () => updateApplication.mock.calls[0][2] as Partial<Application>
const written = (i = 0) => (patchOf().questions as Question[])[i]
const flowInput = () => runClarifyDraft.mock.calls[0][0] as ClarifyDraftInput

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  getProfile.mockResolvedValue(profile)
  runClarifyDraft.mockResolvedValue(out)
})

describe('POST .../questions/[idx]/clarify — what it accepts', () => {
  it('401s before reading anything or calling the model', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(post({}), ctx('app-1', '0'))).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runClarifyDraft).not.toHaveBeenCalled()
  })

  it('400s an index that is not a whole number, without reading the record', async () => {
    for (const idx of ['', 'first', '1.5', '-1', ' 1', 'NaN']) {
      expect((await POST(post({}), ctx('app-1', idx))).status, idx).toBe(400)
    }
    expect(getApplication).not.toHaveBeenCalled()
    expect(runClarifyDraft).not.toHaveBeenCalled()
  })

  it('404s an application that is not there — or is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    const res = await POST(post({}), ctx('nope', '0'))
    expect(res.status).toBe(404)
    expect(getApplication).toHaveBeenCalledWith('user-1', 'nope')
    expect(runClarifyDraft).not.toHaveBeenCalled()
  })

  it('400s an index past the end of the questions the form has', async () => {
    for (const idx of ['2', '7']) {
      const res = await POST(post({}), ctx('app-1', idx))
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('question') })
    }
    expect(runClarifyDraft).not.toHaveBeenCalled()
  })

  it('400s when the posting was never interpreted — there is no read of what the role screens for', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    const res = await POST(post({}), ctx('app-1', '0'))
    expect(res.status).toBe(400)
    expect(runClarifyDraft).not.toHaveBeenCalled()
  })

  it('400s when there is no posting text to reason about, and says to re-create the application', async () => {
    for (const jdRaw of ['', '   ']) {
      getApplication.mockResolvedValue(application({ jdRaw }))
      const res = await POST(post({}), ctx('app-1', '0'))
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('re-create') })
    }
    expect(runClarifyDraft).not.toHaveBeenCalled()
  })
})

describe('POST .../questions/[idx]/clarify — what the flow is given', () => {
  it('hands the flow the question, the posting and the profile facts, minus the UNKNOWN answers left for the prompt', async () => {
    await POST(post({}), ctx('app-1', '0'))
    expect(flowInput()).toEqual({
      question: question(),
      jdText: application().jdRaw,
      facts: profile.facts,
      standardAnswers: profile.standardAnswers,
      clarifyAnswers: [],
    })
  })

  it('generates a fresh round — feeds no prior answers even when the stored question has some', async () => {
    // A superseding round is generated from scratch and clears the old answers on the write.
    // Feeding those answers would let the model skip re-asking positioning we are about to
    // discard, silently dropping the decision — so the generation always gets an empty list.
    const settled = question({
      clarifyAnswers: [{ id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] }],
    })
    getApplication.mockResolvedValue(application({ questions: [settled, other] }))
    await POST(post({}), ctx('app-1', '0'))
    expect(flowInput().clarifyAnswers).toEqual([])
  })

  it('truncates a very long posting before the model ever sees it', async () => {
    getApplication.mockResolvedValue(application({ jdRaw: 'y'.repeat(6100) }))
    await POST(post({}), ctx('app-1', '0'))
    expect((flowInput().jdText as string).length).toBe(6000)
  })
})

describe('POST .../questions/[idx]/clarify — what it writes', () => {
  it('stores the positioning questions on the slot and returns the updated question', async () => {
    const res = await POST(post({}), ctx('app-1', '0'))
    expect(res.status).toBe(200)

    const [uid, id] = updateApplication.mock.calls[0]
    expect(uid).toBe('user-1')
    expect(id).toBe('app-1')
    expect(written().clarify).toEqual(questions)

    const body = (await res.json()) as Question
    expect(body.clarify).toEqual(questions)
    expect(body).not.toHaveProperty('company')
  })

  it('leaves the other questions exactly as they were', async () => {
    await POST(post({}), ctx('app-1', '0'))
    const list = patchOf().questions as Question[]
    expect(list).toHaveLength(2)
    expect(list[1]).toEqual(other)
  })

  it('re-clarifies over an earlier round, replacing the stored questions', async () => {
    const stale: ClarifyQuestion[] = [{ ...questions[0], id: 'c1', question: 'An older question' }]
    getApplication.mockResolvedValue(application({ questions: [question({ clarify: stale }), other] }))
    await POST(post({}), ctx('app-1', '0'))
    expect(written().clarify).toEqual(questions)
  })

  it('clears answers to the previous round — a fresh round renumbers c1..cN, so old ids no longer name these questions', async () => {
    // Without this, a round-2 c1 would inherit a round-1 c1 answer about a different question,
    // and the draft route's merge-by-id would carry that stale answer into the draft.
    const priorAnswers = [{ id: 'c1', question: 'An older question', answer: ['some earlier choice'] }]
    const priorClarify: ClarifyQuestion[] = [{ ...questions[0], question: 'An older question' }]
    getApplication.mockResolvedValue(
      application({ questions: [question({ clarify: priorClarify, clarifyAnswers: priorAnswers }), other] }),
    )

    const res = await POST(post({}), ctx('app-1', '0'))
    expect(written().clarify).toEqual(questions)
    expect(written().clarifyAnswers).toEqual([])
    expect(((await res.json()) as Question).clarifyAnswers).toEqual([])
  })
})

describe('POST .../questions/[idx]/clarify — the failure and freshness paths', () => {
  it('422s with the flow’s own message when it refuses its own output', async () => {
    const message = 'The clarifying questions were still wrong after one correction — question c1 recommends "ghost"'
    runClarifyDraft.mockRejectedValue(new FlowOutputError(message))

    const res = await POST(post({}), ctx('app-1', '0'))
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: message, clarifyFailed: true })
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('lets a failure that is not the flow’s judgment go up as a 500', async () => {
    runClarifyDraft.mockRejectedValue(new Error('socket hang up'))
    await expect(POST(post({}), ctx('app-1', '0'))).rejects.toThrow('socket hang up')
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('404s without writing when the application is deleted while the model reads', async () => {
    getApplication.mockResolvedValueOnce(application()).mockResolvedValueOnce(null)
    const res = await POST(post({}), ctx('app-1', '0'))
    expect(res.status).toBe(404)
    expect(runClarifyDraft).toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('409s rather than attaching questions to a slot whose question changed under the call', async () => {
    getApplication
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(application({ questions: [question({ q: 'A different question' }), other] }))

    const res = await POST(post({}), ctx('app-1', '0'))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'questions changed while clarifying' })
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('writes onto the record as it is after the call, not the copy it read before', async () => {
    getApplication
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(application({ questions: [question(), question({ q: 'Added while clarifying' })] }))

    await POST(post({}), ctx('app-1', '0'))
    const list = patchOf().questions as Question[]
    expect(list).toHaveLength(2)
    expect(list[1].q).toBe('Added while clarifying')
    expect(list[0].clarify).toEqual(questions)
  })
})
