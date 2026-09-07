import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FieldValue } from 'firebase-admin/firestore'
import type { Assignment } from '@/lib/types'

// `replaceAssignment` against a fake Admin SDK: what the one write carries, and the path it
// walks to get there. The delete sentinel is the whole reason the helper exists — the app is
// configured with `ignoreUndefinedProperties` (src/lib/firebase/admin.ts), so a patch that set
// `takeHome: undefined` would be dropped on the floor and the old plan would sit under the new
// brief with nothing on screen saying so.

const { update, collectionOf, docOf } = vi.hoisted(() => ({
  update: vi.fn(),
  collectionOf: vi.fn(),
  docOf: vi.fn(),
}))

vi.mock('@/lib/firebase/admin', () => {
  // One chainable ref standing in for every collection and document on the way down, recording
  // the names it is asked for: a write aimed at the wrong round would be one update too.
  const ref = {
    collection: (name: string) => {
      collectionOf(name)
      return ref
    },
    doc: (id: string) => {
      docOf(id)
      return ref
    },
    update,
  }
  return { adminDb: ref, adminAuth: {} }
})

import { replaceAssignment } from '@/lib/db'

const assignment: Assignment = {
  text: 'Build a small service that ingests the attached ledger file.',
  source: 'pdf',
  addedAt: '2026-09-06T09:00:00.000Z',
  cut: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  update.mockResolvedValue(undefined)
})

describe('replaceAssignment', () => {
  it('stores the brief and deletes the plan it invalidates, in one write', async () => {
    await replaceAssignment('user-1', 'app-1', 'r-1', assignment)

    expect(update).toHaveBeenCalledTimes(1)
    const patch = update.mock.calls[0][0] as { assignment: Assignment; takeHome: FieldValue }
    // Two keys and no others: the notice is what arrived and a brief is not, so `noticeRaw` is
    // untouched, and the chat and the round's own fields are none of this helper's business.
    expect(Object.keys(patch).sort()).toEqual(['assignment', 'takeHome'])
    expect(patch.assignment).toEqual(assignment)
    // The sentinel itself, not an `undefined` the SDK is configured to ignore.
    expect(patch.takeHome).toBeInstanceOf(FieldValue)
    expect(patch.takeHome.isEqual(FieldValue.delete())).toBe(true)
  })

  it('writes to the one round it was given, under the one account', async () => {
    await replaceAssignment('user-1', 'app-1', 'r-1', assignment)

    expect(collectionOf.mock.calls.map((c) => c[0])).toEqual([
      'users',
      'applications',
      'interviews',
    ])
    expect(docOf.mock.calls.map((c) => c[0])).toEqual(['user-1', 'app-1', 'r-1'])
  })
})
