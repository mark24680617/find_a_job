import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, getInterview } = vi.hoisted(() => ({ requireUser: vi.fn(), getInterview: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getInterview }))

import { GET } from '@/app/api/applications/[id]/interviews/[rid]/route'

const req = () => new Request('https://example.test/api/applications/app-1/interviews/r1')
const ctx = { params: Promise.resolve({ id: 'app-1', rid: 'r1' }) }

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
})

describe('GET /api/applications/[id]/interviews/[rid]', () => {
  it('answers the round', async () => {
    getInterview.mockResolvedValue({ id: 'r1', roundType: 'technical', noticeRaw: '', people: [], chat: [], createdAt: 'x' })
    const res = await GET(req(), ctx)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ id: 'r1' })
    expect(getInterview).toHaveBeenCalledWith('user-1', 'app-1', 'r1')
  })
  it('404s a round that is not there and 401s without a user', async () => {
    getInterview.mockResolvedValue(null)
    expect((await GET(req(), ctx)).status).toBe(404)
    requireUser.mockResolvedValue(new Response('{}', { status: 401 }))
    expect((await GET(req(), ctx)).status).toBe(401)
  })
})
