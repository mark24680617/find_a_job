import { describe, it, expect, vi, beforeEach } from 'vitest'

// Keep the unit test off the Admin SDK entirely: no credential lookup, no app init.
const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }))
vi.mock('@/lib/firebase/admin', () => ({ adminAuth: { verifyIdToken } }))

import { bearerToken, requireAdmin, requireUser } from '@/lib/auth'

describe('bearerToken', () => {
  it('extracts token', () => expect(bearerToken('Bearer abc.def')).toBe('abc.def'))
  it('rejects missing header', () => expect(bearerToken(null)).toBeNull())
  it('rejects non-bearer', () => expect(bearerToken('Basic xyz')).toBeNull())
  it('rejects an empty token', () => expect(bearerToken('Bearer ')).toBeNull())
  it('is case-sensitive on the scheme', () => expect(bearerToken('bearer abc')).toBeNull())
})

const req = (authorization?: string) =>
  new Request('https://example.test/api', authorization ? { headers: { authorization } } : undefined)

describe('requireUser', () => {
  // Block body on purpose: a concise arrow would return the mock, and Vitest treats a
  // function returned from beforeEach as a teardown callback and calls it after the test.
  beforeEach(() => {
    verifyIdToken.mockReset()
  })

  it('returns the uid for a valid token', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'user-1' })
    await expect(requireUser(req('Bearer good.token'))).resolves.toEqual({ uid: 'user-1' })
    expect(verifyIdToken).toHaveBeenCalledWith('good.token')
  })

  it('401s without a bearer header, without calling the SDK', async () => {
    const res = (await requireUser(req())) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(verifyIdToken).not.toHaveBeenCalled()
  })

  it('401s when the token is rejected', async () => {
    verifyIdToken.mockRejectedValue(new Error('token expired'))
    const res = (await requireUser(req('Bearer bad.token'))) as Response
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'invalid token' })
  })
})

describe('requireAdmin', () => {
  beforeEach(() => {
    verifyIdToken.mockReset()
  })

  it('returns the uid when the token carries the admin claim', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'admin-1', admin: true })
    await expect(requireAdmin(req('Bearer good.token'))).resolves.toEqual({ uid: 'admin-1' })
  })

  it('403s a valid token without the claim — signed in is not the same as allowed', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'user-1' })
    const res = (await requireAdmin(req('Bearer good.token'))) as Response
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('403s a claim that is anything but literally true', async () => {
    for (const admin of ['true', 1, {}, null]) {
      verifyIdToken.mockResolvedValue({ uid: 'user-1', admin })
      expect(((await requireAdmin(req('Bearer good.token'))) as Response).status).toBe(403)
    }
  })

  it('401s without a bearer header and on a rejected token, like requireUser', async () => {
    expect(((await requireAdmin(req())) as Response).status).toBe(401)
    verifyIdToken.mockRejectedValue(new Error('token expired'))
    expect(((await requireAdmin(req('Bearer bad.token'))) as Response).status).toBe(401)
  })
})
