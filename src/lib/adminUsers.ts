import type { AdminUser, Usage } from '@/lib/types'

/**
 * The admin panel's data, kept pure: the mapping from a Firebase user record to the row
 * the table shows, the claim merge the grant script performs, and the two list operations
 * the screen does in the browser. None of it touches the Admin SDK, so all of it is
 * unit-tested without one.
 */

/**
 * The slice of firebase-admin's `UserRecord` this needs. Structural, so a test can build one
 * from a literal and the route can pass the real record straight through.
 */
export interface AuthRecord {
  uid: string
  email?: string
  emailVerified: boolean
  displayName?: string
  disabled: boolean
  providerData: { providerId: string }[]
  // Firebase gives these as UTC strings ("Fri, 28 Aug 2026 02:51:50 GMT"), and leaves
  // lastSignInTime unset on an account that has never signed in.
  metadata: { creationTime?: string; lastSignInTime?: string }
}

/** ISO for the wire; null when Firebase gave nothing, or nothing parseable. */
function toIso(utc: string | undefined): string | null {
  if (!utc) return null
  const ms = Date.parse(utc)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export function toAdminUser(record: AuthRecord, usage: Usage): AdminUser {
  return {
    uid: record.uid,
    email: record.email ?? '',
    emailVerified: record.emailVerified,
    displayName: record.displayName ?? '',
    provider: record.providerData[0]?.providerId ?? '',
    createdAt: toIso(record.metadata.creationTime) ?? '',
    lastSignInAt: toIso(record.metadata.lastSignInTime),
    disabled: record.disabled,
    applications: usage.applications,
    facts: usage.facts,
  }
}

/**
 * The claims to write back: the existing ones with `admin` set or removed. Custom claims are
 * replaced wholesale by `setCustomUserClaims`, so a grant that wrote `{ admin: true }` alone
 * would silently drop anything else that was there.
 */
export function withAdminClaim(
  existing: Record<string, unknown> | undefined,
  grant: boolean,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) }
  delete next.admin
  if (grant) next.admin = true
  return next
}

/** Most recent sign-in first; accounts that never signed in at the end. Does not mutate. */
export function sortByLastSignIn(users: AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => {
    if (a.lastSignInAt === b.lastSignInAt) return 0
    if (a.lastSignInAt === null) return 1
    if (b.lastSignInAt === null) return -1
    return a.lastSignInAt < b.lastSignInAt ? 1 : -1
  })
}

/** Case-insensitive match on email or name; a blank query keeps everything. */
export function filterUsers(users: AdminUser[], query: string): AdminUser[] {
  const q = query.trim().toLowerCase()
  if (q === '') return users
  return users.filter(
    (u) => u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q),
  )
}
