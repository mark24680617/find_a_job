import { describe, it, expect, vi, beforeEach } from 'vitest'

// The two helpers the account and admin routes share, against a fake Admin SDK: what a
// count is made of, and the one order a wipe is allowed to happen in. The fake records the
// names it is asked for, because a wipe aimed at the whole `users` collection would delete
// exactly once too, in exactly the right order.

const {
  countGet,
  docGet,
  docSet,
  meterGet,
  recursiveDelete,
  deleteUser,
  collectionOf,
  docOf,
  refs,
} = vi.hoisted(() => ({
  countGet: vi.fn(),
  docGet: vi.fn(),
  docSet: vi.fn(),
  meterGet: vi.fn(),
  recursiveDelete: vi.fn(),
  deleteUser: vi.fn(),
  collectionOf: vi.fn(),
  docOf: vi.fn(),
  // Filled in by the factory below, so a test can name the very ref the code walked to.
  refs: {} as { usersCol?: unknown; userDoc?: unknown; resumeDoc?: unknown },
}))

vi.mock('@/lib/firebase/admin', () => {
  // One shape for every collection the account helpers walk into: it counts, it hands back a
  // document by id, and a document hands back further collections. The names are recorded, so a
  // count aimed at the wrong collection is visible as a name rather than as a number.
  const makeCol = (name: string) => ({
    count: () => ({ get: countGet }),
    doc: (id: string) => {
      docOf(id)
      const ref = {
        id,
        get: name === 'uids' ? meterGet : docGet,
        set: docSet,
        collection: (child: string) => {
          collectionOf(child)
          return makeCol(child)
        },
      }
      if (name === 'resumes') refs.resumeDoc = ref
      return ref
    },
  })
  const userDocRef = {
    id: 'user-1',
    get: docGet,
    set: docSet,
    collection: (name: string) => {
      collectionOf(name)
      return makeCol(name)
    },
  }
  const usersCol = {
    doc: (id: string) => {
      docOf(id)
      return userDocRef
    },
  }
  refs.usersCol = usersCol
  refs.userDoc = userDocRef
  return {
    adminDb: {
      collection: (name: string) => {
        collectionOf(name)
        return name === 'users' ? usersCol : makeCol(name)
      },
      recursiveDelete,
    },
    adminAuth: { deleteUser },
  }
})

import { deleteResume, getResume, RESUME_CURRENT_ID, setResume, usageFor, wipeUser } from '@/lib/db'
import type { StoredResume } from '@/lib/types'

const RESUME: StoredResume = {
  addedAt: '2026-09-21T09:00:00.000Z',
  filename: 'resume.pdf',
  bytes: 1_024,
  text: 'Dana Ellery',
  lines: [],
  sections: [],
  entries: [],
  bullets: [],
  language: 'en',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T09:00:00.000Z'))
  countGet.mockResolvedValue({ data: () => ({ count: 3 }) })
  docGet.mockResolvedValue({ data: () => ({ facts: [{ id: 'f1' }, { id: 'f2' }] }) })
  meterGet.mockResolvedValue({ data: () => ({ diagnose: 2, gaps: 1, rewrite: 7 }) })
  recursiveDelete.mockResolvedValue(undefined)
  deleteUser.mockResolvedValue(undefined)
})

describe('usageFor', () => {
  it('counts applications and resumes with aggregates, facts off the profile, reviews off today’s meter', async () => {
    await expect(usageFor('user-1')).resolves.toEqual({
      applications: 3,
      facts: 2,
      resumes: 3,
      reviewsToday: 10,
    })
  })

  it('reads zeroes for an account that made no profile and ran nothing today', async () => {
    docGet.mockResolvedValue({ data: () => undefined })
    meterGet.mockResolvedValue({ data: () => undefined })
    const usage = await usageFor('user-1')
    expect(usage.facts).toBe(0)
    expect(usage.reviewsToday).toBe(0)
  })

  it('ignores a meter field that is not a count, rather than reporting NaN', async () => {
    meterGet.mockResolvedValue({ data: () => ({ diagnose: 'lots', gaps: -4, rewrite: 3 }) })
    await expect(usageFor('user-1')).resolves.toMatchObject({ reviewsToday: 3 })
  })
})

describe('the resume accessors', () => {
  it('reads a missing resume back as null, as getApplication does', async () => {
    docGet.mockResolvedValue({ data: () => undefined })
    await expect(getResume('user-1', RESUME_CURRENT_ID)).resolves.toBeNull()
    expect(collectionOf).toHaveBeenCalledWith('resumes')
    expect(docOf).toHaveBeenCalledWith('current')
  })

  it('writes the whole document, so an upload replaces text and structure in place', async () => {
    docSet.mockResolvedValue(undefined)
    await setResume('user-1', RESUME_CURRENT_ID, RESUME)
    expect(collectionOf).toHaveBeenCalledWith('resumes')
    expect(docSet).toHaveBeenCalledTimes(1)
    expect(docSet).toHaveBeenCalledWith(RESUME)
  })

  it('deletes through recursiveDelete, so the practice subcollection goes with it', async () => {
    await deleteResume('user-1', RESUME_CURRENT_ID)
    expect(recursiveDelete).toHaveBeenCalledTimes(1)
    expect(recursiveDelete.mock.calls[0][0]).toBe(refs.resumeDoc)
    expect(recursiveDelete.mock.calls[0][0]).not.toBe(refs.userDoc)
  })
})

describe('wipeUser', () => {
  it('deletes the data, then the Auth user — never the other way round', async () => {
    await wipeUser('user-1')
    expect(recursiveDelete).toHaveBeenCalledTimes(1)
    expect(deleteUser).toHaveBeenCalledWith('user-1')
    expect(recursiveDelete.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0])
  })

  it('walks to the one account it was given, not the collection holding everyone', async () => {
    await wipeUser('user-1')
    expect(collectionOf).toHaveBeenCalledWith('users')
    expect(docOf).toHaveBeenCalledWith('user-1')
    expect(recursiveDelete.mock.calls[0][0]).toBe(refs.userDoc)
    expect(recursiveDelete.mock.calls[0][0]).not.toBe(refs.usersCol)
  })

  it('leaves the Auth user in place when the data delete fails, so it can be retried', async () => {
    recursiveDelete.mockRejectedValue(new Error('firestore down'))
    await expect(wipeUser('user-1')).rejects.toThrow('firestore down')
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
