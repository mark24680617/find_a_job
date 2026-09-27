import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BulletJudgement, Profile, StoredResume } from '@/lib/types'

// The handler with the database, the auth guard, the kill switch and the judge faked: no Admin
// SDK, no JEV, no model call. `@/ai/jev` is mocked WHOLE rather than partially, so that `JevError`
// under test is the class this file declares and `instanceof` in the route is matching against the
// same constructor the test threw. (`server-only` needs no mock: `vitest.config.mts` aliases it to
// an empty module — Task C5.)
//
// What is under test is the two steps this route has that no other route on the feature has: a
// factId is re-checked against the LIVE bank, because the bank may have moved during the seconds
// the model took, and the accepted sentence is judged again by the same four questions before it
// is stored.

// Inside `vi.hoisted`, because the `vi.mock` factory below is hoisted above every top-level
// declaration and would otherwise read the class before it is initialised.
const { JevError } = vi.hoisted(() => ({
  JevError: class JevError extends Error {
    constructor(readonly status: number, readonly field: string | null, message: string) {
      super(message)
      this.name = 'JevError'
    }
  },
}))

const { requireUser, getResume, getProfile, appendResumeRewrite } = vi.hoisted(() => ({
  requireUser: vi.fn(), getResume: vi.fn(), getProfile: vi.fn(), appendResumeRewrite: vi.fn(),
}))
const { resumeToolsEnabled, takePermit } = vi.hoisted(() => ({
  resumeToolsEnabled: vi.fn(),
  takePermit: vi.fn(),
}))
const { judgeBullets } = vi.hoisted(() => ({ judgeBullets: vi.fn() }))
const { askNouls } = vi.hoisted(() => ({ askNouls: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getResume, getProfile, appendResumeRewrite }))
// (amended 2026-09-24, R49) Partial, as in the rewrite route's test: the two functions faked, the
// message constants and `permitRefusal` real, the Admin SDK stubbed under them.
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {} }))
vi.mock('@/lib/resume/meter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resume/meter')>()),
  resumeToolsEnabled,
  takePermit,
}))
vi.mock('@/lib/resume/judge', () => ({ judgeBullets }))
vi.mock('@/ai/jev', () => ({ askNouls, JevError }))
vi.mock('@/ai/flows/judgeFallback', () => ({ judgeWithGemini: vi.fn() }))

import { POST } from '@/app/api/profile/resumes/[id]/rewrite/accept/route'
import { permitRefusal, TOOLS_OFF_MESSAGE } from '@/lib/resume/meter'

const ADDED_AT = '2026-09-21T10:00:00.000Z'

const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: ADDED_AT,
  filename: 'resume.pdf',
  bytes: 41_000,
  text: 'Responsible for the payments service.\nWorked on checkout latency.\nOwned the ledger.',
  // The last line is hidden at size 0 and kept in `text` by hand, which the extractor never does:
  // excluded by visibleText (R43), so a resumeSpan quoting it is refused.
  lines: [
    { page: 1, x: 72, y: 700, size: 11, font: 'Helvetica', text: 'Responsible for the payments service.' },
    { page: 1, x: 72, y: 680, size: 0, hiddenBy: 'size', font: 'Helvetica', text: 'Owned the ledger.' },
  ],
  sections: [],
  entries: [{ org: 'Fenwick Labs', role: 'Senior Backend Engineer', fromRaw: 'March 2024', toRaw: 'Present', from: '2024-03-01', to: null, bulletIds: ['b1'], bulletLines: [2] }],
  bullets: [{ id: 'b1', entryIndex: 0, lines: [2], text: 'Responsible for the payments service.' }],
  language: 'en',
  ...over,
})

const profile: Profile = {
  facts: [{ id: 'f1', claim: 'Owns the payments service', sourceSnippet: 'Responsible for the payments service.', tags: [] }],
  standardAnswers: {}, voiceRules: [], gaps: [],
}

const recheck: BulletJudgement[] = ['result', 'action', 'scale', 'self-description'].map((questionId, i) => ({
  bulletId: 'b1', questionId, noul: i === 3 ? 0.08 : 0.91,
  verdict: i === 3 ? 'fail' : 'pass', model: 'jev-1.13.0', judge: 'jev',
}))

const accepted = {
  reviewedFrom: ADDED_AT,
  bulletId: 'b1',
  text: 'Ran the payments service.',
  citations: [{ claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }],
}

const post = (body: unknown, id = 'current') =>
  POST(
    new Request(`https://example.test/api/profile/resumes/${id}/rewrite/accept`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  resumeToolsEnabled.mockReturnValue(true)
  takePermit.mockResolvedValue('ok')
  getResume.mockResolvedValue(resume())
  getProfile.mockResolvedValue(profile)
  appendResumeRewrite.mockResolvedValue('appended')
  judgeBullets.mockResolvedValue(recheck)
})

describe('POST …/rewrite/accept — what it refuses', () => {
  it('returns the guard’s 401 as-is, and is 503 with the kill switch off', async () => {
    requireUser.mockResolvedValue(new Response('no', { status: 401 }))
    expect((await post(accepted)).status).toBe(401)
    vi.resetAllMocks()
    requireUser.mockResolvedValue({ uid: 'user-1' })
    resumeToolsEnabled.mockReturnValue(false)
    const off = await post(accepted)
    expect(off.status).toBe(503)
    expect(await off.json()).toEqual({ error: TOOLS_OFF_MESSAGE, disabled: true })   // R49
  })

  it('is 404 for a malformed id and for a resume that is not there', async () => {
    expect((await post(accepted, 'a/../b')).status).toBe(404)
    getResume.mockResolvedValue(null)
    expect((await post(accepted)).status).toBe(404)
  })

  it('is 400 for a body that is not an accepted rewrite', async () => {
    for (const body of [
      {}, { ...accepted, reviewedFrom: '' }, { ...accepted, bulletId: 'bullet-1' },
      { ...accepted, text: '   ' }, { ...accepted, citations: 'f1' },
      { ...accepted, citations: [{ claimSpan: 'x', factId: 7, resumeSpan: null }] },
      { ...accepted, citations: [{ claimSpan: '   ', factId: 'f1', resumeSpan: null }] },
    ]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(appendResumeRewrite).not.toHaveBeenCalled()
  })

  it('is 400 for an oversized line, span, factId or citation list, before any read, scan, permit or judge', async () => {
    // (final review, routes-1) Each size is refused in readBody: a 1 MiB text against 15,800
    // citations was a minutes-long synchronous scan before the permit, and the text alone was an
    // unbounded model input after it.
    const cite = { claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }
    const cases: [unknown, string][] = [
      [{ ...accepted, text: `Ran ${'a'.repeat(600)}`, citations: [] }, 'a rewritten line is at most 600 characters'],
      [{ ...accepted, citations: Array.from({ length: 9 }, () => cite) }, 'a rewrite carries at most 8 citations'],
      [{ ...accepted, citations: [{ ...cite, resumeSpan: 'r'.repeat(601) }] }, 'a citation span is at most 600 characters'],
      [{ ...accepted, citations: [{ ...cite, claimSpan: 'c'.repeat(601) }] }, 'a citation span is at most 600 characters'],
      [{ ...accepted, citations: [{ ...cite, factId: 'f'.repeat(65) }] }, 'a factId is at most 64 characters'],
    ]
    for (const [body, error] of cases) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error })
    }
    expect(getResume).not.toHaveBeenCalled()
    expect(getProfile).not.toHaveBeenCalled()
    expect(takePermit).not.toHaveBeenCalled()
    expect(judgeBullets).not.toHaveBeenCalled()
  })

  it('accepts a line of exactly 600 characters with eight citations', async () => {
    const text = `Ran the payments service ${'a'.repeat(600 - 'Ran the payments service '.length)}`
    const cite = { claimSpan: 'the payments service', factId: 'f1', resumeSpan: null }
    const res = await post({ ...accepted, text, citations: Array.from({ length: 8 }, () => cite) })
    expect(res.status).toBe(200)
    expect(takePermit).toHaveBeenCalledTimes(1)
  })

  it('is 409 when the resume it was written against is not the stored one', async () => {
    const res = await post({ ...accepted, reviewedFrom: '2026-09-01T00:00:00.000Z' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'this resume was replaced while you were reading — re-run the rewrite',
      basisMoved: true,
    })
    expect(judgeBullets).not.toHaveBeenCalled()
    expect(appendResumeRewrite).not.toHaveBeenCalled()
  })

  it('is 400 when the bulletId names no bullet on this resume', async () => {
    expect((await post({ ...accepted, bulletId: 'b9' })).status).toBe(400)
  })

  it('is 422 when a cited fact has left the live bank, and stores nothing', async () => {
    getProfile.mockResolvedValue({ ...profile, facts: [] })
    const res = await post(accepted)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'citation 1 names f1, which is no longer in your fact bank — re-run the rewrite',
      rewriteFailed: true,
    })
    expect(judgeBullets).not.toHaveBeenCalled()
    expect(appendResumeRewrite).not.toHaveBeenCalled()
    // The permit sits behind this check, so a proposal made stale by the bank costs nothing.
    expect(takePermit).not.toHaveBeenCalled()
  })

  // (amended 2026-09-24, R45) The body is stored as the sentence the candidate chose, so what its
  // citations claim is re-checked here rather than taken from the client, by the flow's own
  // checks: a source present, each claimSpan verbatim in the accepted text, each resumeSpan
  // verbatim in the visible resume text (R43).
  it('is 422 when a span is not verbatim where it claims to be, and spends nothing', async () => {
    const drifted = await post({ ...accepted, citations: [{ claimSpan: 'the ledger', factId: 'f1', resumeSpan: null }] })
    expect(drifted.status).toBe(422)
    expect(await drifted.json()).toEqual({
      error: 'citation 1 does not appear verbatim in the accepted line — re-run the rewrite',
      rewriteFailed: true,
    })

    const invented = await post({ ...accepted, citations: [{ claimSpan: 'the payments service', factId: null, resumeSpan: 'Ran the ledger.' }] })
    expect(invented.status).toBe(422)
    expect(await invented.json()).toEqual({
      error: 'citation 1 cites a resume span that is not in the stored resume — re-run the rewrite',
      rewriteFailed: true,
    })

    // In `text`, but on a line the page does not render: the flow was never shown it.
    const hidden = await post({ ...accepted, citations: [{ claimSpan: 'the payments service', factId: null, resumeSpan: 'Owned the ledger.' }] })
    expect(hidden.status).toBe(422)
    expect(await hidden.json()).toEqual({
      error: 'citation 1 cites a resume span that is not in the stored resume — re-run the rewrite',
      rewriteFailed: true,
    })

    const sourceless = await post({ ...accepted, citations: [{ claimSpan: 'the payments service', factId: null, resumeSpan: null }] })
    expect(sourceless.status).toBe(422)
    expect(await sourceless.json()).toEqual({
      error: 'citation 1 carries neither a fact nor a resume span — re-run the rewrite',
      rewriteFailed: true,
    })

    expect(takePermit).not.toHaveBeenCalled()
    expect(judgeBullets).not.toHaveBeenCalled()
    expect(appendResumeRewrite).not.toHaveBeenCalled()
  })

  it('is 429 at either ceiling, naming which, and never judges or stores', async () => {
    takePermit.mockResolvedValue('uid-limit')
    const uid = await post(accepted)
    expect(uid.status).toBe(429)
    expect(await uid.json()).toEqual(permitRefusal('uid-limit').body)   // R49

    takePermit.mockResolvedValue('deployment-limit')
    const deployment = await post(accepted)
    expect(deployment.status).toBe(429)
    expect((await deployment.json()).ceiling).toBe('deployment')

    expect(judgeBullets).not.toHaveBeenCalled()
    expect(appendResumeRewrite).not.toHaveBeenCalled()
  })

  it('is 422 when the judge refuses the question shape, and stores nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    judgeBullets.mockRejectedValue(new JevError(422, 'questions.result.criteria', 'unprocessable'))
    const res = await post(accepted)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toContain('questions.result.criteria')
    expect(appendResumeRewrite).not.toHaveBeenCalled()
    // The log names our field and nothing of the candidate's.
    expect(warn).toHaveBeenCalledWith('jev refused a question shape, field:', 'questions.result.criteria')
    warn.mockRestore()
  })

  it('is 409 when the resume is replaced while the judge is thinking, and 404 when it is deleted', async () => {
    appendResumeRewrite.mockResolvedValue('moved')
    const res = await post(accepted)
    expect(res.status).toBe(409)
    expect((await res.json()).basisMoved).toBe(true)

    appendResumeRewrite.mockResolvedValue('missing')
    expect((await post(accepted)).status).toBe(404)
  })
})

describe('POST …/rewrite/accept — what it does', () => {
  it('takes one rewrite unit for today, after the live-bank check and before the judge', async () => {
    await post(accepted)
    expect(takePermit).toHaveBeenCalledWith('user-1', 'rewrite', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 1)
    expect(takePermit.mock.invocationCallOrder[0]).toBeLessThan(
      judgeBullets.mock.invocationCallOrder[0],
    )
  })

  it('judges the accepted sentence, not the stored bullet, against the stored entries', async () => {
    await post(accepted)
    expect(judgeBullets).toHaveBeenCalledWith(
      [{ id: 'b1', entryIndex: 0, lines: [2], text: 'Ran the payments service.' }],
      resume().entries,
      expect.objectContaining({ askNouls: expect.any(Function), fallback: expect.any(Function) }),
    )
  })

  it('appends one AcceptedRewrite with its basis, its judge and its re-check, in one transactional append', async () => {
    await post(accepted)
    expect(appendResumeRewrite).toHaveBeenCalledTimes(1)
    expect(appendResumeRewrite).toHaveBeenCalledWith('user-1', 'current', {
      reviewedFrom: ADDED_AT,
      judge: 'jev',
      acceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      bulletId: 'b1',
      text: 'Ran the payments service.',
      citations: accepted.citations,
      recheck,
    })
  })

  it('accepts a citation sourced from a visible resume line alone', async () => {
    const res = await post({ ...accepted, citations: [{ claimSpan: 'the payments service', factId: null, resumeSpan: 'Responsible for the payments service.' }] })
    expect(res.status).toBe(200)
    expect(appendResumeRewrite).toHaveBeenCalledTimes(1)
  })

  it('answers the document as it now stands, read back after the write', async () => {
    const stored = resume({ rewrites: [{ reviewedFrom: ADDED_AT, judge: 'jev', acceptedAt: ADDED_AT, bulletId: 'b1', text: 'Ran the payments service.', citations: accepted.citations, recheck }] })
    getResume.mockResolvedValueOnce(resume()).mockResolvedValueOnce(stored)
    const res = await post(accepted)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(stored)
    expect(getResume).toHaveBeenCalledTimes(2)
  })
})
