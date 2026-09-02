import { describe, it, expect, vi, beforeEach } from 'vitest'

// The two helpers the account and admin routes share, against a fake Admin SDK: what a
// count is made of, and the one order a wipe is allowed to happen in. The fake records the
// names it is asked for, because a wipe aimed at the whole `users` collection would delete
// exactly once too, in exactly the right order.

const { countGet, docGet, recursiveDelete, deleteUser, collectionOf, docOf, refs } = vi.hoisted(
  () => ({
    countGet: vi.fn(),
    docGet: vi.fn(),
    recursiveDelete: vi.fn(),
    deleteUser: vi.fn(),
    collectionOf: vi.fn(),
    docOf: vi.fn(),
    // Filled in by the factory below, so a test can name the very ref the code walked to.
    refs: {} as { usersCol?: unknown; userDoc?: unknown; appsCol?: unknown },
  }),
)

vi.mock('@/lib/firebase/admin', () => {
  const appsCol = { count: () => ({ get: countGet }) }
  const userDocRef = {
    id: 'user-1',
    get: docGet,
    collection: (name: string) => {
      collectionOf(name)
      return appsCol
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
  refs.appsCol = appsCol
  return {
    adminDb: {
      collection: (name: string) => {
        collectionOf(name)
        return usersCol
      },
      recursiveDelete,
    },
    adminAuth: { deleteUser },
  }
})

import { usageFor, wipeUser } from '@/lib/db'

beforeEach(() => {
  vi.resetAllMocks()
  countGet.mockResolvedValue({ data: () => ({ count: 3 }) })
  docGet.mockResolvedValue({ data: () => ({ facts: [{ id: 'f1' }, { id: 'f2' }] }) })
  recursiveDelete.mockResolvedValue(undefined)
  deleteUser.mockResolvedValue(undefined)
})

describe('usageFor', () => {
  it('counts applications with an aggregate and facts off the profile document', async () => {
    await expect(usageFor('user-1')).resolves.toEqual({ applications: 3, facts: 2 })
  })

  it('reads zero facts for an account that never made a profile', async () => {
    docGet.mockResolvedValue({ data: () => undefined })
    await expect(usageFor('user-1')).resolves.toEqual({ applications: 3, facts: 0 })
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
