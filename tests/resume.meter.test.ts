import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The two ceilings, both taken in one transaction before any model call. Firestore is faked the
// way the account helpers' own test fakes it (tests/db.account.test.ts): a collection hands back
// a document by id, a document hands back further collections, and the names are recorded — a
// permit taken against the wrong path would otherwise pass every count assertion below.

const { dayGet, uidGet, txSet, runTransaction, pathsWalked } = vi.hoisted(() => ({
  dayGet: vi.fn(),
  uidGet: vi.fn(),
  txSet: vi.fn(),
  runTransaction: vi.fn(),
  pathsWalked: [] as string[],
}))

vi.mock('@/lib/firebase/admin', () => {
  const uidDoc = { path: 'meters/2026-09-21/uids/user-1' }
  const dayDoc = {
    path: 'meters/2026-09-21',
    get: dayGet,
    collection: (name: string) => {
      pathsWalked.push(name)
      return { doc: (id: string) => { pathsWalked.push(id); return { ...uidDoc, get: uidGet } } }
    },
  }
  return {
    adminDb: {
      collection: (name: string) => {
        pathsWalked.push(name)
        return { doc: (id: string) => { pathsWalked.push(id); return dayDoc } }
      },
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
        runTransaction(fn)
        return fn({
          getAll: async (...refs: { get: () => Promise<unknown> }[]) =>
            Promise.all(refs.map((ref) => ref.get())),
          set: txSet,
        })
      },
    },
    adminAuth: {},
  }
})

import {
  DEPLOYMENT_CEILING_DEFAULT,
  DEPLOYMENT_SPENT_MESSAGE,
  deploymentCeiling,
  DIAGNOSE_BULLETS_PER_UNIT,
  diagnoseCost,
  permitRefusal,
  resumeToolsEnabled,
  reviewsToday,
  takePermit,
  TOOLS_OFF_MESSAGE,
  UID_CEILING,
  UID_SPENT_MESSAGE,
} from '@/lib/resume/meter'

const DAY = '2026-09-21'
const original = { ...process.env }

beforeEach(() => {
  vi.resetAllMocks()
  pathsWalked.length = 0
  dayGet.mockResolvedValue({ data: () => ({ total: 0 }) })
  uidGet.mockResolvedValue({ data: () => ({}) })
})

afterEach(() => {
  process.env = { ...original }
})

describe('the ceilings', () => {
  it('holds the per-uid numbers the spec fixes, plus the upload ceiling the plan adds', () => {
    expect(UID_CEILING).toEqual({ upload: 20, diagnose: 10, gaps: 10, rewrite: 40 })
  })

  it('reads the per-deployment ceiling off the environment, and falls back to the default', () => {
    delete process.env.RESUME_DEPLOYMENT_CEILING
    expect(deploymentCeiling()).toBe(DEPLOYMENT_CEILING_DEFAULT)
    process.env.RESUME_DEPLOYMENT_CEILING = '40'
    expect(deploymentCeiling()).toBe(40)
    process.env.RESUME_DEPLOYMENT_CEILING = 'lots'
    expect(deploymentCeiling()).toBe(DEPLOYMENT_CEILING_DEFAULT)
    process.env.RESUME_DEPLOYMENT_CEILING = '-1'
    expect(deploymentCeiling()).toBe(DEPLOYMENT_CEILING_DEFAULT)
  })

  it('prices Diagnose at one unit per 20 judged bullets begun, never less than one', () => {
    // (final review, extract-4 / routes-2) spec §11's Diagnose row is priced on 20 bullets.
    expect(DIAGNOSE_BULLETS_PER_UNIT).toBe(20)
    expect([0, 1, 20, 21, 40, 41, 200].map(diagnoseCost)).toEqual([1, 1, 1, 2, 2, 3, 10])
    // The bullet bound's worst case is one account's whole Diagnose day, and no more.
    expect(diagnoseCost(200)).toBe(UID_CEILING.diagnose)
  })

  it('is off unless the switch says the literal true', () => {
    delete process.env.RESUME_TOOLS_ENABLED
    expect(resumeToolsEnabled()).toBe(false)
    process.env.RESUME_TOOLS_ENABLED = 'TRUE'
    expect(resumeToolsEnabled()).toBe(false)
    process.env.RESUME_TOOLS_ENABLED = 'true'
    expect(resumeToolsEnabled()).toBe(true)
  })
})

describe('the refusals', () => {
  // (amended 2026-09-24, R49) One wording per refusal, shared by every metered route, so five
  // routes cannot drift into five sentences — and every apostrophe typographic, because the page
  // renders them.
  it('answers each ceiling with its own sentence and names which one stopped the run', () => {
    expect(permitRefusal('uid-limit')).toEqual({
      status: 429,
      body: { error: UID_SPENT_MESSAGE, ceiling: 'uid' },
    })
    expect(permitRefusal('deployment-limit')).toEqual({
      status: 429,
      body: { error: DEPLOYMENT_SPENT_MESSAGE, ceiling: 'deployment' },
    })
    for (const sentence of [TOOLS_OFF_MESSAGE, UID_SPENT_MESSAGE, DEPLOYMENT_SPENT_MESSAGE]) {
      expect(sentence).not.toContain("'")
    }
    expect(UID_SPENT_MESSAGE).toContain('’')
    expect(DEPLOYMENT_SPENT_MESSAGE).toContain('’')
  })
})

describe('takePermit', () => {
  it('reads and increments both counters inside one transaction', async () => {
    await expect(takePermit('user-1', 'diagnose', DAY)).resolves.toBe('ok')
    expect(runTransaction).toHaveBeenCalledTimes(1)
    expect(pathsWalked).toEqual(['meters', DAY, 'uids', 'user-1'])
    expect(txSet).toHaveBeenCalledTimes(2)
    expect(txSet.mock.calls[0][1]).toEqual({ diagnose: 1 })
    expect(txSet.mock.calls[1][1]).toEqual({ total: 1 })
    expect(txSet.mock.calls[0][2]).toEqual({ merge: true })
  })

  it('takes the bullet count for rewrite, not one per call', async () => {
    uidGet.mockResolvedValue({ data: () => ({ rewrite: 6 }) })
    await expect(takePermit('user-1', 'rewrite', DAY, 4)).resolves.toBe('ok')
    expect(txSet.mock.calls[0][1]).toEqual({ rewrite: 10 })
    expect(txSet.mock.calls[1][1]).toEqual({ total: 4 })
  })

  it('refuses at the per-uid ceiling and increments nothing', async () => {
    uidGet.mockResolvedValue({ data: () => ({ diagnose: 10 }) })
    await expect(takePermit('user-1', 'diagnose', DAY)).resolves.toBe('uid-limit')
    expect(txSet).not.toHaveBeenCalled()
  })

  it('refuses a cost that would step over the ceiling, rather than clipping it', async () => {
    uidGet.mockResolvedValue({ data: () => ({ rewrite: 38 }) })
    await expect(takePermit('user-1', 'rewrite', DAY, 4)).resolves.toBe('uid-limit')
    expect(txSet).not.toHaveBeenCalled()
  })

  it('meters uploads on their own counter, at their own ceiling', async () => {
    uidGet.mockResolvedValue({ data: () => ({ upload: 19, diagnose: 10 }) })
    // A spent diagnose ceiling does not stop an upload: the counters are per tool.
    await expect(takePermit('user-1', 'upload', DAY)).resolves.toBe('ok')
    expect(txSet.mock.calls[0][1]).toEqual({ upload: 20 })

    vi.clearAllMocks()
    uidGet.mockResolvedValue({ data: () => ({ upload: 20 }) })
    dayGet.mockResolvedValue({ data: () => ({ total: 0 }) })
    await expect(takePermit('user-1', 'upload', DAY)).resolves.toBe('uid-limit')
    expect(txSet).not.toHaveBeenCalled()
  })

  it('refuses at the per-deployment ceiling even when the account has room', async () => {
    process.env.RESUME_DEPLOYMENT_CEILING = '5'
    dayGet.mockResolvedValue({ data: () => ({ total: 5 }) })
    await expect(takePermit('user-1', 'gaps', DAY)).resolves.toBe('deployment-limit')
    expect(txSet).not.toHaveBeenCalled()
  })

  it('treats a missing meter as zero spent', async () => {
    dayGet.mockResolvedValue({ data: () => undefined })
    uidGet.mockResolvedValue({ data: () => undefined })
    await expect(takePermit('user-1', 'gaps', DAY)).resolves.toBe('ok')
    expect(txSet.mock.calls[0][1]).toEqual({ gaps: 1 })
  })

  it('reports the day’s spend back through reviewsToday, summed over all four tools', async () => {
    uidGet.mockResolvedValue({ data: () => ({ upload: 3, diagnose: 2, gaps: 1, rewrite: 7 }) })
    await expect(reviewsToday('user-1', DAY)).resolves.toBe(13)
  })
})
