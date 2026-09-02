import { describe, it, expect } from 'vitest'
import { filterUsers, sortByLastSignIn, toAdminUser, withAdminClaim } from '@/lib/adminUsers'
import type { AdminUser } from '@/lib/types'

// The mapping from a Firebase UserRecord to what the admin table shows, and the claim merge
// the grant script performs. Both are pure so they are pinned here without the Admin SDK.

const record = {
  uid: 'u1',
  email: 'mark@example.com',
  emailVerified: false,
  displayName: 'Mark',
  disabled: false,
  providerData: [{ providerId: 'password' }],
  // Firebase's metadata dates are UTC strings, not ISO.
  metadata: { creationTime: 'Fri, 28 Aug 2026 02:51:50 GMT', lastSignInTime: 'Tue, 01 Sep 2026 22:25:00 GMT' },
}

describe('toAdminUser', () => {
  it('maps the record and attaches the usage counts', () => {
    expect(toAdminUser(record, { applications: 5, facts: 12 })).toEqual({
      uid: 'u1',
      email: 'mark@example.com',
      emailVerified: false,
      displayName: 'Mark',
      provider: 'password',
      createdAt: '2026-08-28T02:51:50.000Z',
      lastSignInAt: '2026-09-01T22:25:00.000Z',
      disabled: false,
      applications: 5,
      facts: 12,
    } satisfies AdminUser)
  })

  it('takes the first linked provider, and empty strings for what Firebase left unset', () => {
    const google = toAdminUser(
      { ...record, email: undefined, displayName: undefined, providerData: [{ providerId: 'google.com' }, { providerId: 'password' }] },
      { applications: 0, facts: 0 },
    )
    expect(google.provider).toBe('google.com')
    expect(google.email).toBe('')
    expect(google.displayName).toBe('')
  })

  it('reports never-signed-in as null rather than an empty string or epoch', () => {
    const never = toAdminUser({ ...record, metadata: { creationTime: record.metadata.creationTime } }, { applications: 0, facts: 0 })
    expect(never.lastSignInAt).toBeNull()
    expect(never.createdAt).toBe('2026-08-28T02:51:50.000Z')
  })

  it('has no provider when no provider is linked', () => {
    expect(toAdminUser({ ...record, providerData: [] }, { applications: 0, facts: 0 }).provider).toBe('')
  })
})

describe('withAdminClaim', () => {
  it('grants onto whatever claims are already there', () => {
    expect(withAdminClaim({ beta: true }, true)).toEqual({ beta: true, admin: true })
    expect(withAdminClaim(undefined, true)).toEqual({ admin: true })
  })
  it('revokes only the admin key, keeping the rest', () => {
    expect(withAdminClaim({ beta: true, admin: true }, false)).toEqual({ beta: true })
    expect(withAdminClaim(undefined, false)).toEqual({})
  })
  it('does not mutate what it was given', () => {
    const existing = { admin: true }
    withAdminClaim(existing, false)
    expect(existing).toEqual({ admin: true })
  })
})

const user = (over: Partial<AdminUser>): AdminUser => ({
  uid: 'u',
  email: 'a@example.com',
  emailVerified: true,
  displayName: '',
  provider: 'password',
  createdAt: '2026-08-01T00:00:00.000Z',
  lastSignInAt: null,
  disabled: false,
  applications: 0,
  facts: 0,
  ...over,
})

describe('sortByLastSignIn', () => {
  it('puts the most recent first and never-signed-in last, without mutating the input', () => {
    const a = user({ uid: 'a', lastSignInAt: '2026-09-01T00:00:00.000Z' })
    const b = user({ uid: 'b', lastSignInAt: null })
    const c = user({ uid: 'c', lastSignInAt: '2026-09-02T00:00:00.000Z' })
    const input = [a, b, c]
    expect(sortByLastSignIn(input).map((u) => u.uid)).toEqual(['c', 'a', 'b'])
    expect(input.map((u) => u.uid)).toEqual(['a', 'b', 'c'])
  })
})

describe('filterUsers', () => {
  const rows = [
    user({ uid: 'a', email: 'mark@luqlabs.com', displayName: 'Mark Qiu' }),
    user({ uid: 'b', email: 'tom@example.com', displayName: '' }),
  ]
  it('matches email or name, case-insensitively, trimmed', () => {
    expect(filterUsers(rows, '  QIU ').map((u) => u.uid)).toEqual(['a'])
    expect(filterUsers(rows, 'example').map((u) => u.uid)).toEqual(['b'])
  })
  it('returns everything for a blank query', () => {
    expect(filterUsers(rows, '   ')).toEqual(rows)
  })
})
