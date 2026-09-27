import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, Profile } from '@/lib/types'

// The seed route with Firestore faked. What is under test is the contract around the write,
// not the world it writes (`tests/sampleWorld.test.ts` holds that): who may call it, what it
// refuses rather than duplicating or overwriting, and that all three documents land in the
// caller's own space.

const {
  requireUser, listApplications, getProfile, setProfile, createApplication, createInterview,
  getResume, setResume,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listApplications: vi.fn(),
  getProfile: vi.fn(),
  setProfile: vi.fn(),
  createApplication: vi.fn(),
  createInterview: vi.fn(),
  getResume: vi.fn(),
  setResume: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({
  listApplications,
  getProfile,
  setProfile,
  createApplication,
  createInterview,
  getResume,
  setResume,
  RESUME_CURRENT_ID: 'current',
}))

import { POST } from '@/app/api/sample/route'
import { SAMPLE_COMPANY } from '@/lib/sampleWorld'

const emptyProfile: Profile = { facts: [], standardAnswers: {}, voiceRules: [], gaps: [] }

const req = () => new Request('https://example.test/api/sample', { method: 'POST' })

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  listApplications.mockResolvedValue([])
  getProfile.mockResolvedValue(emptyProfile)
  getResume.mockResolvedValue(null)
  createApplication.mockResolvedValue('app-sample')
  createInterview.mockResolvedValue('round-1')
})

describe('POST /api/sample', () => {
  it('returns the guard verbatim and writes nothing when unauthenticated', async () => {
    const guard = new Response('{"error":"unauthenticated"}', { status: 401 })
    requireUser.mockResolvedValue(guard)

    const res = await POST(req())

    expect(res).toBe(guard)
    expect(res.status).toBe(401)
    expect(setProfile).not.toHaveBeenCalled()
    expect(createApplication).not.toHaveBeenCalled()
    expect(createInterview).not.toHaveBeenCalled()
  })

  it('writes the profile, the application and the round into the caller’s own space', async () => {
    const res = await POST(req())

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'app-sample' })

    expect(setProfile).toHaveBeenCalledTimes(1)
    const [profileUid, profile] = setProfile.mock.calls[0] as [string, Profile]
    expect(profileUid).toBe('user-1')
    expect(profile.facts[0].id).toBe('f1')

    expect(createApplication).toHaveBeenCalledTimes(1)
    const [appUid, app] = createApplication.mock.calls[0] as [string, Omit<Application, 'id'>]
    expect(appUid).toBe('user-1')
    expect(app.company).toBe(SAMPLE_COMPANY)
    // listApplications orders by createdAt: a seeded application without one never lists.
    expect(Number.isNaN(Date.parse(app.createdAt))).toBe(false)

    expect(createInterview).toHaveBeenCalledTimes(1)
    // The round has to hang off the application that was just written, not off a guess.
    expect(createInterview.mock.calls[0][0]).toBe('user-1')
    expect(createInterview.mock.calls[0][1]).toBe('app-sample')

    expect(setResume).toHaveBeenCalledTimes(1)
    const [rUid, rId, doc] = setResume.mock.calls[0]
    expect(rUid).toBe('user-1')
    expect(rId).toBe('current')
    expect(doc.filename).toBe('tom-candidate-resume.pdf')
    // The resume goes after the profile and before the interview, as the route comment says.
    expect(setProfile.mock.invocationCallOrder[0]).toBeLessThan(setResume.mock.invocationCallOrder[0])
    expect(setResume.mock.invocationCallOrder[0]).toBeLessThan(createInterview.mock.invocationCallOrder[0])
  })

  it('writes the application before the profile, so a half-write is still retryable', async () => {
    // There is no transaction. If the profile lands first and the application throws, the facts
    // guard refuses every retry and the only way back in is gone; this order fails into the
    // SAMPLE_COMPANY guard instead, which is the refusal that is actually true.
    await POST(req())

    expect(createApplication.mock.invocationCallOrder[0]).toBeLessThan(
      setProfile.mock.invocationCallOrder[0],
    )
  })

  it('refuses a second call rather than writing the world twice', async () => {
    listApplications.mockResolvedValue([{ id: 'app-sample', company: SAMPLE_COMPANY } as Application])

    const res = await POST(req())

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'sample already loaded' })
    expect(setProfile).not.toHaveBeenCalled()
    expect(createApplication).not.toHaveBeenCalled()
    expect(createInterview).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a real profile — setProfile replaces the whole document', async () => {
    getProfile.mockResolvedValue({
      ...emptyProfile,
      facts: [{ id: 'f1', claim: 'Mine', sourceSnippet: 'mine', tags: [] }],
    } satisfies Profile)

    const res = await POST(req())

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/profile/i)
    expect(setProfile).not.toHaveBeenCalled()
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('refuses with 409, and writes nothing, when the account already holds a resume of its own', async () => {
    getResume.mockResolvedValue({ addedAt: '2026-09-20T10:00:00.000Z' })

    const res = await POST(req())

    expect(res.status).toBe(409)
    expect(getResume).toHaveBeenCalledWith('user-1', 'current')
    expect(createApplication).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
    expect(setResume).not.toHaveBeenCalled()
    expect(createInterview).not.toHaveBeenCalled()
  })
})
