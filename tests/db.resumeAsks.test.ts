import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnsweredAsk } from '@/lib/types'

// `appendResumeAsk` against a fake Admin SDK whose `runTransaction` hands the callback a fake
// transaction, as tests/resume.meter.test.ts does. The checks and the append happen on one read
// inside the transaction, so a second tab cannot slip a write between them.

const { txGet, txUpdate, runTransaction, pathsWalked } = vi.hoisted(() => ({
  txGet: vi.fn(),
  txUpdate: vi.fn(),
  runTransaction: vi.fn(),
  pathsWalked: [] as string[],
}))

vi.mock('@/lib/firebase/admin', () => {
  const ref = {
    collection: (name: string) => {
      pathsWalked.push(name)
      return ref
    },
    doc: (id: string) => {
      pathsWalked.push(id)
      return ref
    },
  }
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

import { appendResumeAsk } from '@/lib/db'

const ask = (askId: string): AnsweredAsk => ({
  askId,
  question: 'Have you done this?',
  answer: 'Yes, twice.',
  answeredAt: '2026-09-25T10:00:00.000Z',
})

const holding = (asks?: AnsweredAsk[]) =>
  txGet.mockResolvedValue({ exists: true, data: () => (asks ? { asks } : {}) })

beforeEach(() => {
  vi.resetAllMocks()
  pathsWalked.length = 0
})

describe('appendResumeAsk', () => {
  it('is missing when there is no resume document, and writes nothing', async () => {
    txGet.mockResolvedValue({ exists: false, data: () => undefined })
    expect(await appendResumeAsk('user-1', 'current', ask('a1'), 100)).toBe('missing')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is a duplicate when the askId is already stored, and writes nothing', async () => {
    holding([ask('a1')])
    expect(await appendResumeAsk('user-1', 'current', ask('a1'), 100)).toBe('duplicate')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('reports a duplicate ahead of a full list', async () => {
    holding([ask('a1'), ask('a2')])
    expect(await appendResumeAsk('user-1', 'current', ask('a1'), 2)).toBe('duplicate')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('is full once the list holds maxAsks, and writes nothing', async () => {
    holding(Array.from({ length: 100 }, (_, i) => ask(`gaps-skill-${i}`)))
    expect(await appendResumeAsk('user-1', 'current', ask('a1'), 100)).toBe('full')
    expect(txUpdate).not.toHaveBeenCalled()
  })

  it('appends after the asks already stored, keeping their order, inside the transaction', async () => {
    holding([ask('rewrite-b7-3f2a9c1d')])
    expect(await appendResumeAsk('user-1', 'current', ask('gaps-apache-kafka'), 100)).toBe('appended')
    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(pathsWalked).toEqual(['users', 'user-1', 'resumes', 'current'])
    expect(txUpdate).toHaveBeenCalledTimes(1)
    expect(txUpdate.mock.calls[0][1]).toEqual({
      asks: [ask('rewrite-b7-3f2a9c1d'), ask('gaps-apache-kafka')],
    })
  })

  it('appends to a resume with no asks yet, and takes the last one below the cap', async () => {
    holding()
    expect(await appendResumeAsk('user-1', 'current', ask('a1'), 100)).toBe('appended')
    expect(txUpdate.mock.calls[0][1]).toEqual({ asks: [ask('a1')] })

    vi.resetAllMocks()
    holding(Array.from({ length: 99 }, (_, i) => ask(`gaps-skill-${i}`)))
    expect(await appendResumeAsk('user-1', 'current', ask('a1'), 100)).toBe('appended')
    expect((txUpdate.mock.calls[0][1] as { asks: AnsweredAsk[] }).asks).toHaveLength(100)
  })
})
