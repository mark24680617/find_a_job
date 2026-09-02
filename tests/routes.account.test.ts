import { describe, it, expect, vi, beforeEach } from 'vitest'

// The signed-in person's own account: what they hold, and the one call that removes it all.
// Faked behind it: auth and the two db helpers. The order inside `wipeUser` is that helper's
// own test; here only that it is called for the caller's uid and nobody else's.

const { requireUser, usageFor, wipeUser } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  usageFor: vi.fn(),
  wipeUser: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ usageFor, wipeUser }))

import { DELETE, GET } from '@/app/api/account/route'

const req = (method: string) => new Request('https://example.test/api/account', { method })

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  usageFor.mockResolvedValue({ applications: 4, facts: 18 })
  wipeUser.mockResolvedValue(undefined)
})

describe('GET /api/account', () => {
  it('answers the caller’s usage', async () => {
    const res = await GET(req('GET'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ applications: 4, facts: 18 })
    expect(usageFor).toHaveBeenCalledWith('user-1')
  })

  it('401s before touching the db', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await GET(req('GET'))).status).toBe(401)
    expect(usageFor).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/account', () => {
  it('wipes the caller and answers 204 with no body', async () => {
    const res = await DELETE(req('DELETE'))
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(wipeUser).toHaveBeenCalledWith('user-1')
  })

  it('401s before wiping anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await DELETE(req('DELETE'))).status).toBe(401)
    expect(wipeUser).not.toHaveBeenCalled()
  })
})
