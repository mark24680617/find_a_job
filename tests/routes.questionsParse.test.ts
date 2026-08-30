import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, ParsedJob, Question } from '@/lib/types'
import type { FormParseOut } from '@/ai/schemas'

// The handler with everything behind it faked: no Admin SDK, no model call. What is under
// test is the parse contract — what counts as a form worth sending, what a parsed question
// becomes on the record, and the one field this route is allowed to overwrite on `parsed`.

const { requireUser, getApplication, updateApplication } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
}))
const { runFormParse } = vi.hoisted(() => ({ runFormParse: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, updateApplication }))
vi.mock('@/ai/flows/formParse', () => ({ runFormParse }))

import { POST } from '@/app/api/applications/[id]/questions/parse/route'

const parsed: ParsedJob = {
  company: 'TRM Labs',
  role: 'Account Director',
  roleFacts: ['remote'],
  gates: [{ requirement: '8 years', met: 'no', posture: 'explicit', note: 'Minimum 8 years' }],
  themes: ['backend'],
  scope: 'unknown',
  advisory: 'Skip: the 8-year minimum is explicit.',
}

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'TRM Labs',
  role: 'Account Director',
  jdRaw: 'Build a safer world.',
  adapter: 'ashby',
  parsed,
  questions: [],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00.000Z' }],
  createdAt: '2026-08-27T00:00:00.000Z',
  ...over,
})

const out: FormParseOut = {
  questions: [
    {
      q: 'Why do you want to work here?',
      constraints: { limit: 500, unit: 'chars', type: 'long-text', required: true },
    },
    { q: 'Where are you based?', constraints: { type: 'short-text', required: false } },
  ],
  scope: 'per-application',
  scopeEvidence: 'Application for Account Director',
}

const png = { base64: 'c2hvdA==', mime: 'image/png' }

const post = (body: unknown) =>
  new Request('https://example.test/api/applications/app-1/questions/parse', {
    method: 'POST',
    body: JSON.stringify(body),
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const patchOf = () => updateApplication.mock.calls[0][2] as Partial<Application>

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  runFormParse.mockResolvedValue(out)
})

describe('POST .../questions/parse — what it accepts', () => {
  it('400s when neither text nor an image was sent, without touching the model', async () => {
    for (const bad of [{}, { text: '' }, { images: [] }, { text: '', images: [] }, null]) {
      expect((await POST(post(bad), ctx('app-1'))).status).toBe(400)
    }
    expect(runFormParse).not.toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('400s a file type the model cannot look at, rather than sending it blind', async () => {
    for (const mime of ['image/gif', 'application/pdf', 'text/plain', '']) {
      const res = await POST(post({ images: [{ base64: 'c2hvdA==', mime }] }), ctx('app-1'))
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('image/png') })
    }
    expect(runFormParse).not.toHaveBeenCalled()
  })

  it('400s an image entry that carries no data', async () => {
    for (const bad of [{ mime: 'image/png' }, { base64: '', mime: 'image/png' }, 'not an object', null]) {
      expect((await POST(post({ images: [bad] }), ctx('app-1'))).status).toBe(400)
    }
    expect(runFormParse).not.toHaveBeenCalled()
  })

  it('400s an images field that is not a list of images', async () => {
    for (const bad of ['c2hvdA==', { base64: 'c2hvdA==', mime: 'image/png' }, 7]) {
      expect((await POST(post({ images: bad }), ctx('app-1'))).status).toBe(400)
    }
    expect(runFormParse).not.toHaveBeenCalled()
  })

  it('accepts pasted text alone, screenshots alone, and both together', async () => {
    for (const body of [{ text: 'Q1' }, { images: [png] }, { text: 'Q1', images: [png] }]) {
      expect((await POST(post(body), ctx('app-1'))).status).toBe(200)
    }
    expect(runFormParse).toHaveBeenNthCalledWith(1, { text: 'Q1', images: [] })
    expect(runFormParse).toHaveBeenNthCalledWith(2, { text: undefined, images: [png] })
    expect(runFormParse).toHaveBeenNthCalledWith(3, { text: 'Q1', images: [png] })
  })

  it('404s an application that is not there — or is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    const res = await POST(post({ text: 'Q1' }), ctx('nope'))
    expect(res.status).toBe(404)
    expect(getApplication).toHaveBeenCalledWith('user-1', 'nope')
    expect(runFormParse).not.toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('401s before reading the record or calling the model', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(post({ text: 'Q1' }), ctx('app-1'))).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runFormParse).not.toHaveBeenCalled()
  })
})

describe('POST .../questions/parse — what it writes', () => {
  it('stores each parsed question as a pending one with nothing asked of the human yet', async () => {
    const res = await POST(post({ text: 'Q1' }), ctx('app-1'))
    expect(res.status).toBe(200)

    const [uid, id] = updateApplication.mock.calls[0]
    expect(uid).toBe('user-1')
    expect(id).toBe('app-1')
    expect(patchOf().questions).toEqual([
      {
        q: 'Why do you want to work here?',
        constraints: { limit: 500, unit: 'chars', type: 'long-text', required: true },
        askHuman: [],
        status: 'pending',
      },
      {
        q: 'Where are you based?',
        constraints: { type: 'short-text', required: false },
        askHuman: [],
        status: 'pending',
      },
    ] satisfies Question[])
  })

  it('replaces the old questions wholesale — the latest intake describes the form', async () => {
    const old: Question[] = [
      {
        q: 'A question from an earlier parse',
        constraints: { type: 'long-text', required: true },
        draft: { text: 'A draft that is about to be lost', citations: [] },
        askHuman: [{ question: 'Which office?', why: 'not in the profile' }],
        status: 'drafted',
      },
    ]
    getApplication.mockResolvedValue(application({ questions: old }))

    await POST(post({ text: 'Q1' }), ctx('app-1'))
    const questions = patchOf().questions as Question[]
    expect(questions).toHaveLength(2)
    expect(questions.map((q) => q.q)).not.toContain('A question from an earlier parse')
  })

  it('leaves a scope a human settled while the model was still reading', async () => {
    // The read that guards the write is the one taken AFTER the flow: the model call takes
    // seconds, and a PATCH landing in that window is a decision a human just made.
    getApplication
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(application({ parsed: { ...parsed, scope: 'per-profile' } }))

    await POST(post({ text: 'Q1' }), ctx('app-1'))
    expect(patchOf()).not.toHaveProperty('parsed')
    expect(patchOf().questions).toHaveLength(2)

    const body = (await (await POST(post({ text: 'Q1' }), ctx('app-1'))).json()) as Application
    expect(body.parsed?.scope).toBe('per-application')
  })

  it('404s without writing when the application is deleted while the model reads', async () => {
    getApplication.mockResolvedValueOnce(application()).mockResolvedValueOnce(null)
    const res = await POST(post({ text: 'Q1' }), ctx('app-1'))
    expect(res.status).toBe(404)
    expect(runFormParse).toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('answers an unknown scope from the form, keeping the rest of the parsed posting', async () => {
    await POST(post({ text: 'Q1' }), ctx('app-1'))
    expect(patchOf().parsed).toEqual({ ...parsed, scope: 'per-application' })
  })

  it('leaves a scope the posting already settled alone', async () => {
    getApplication.mockResolvedValue(application({ parsed: { ...parsed, scope: 'per-profile' } }))
    await POST(post({ text: 'Q1' }), ctx('app-1'))
    expect(patchOf()).not.toHaveProperty('parsed')
    expect(patchOf().questions).toBeDefined()
  })

  it('writes no parsed field at all when the application has none', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    await POST(post({ text: 'Q1' }), ctx('app-1'))
    expect(patchOf()).not.toHaveProperty('parsed')
  })

  it('returns the updated application', async () => {
    const res = await POST(post({ text: 'Q1' }), ctx('app-1'))
    const body = (await res.json()) as Application
    expect(body.id).toBe('app-1')
    expect(body.questions).toHaveLength(2)
    expect(body.questions[0].status).toBe('pending')
    expect(body.parsed?.scope).toBe('per-application')
    expect(body.company).toBe('TRM Labs')
  })
})
