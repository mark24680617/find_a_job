import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AcceptedRewrite } from '@/lib/types'

// `appendResumeRewrite` against a fake Admin SDK, as tests/db.resumeAsks.test.ts does. The basis
// check and the append happen on one read inside the transaction, so a second tab's accept or an
// upload cannot slip a write between them.

const { txGet, txUpdate, runTransaction } = vi.hoisted(() => ({
  txGet: vi.fn(),
  txUpdate: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('@/lib/firebase/admin', () => {
  const ref = { collection: () => ref, doc: () => ref }
  return {
    adminDb: {
      ...ref,
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
        runTransaction(fn)
        return fn({ get: txGet, update: txUpdate })
      },
    },
    adminAuth: {},
  }
})

import { appendResumeRewrite } from '@/lib/db'

const ADDED_AT = '2026-09-21T10:00:00.000Z'

const rewrite = (bulletId: string): AcceptedRewrite => ({
  reviewedFrom: ADDED_AT,
  judge: 'jev',
  acceptedAt: '2026-09-25T10:00:00.000Z',
  bulletId,
  text: 'Ran the payments service.',
  citations: [],
  recheck: [],
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('appendResumeRewrite', () => {
  it('appends after the rewrites already stored, in a single update inside the transaction', async () => {
    txGet.mockResolvedValue({ exists: true, data: () => ({ addedAt: ADDED_AT, rewrites: [rewrite('b2')] }) })
    expect(await appendResumeRewrite('user-1', 'current', rewrite('b1'))).toBe('appended')
    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(txUpdate).toHaveBeenCalledTimes(1)
    expect(txUpdate.mock.calls[0][1]).toEqual({ rewrites: [rewrite('b2'), rewrite('b1')] })
  })

  it('is missing when there is no resume document, and writes nothing', async () => {
    txGet.mockResolvedValue({ exists: false, data: () => undefined })
    expect(await appendResumeRewrite('user-1', 'current', rewrite('b1'))).toBe('missing')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is moved when the stored upload is not the one the rewrite was written against, and writes nothing', async () => {
    txGet.mockResolvedValue({ exists: true, data: () => ({ addedAt: '2026-09-22T08:00:00.000Z' }) })
    expect(await appendResumeRewrite('user-1', 'current', rewrite('b1'))).toBe('moved')
    expect(txUpdate).not.toHaveBeenCalled()
  })
})
