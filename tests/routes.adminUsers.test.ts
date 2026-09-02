import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AdminUser } from '@/lib/types'

// The administrator's routes with the Admin SDK faked. Under test: the guard runs first,
// the list carries usage per account and the page token through, and — for the two actions
// — that the caller can never point them at their own account.

const { requireAdmin, usageFor, wipeUser } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  usageFor: vi.fn(),
  wipeUser: vi.fn(),
}))
const { listUsers, updateUser, revokeRefreshTokens, getUser } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  revokeRefreshTokens: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireAdmin }))
vi.mock('@/lib/db', () => ({ usageFor, wipeUser }))
vi.mock('@/lib/firebase/admin', () => ({
  adminAuth: { listUsers, updateUser, revokeRefreshTokens, getUser },
}))

import { GET } from '@/app/api/admin/users/route'
import { DELETE, PATCH } from '@/app/api/admin/users/[uid]/route'

const record = (uid: string, email: string) => ({
  uid,
  email,
  emailVerified: true,
  displayName: '',
  disabled: false,
  providerData: [{ providerId: 'google.com' }],
  metadata: { creationTime: 'Fri, 28 Aug 2026 02:51:50 GMT', lastSignInTime: 'Tue, 01 Sep 2026 22:25:00 GMT' },
})

const forbidden = () => new Response('{"error":"forbidden"}', { status: 403 })

beforeEach(() => {
  vi.resetAllMocks()
  requireAdmin.mockResolvedValue({ uid: 'admin-1' })
  usageFor.mockImplementation(async (uid: string) => ({ applications: uid === 'u1' ? 5 : 0, facts: 1 }))
  listUsers.mockResolvedValue({ users: [record('u1', 'a@example.com'), record('u2', 'b@example.com')] })
})

describe('GET /api/admin/users', () => {
  it('403s a non-admin before listing anyone', async () => {
    requireAdmin.mockResolvedValue(forbidden())
    const res = await GET(new Request('https://example.test/api/admin/users'))
    expect(res.status).toBe(403)
    expect(listUsers).not.toHaveBeenCalled()
  })

  it('lists every account with its usage attached', async () => {
    const res = await GET(new Request('https://example.test/api/admin/users'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { users: AdminUser[]; nextPageToken?: string }
    expect(body.users.map((u) => [u.uid, u.email, u.applications, u.facts])).toEqual([
      ['u1', 'a@example.com', 5, 1],
      ['u2', 'b@example.com', 0, 1],
    ])
    expect(body.users[0].createdAt).toBe('2026-08-28T02:51:50.000Z')
    expect(body).not.toHaveProperty('nextPageToken')
    expect(listUsers).toHaveBeenCalledWith(1000, undefined)
  })

  it('passes a page token in, and the next one out only when Firebase gives one', async () => {
    listUsers.mockResolvedValue({ users: [record('u3', 'c@example.com')], pageToken: 'tok-2' })
    const res = await GET(new Request('https://example.test/api/admin/users?pageToken=tok-1'))
    expect(listUsers).toHaveBeenCalledWith(1000, 'tok-1')
    await expect(res.json()).resolves.toMatchObject({ nextPageToken: 'tok-2' })
  })

  it('treats an empty page token as none', async () => {
    await GET(new Request('https://example.test/api/admin/users?pageToken='))
    expect(listUsers).toHaveBeenCalledWith(1000, undefined)
  })
})

const ctx = (uid: string) => ({ params: Promise.resolve({ uid }) })
const patch = (uid: string, body: unknown) =>
  PATCH(
    new Request(`https://example.test/api/admin/users/${uid}`, { method: 'PATCH', body: JSON.stringify(body) }),
    ctx(uid),
  )
const del = (uid: string) =>
  DELETE(new Request(`https://example.test/api/admin/users/${uid}`, { method: 'DELETE' }), ctx(uid))

// What firebase-admin throws for an unknown uid: an error carrying a code, matched on the code.
const notFound = () => Object.assign(new Error('There is no user record'), { code: 'auth/user-not-found' })

describe('PATCH /api/admin/users/[uid]', () => {
  beforeEach(() => {
    updateUser.mockImplementation(async (uid: string, patch: { disabled: boolean }) => ({
      ...record(uid, 'a@example.com'),
      disabled: patch.disabled,
    }))
    revokeRefreshTokens.mockResolvedValue(undefined)
  })

  it('403s a non-admin before touching anyone', async () => {
    requireAdmin.mockResolvedValue(forbidden())
    expect((await patch('u1', { disabled: true })).status).toBe(403)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('400s anything but a boolean, before reading the uid', async () => {
    for (const disabled of ['true', 1, undefined, null]) {
      expect((await patch('u1', { disabled })).status).toBe(400)
    }
    expect((await patch('u1', null)).status).toBe(400)
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('refuses to change the caller’s own account, with a sentence that says so', async () => {
    const res = await patch('admin-1', { disabled: true })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'you cannot change your own account here' })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('disables, revokes the session tokens, and answers the row as it now is', async () => {
    const res = await patch('u1', { disabled: true })
    expect(res.status).toBe(200)
    expect(updateUser).toHaveBeenCalledWith('u1', { disabled: true })
    expect(revokeRefreshTokens).toHaveBeenCalledWith('u1')
    const body = (await res.json()) as AdminUser
    expect(body.disabled).toBe(true)
    expect(body.applications).toBe(5)
  })

  it('enables without revoking anything — there is nothing to cut off', async () => {
    const res = await patch('u1', { disabled: false })
    expect(res.status).toBe(200)
    expect(revokeRefreshTokens).not.toHaveBeenCalled()
  })

  it('404s an unknown uid', async () => {
    updateUser.mockRejectedValue(notFound())
    expect((await patch('ghost', { disabled: true })).status).toBe(404)
    expect(revokeRefreshTokens).not.toHaveBeenCalled()
  })

  it('lets any other Firebase failure surface as a 500', async () => {
    updateUser.mockRejectedValue(new Error('quota'))
    await expect(patch('u1', { disabled: true })).rejects.toThrow('quota')
  })
})

describe('DELETE /api/admin/users/[uid]', () => {
  beforeEach(() => {
    getUser.mockResolvedValue(record('u1', 'a@example.com'))
    wipeUser.mockResolvedValue(undefined)
  })

  it('403s a non-admin before looking anyone up', async () => {
    requireAdmin.mockResolvedValue(forbidden())
    expect((await del('u1')).status).toBe(403)
    expect(getUser).not.toHaveBeenCalled()
    expect(wipeUser).not.toHaveBeenCalled()
  })

  it('refuses the caller’s own account', async () => {
    const res = await del('admin-1')
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'you cannot change your own account here' })
    expect(wipeUser).not.toHaveBeenCalled()
  })

  it('404s an unknown uid before wiping — a silent no-op would read as a delete', async () => {
    getUser.mockRejectedValue(notFound())
    expect((await del('ghost')).status).toBe(404)
    expect(wipeUser).not.toHaveBeenCalled()
  })

  it('wipes a known account and answers 204', async () => {
    const res = await del('u1')
    expect(res.status).toBe(204)
    expect(wipeUser).toHaveBeenCalledWith('u1')
  })
})
