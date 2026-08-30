import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, ParsedJob, Profile } from '@/lib/types'

// Every handler with everything behind it faked: no Admin SDK, no adapter network, no model
// call. What is under test is the create/list/read/patch contract — status codes, what the
// company/role precedence resolves to, and that a blocked fetch turns into a 422 the UI can
// act on rather than a silent failure.

const {
  requireUser,
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  getProfile,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createApplication: vi.fn(),
  listApplications: vi.fn(),
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  getProfile: vi.fn(),
}))
const { fetchPosting, runJobInterpret } = vi.hoisted(() => ({
  fetchPosting: vi.fn(),
  runJobInterpret: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({
  createApplication,
  listApplications,
  getApplication,
  updateApplication,
  deleteApplication,
  getProfile,
}))
vi.mock('@/ai/flows/jobInterpret', () => ({ runJobInterpret }))
// A real subclass so the route's `error instanceof FetchBlockedError` matches the mock.
vi.mock('@/adapters', () => {
  class FetchBlockedError extends Error {
    constructor(public reason: string) {
      super(reason)
      this.name = 'FetchBlockedError'
    }
  }
  return { fetchPosting, FetchBlockedError }
})

import { GET, POST } from '@/app/api/applications/route'
import { DELETE, GET as GET_ONE, PATCH } from '@/app/api/applications/[id]/route'
import { FetchBlockedError } from '@/adapters'

const parsed: ParsedJob = {
  company: 'Parsed Co',
  role: 'Parsed Role',
  roleFacts: ['remote'],
  gates: [{ requirement: '8 years', met: 'no', posture: 'explicit', note: 'Minimum 8 years' }],
  themes: ['backend'],
  scope: 'per-application',
  advisory: 'Skip: the 8-year minimum is explicit.',
}

const profile: Profile = {
  facts: [{ id: 'f1', claim: 'Three years backend', sourceSnippet: 'Backend engineer', tags: ['backend'] }],
  standardAnswers: {},
  voiceRules: [],
  gaps: [],
}

const post = (body: unknown) =>
  new Request('https://example.test/api/applications', { method: 'POST', body: JSON.stringify(body) })

const patchReq = (body: unknown) =>
  new Request('https://example.test/api/applications/app-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getProfile.mockResolvedValue(profile)
  runJobInterpret.mockResolvedValue(parsed)
  createApplication.mockResolvedValue('app-1')
})

describe('POST /api/applications — from a URL', () => {
  beforeEach(() => {
    fetchPosting.mockResolvedValue({
      company: 'Trm Labs',
      role: 'Account Director',
      jdText: 'Build a safer world. Minimum 8 years.',
      adapter: 'ashby',
    })
  })

  it('fetches, interprets against the profile, and creates a draft', async () => {
    const res = await POST(post({ url: 'https://jobs.ashbyhq.com/trm-labs/abc' }))
    expect(res.status).toBe(201)

    expect(fetchPosting).toHaveBeenCalledWith('https://jobs.ashbyhq.com/trm-labs/abc')
    expect(runJobInterpret).toHaveBeenCalledWith({
      jdText: 'Build a safer world. Minimum 8 years.',
      facts: profile.facts,
    })

    const [uid, app] = createApplication.mock.calls[0] as [string, Omit<Application, 'id'>]
    expect(uid).toBe('user-1')
    expect(app.status).toBe('draft')
    expect(app.adapter).toBe('ashby')
    expect(app.sourceUrl).toBe('https://jobs.ashbyhq.com/trm-labs/abc')
    expect(app.jdRaw).toBe('Build a safer world. Minimum 8 years.')
    expect(app.parsed).toEqual(parsed)
    expect(app.questions).toEqual([])
    expect(app.timeline).toEqual([{ event: 'created', at: app.createdAt }])
    expect(app.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    await expect(res.json()).resolves.toMatchObject({ id: 'app-1', status: 'draft' })
  })

  it('takes the adapter company/role when the body gives none', async () => {
    await POST(post({ url: 'https://jobs.ashbyhq.com/trm-labs/abc' }))
    const app = createApplication.mock.calls[0][1] as Omit<Application, 'id'>
    expect(app.company).toBe('Trm Labs')
    expect(app.role).toBe('Account Director')
  })

  it('lets the body override a slug-derived company (Trm Labs -> TRM Labs)', async () => {
    await POST(post({ url: 'https://jobs.ashbyhq.com/trm-labs/abc', company: 'TRM Labs', role: 'AD' }))
    const app = createApplication.mock.calls[0][1] as Omit<Application, 'id'>
    expect(app.company).toBe('TRM Labs')
    expect(app.role).toBe('AD')
  })

  it('turns a blocked fetch into a 422 the UI switches to paste mode on', async () => {
    fetchPosting.mockRejectedValue(new FetchBlockedError('LinkedIn blocks fetching — paste the job description text instead'))
    const res = await POST(post({ url: 'https://www.linkedin.com/jobs/view/1' }))
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'LinkedIn blocks fetching — paste the job description text instead',
      needPaste: true,
    })
    expect(runJobInterpret).not.toHaveBeenCalled()
    expect(createApplication).not.toHaveBeenCalled()
  })
})

describe('POST /api/applications — from pasted text', () => {
  it('skips the fetch and marks the source manual', async () => {
    const res = await POST(post({ jdText: 'Pasted JD. Must have 8 years.' }))
    expect(res.status).toBe(201)
    expect(fetchPosting).not.toHaveBeenCalled()

    const app = createApplication.mock.calls[0][1] as Omit<Application, 'id'>
    expect(app.adapter).toBe('manual')
    expect(app.jdRaw).toBe('Pasted JD. Must have 8 years.')
    expect(app.sourceUrl).toBeUndefined()
    // No adapter company/role on a paste, so the parsed values fill in.
    expect(app.company).toBe('Parsed Co')
    expect(app.role).toBe('Parsed Role')
  })

  it('prefers the pasted text over a URL still in the form, keeping the URL as the source', async () => {
    await POST(post({ url: 'https://jobs.ashbyhq.com/trm-labs/abc', jdText: 'Pasted after a block.' }))
    expect(fetchPosting).not.toHaveBeenCalled()
    const app = createApplication.mock.calls[0][1] as Omit<Application, 'id'>
    expect(app.jdRaw).toBe('Pasted after a block.')
    expect(app.adapter).toBe('manual')
    expect(app.sourceUrl).toBe('https://jobs.ashbyhq.com/trm-labs/abc')
  })

  it('400s when neither a url nor jdText is sent, without touching the model', async () => {
    for (const bad of [{}, { jdText: '' }, { url: '' }, null]) {
      expect((await POST(post(bad))).status).toBe(400)
    }
    expect(runJobInterpret).not.toHaveBeenCalled()
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('401s before a fetch or a model call', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(post({ jdText: 'x' }))).status).toBe(401)
    expect(runJobInterpret).not.toHaveBeenCalled()
    expect(createApplication).not.toHaveBeenCalled()
  })
})

describe('GET /api/applications', () => {
  it('lists the applications for the user', async () => {
    const apps = [{ id: 'app-2' }, { id: 'app-1' }] as unknown as Application[]
    listApplications.mockResolvedValue(apps)
    const res = await GET(new Request('https://example.test/api/applications'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(apps)
    expect(listApplications).toHaveBeenCalledWith('user-1')
  })

  it('hands back the guard 401 untouched', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await GET(new Request('https://example.test/api/applications'))).status).toBe(401)
    expect(listApplications).not.toHaveBeenCalled()
  })
})

describe('GET /api/applications/[id]', () => {
  it('returns the application', async () => {
    const app = { id: 'app-1', company: 'TRM Labs' } as unknown as Application
    getApplication.mockResolvedValue(app)
    const res = await GET_ONE(new Request('https://example.test/api/applications/app-1'), ctx('app-1'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(app)
    expect(getApplication).toHaveBeenCalledWith('user-1', 'app-1')
  })

  it('404s an unknown id', async () => {
    getApplication.mockResolvedValue(null)
    const res = await GET_ONE(new Request('https://example.test/api/applications/nope'), ctx('nope'))
    expect(res.status).toBe(404)
  })

  it('401s without reading the db', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"invalid token"}', { status: 401 }))
    const res = await GET_ONE(new Request('https://example.test/api/applications/app-1'), ctx('app-1'))
    expect(res.status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/applications/[id]', () => {
  it('applies the patch and returns the updated application', async () => {
    const updated = { id: 'app-1', status: 'applied' } as unknown as Application
    getApplication.mockResolvedValue(updated)
    const res = await PATCH(patchReq({ status: 'applied' }), ctx('app-1'))

    expect(res.status).toBe(200)
    expect(updateApplication).toHaveBeenCalledWith('user-1', 'app-1', { status: 'applied' })
    await expect(res.json()).resolves.toEqual(updated)
  })

  it('400s a body that is not a partial application, without writing', async () => {
    for (const bad of [null, 'a string', ['not', 'an', 'object']]) {
      expect((await PATCH(patchReq(bad), ctx('app-1'))).status).toBe(400)
    }
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('401s before touching the db', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await PATCH(patchReq({ status: 'applied' }), ctx('app-1'))).status).toBe(401)
    expect(updateApplication).not.toHaveBeenCalled()
  })
})

// Removing a record is the one action here that cannot be undone: the document goes, and the
// interviews under it go with it. So the contract is narrow on purpose — the caller's own uid
// decides what can be reached, and nothing is deleted that was not first read back.
describe('DELETE /api/applications/[id]', () => {
  const del = () =>
    new Request('https://example.test/api/applications/app-1', { method: 'DELETE' })

  const stored = { id: 'app-1', company: 'Nectir', role: 'Founding Engineer' }

  it('deletes the record and answers 204 with nothing in it', async () => {
    getApplication.mockResolvedValue(stored)
    const res = await DELETE(del(), ctx('app-1'))

    expect(res.status).toBe(204)
    await expect(res.text()).resolves.toBe('')
    expect(deleteApplication).toHaveBeenCalledWith('user-1', 'app-1')
  })

  it('hands back the guard 401 untouched, having neither read nor deleted', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))

    expect((await DELETE(del(), ctx('app-1'))).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(deleteApplication).not.toHaveBeenCalled()
  })

  it('404s on an id that is not there, and deletes nothing', async () => {
    getApplication.mockResolvedValue(null)
    const res = await DELETE(del(), ctx('missing'))

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'not found' })
    expect(deleteApplication).not.toHaveBeenCalled()
  })

  it('cannot reach another user’s record: both calls carry the caller’s uid', async () => {
    // Every path in `@/lib/db` is rooted at users/{uid}, so somebody else's application id
    // reads back as missing under this caller — and the 404 lands before any delete. The read
    // is what makes that true, which is why it is not skipped as a redundant round trip.
    requireUser.mockResolvedValue({ uid: 'user-2' })
    getApplication.mockResolvedValue(null)

    const res = await DELETE(del(), ctx('app-1'))

    expect(getApplication).toHaveBeenCalledWith('user-2', 'app-1')
    expect(res.status).toBe(404)
    expect(deleteApplication).not.toHaveBeenCalled()
  })

  it('scopes the delete itself to the caller, not to anything in the request', async () => {
    requireUser.mockResolvedValue({ uid: 'user-2' })
    getApplication.mockResolvedValue(stored)

    await DELETE(del(), ctx('app-1'))

    expect(deleteApplication).toHaveBeenCalledWith('user-2', 'app-1')
  })
})
