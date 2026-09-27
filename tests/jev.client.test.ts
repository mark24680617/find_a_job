import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `CUTS_MEASURED` read through a getter, so each test decides it whatever A8 wrote into cuts.ts
// (amended 2026-09-24, R6).
const cuts = vi.hoisted(() => ({ measured: true }))
vi.mock('@/lib/resume/cuts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resume/cuts')>()),
  get CUTS_MEASURED() {
    return cuts.measured
  },
}))

import { JEV_BASE_URL, JEV_MODEL, JEV_MAX_QUESTIONS, JevError, askNouls } from '@/ai/jev'
import { bulletNouls } from '@/ai/nouls'

// The client with `fetch` injected: no key, no network, no vendor. What is under test is the one
// thing a six-day-old vendor's client owes the rest of the app — an answer it has checked, or an
// error the caller can decide on. Never a number nobody validated.

const questions = bulletNouls()
const state = 'Line from the resume: Cut reconciliation from 4 hours to 18 minutes.'

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as unknown as Response)

const failing = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue({ ok: false, status, json: async () => body } as unknown as Response)

// The Noul answer shape as docs.typesafe.ai/api.md documents it (read 2026-09-25, recorded in
// docs/notes/deps.md) — unverified against a live response — re-check when A4's `body` arm has run.
const goodBody = {
  model: 'jev-1.13.0',
  answers: {
    result: { type: 'noul', noul: 0.91 },
    action: { type: 'noul', noul: 0.88 },
    scale: { type: 'noul', noul: 0.74 },
    'self-description': { type: 'noul', noul: 0.96 },
  },
}

beforeEach(() => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
  cuts.measured = true
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('askNouls', () => {
  it('asks JEV nothing while the cut points are unmeasured, so every caller falls back', async () => {
    // amended 2026-09-24, R6: A4's no-JEV branch leaves CUTS_MEASURED false, and a placeholder
    // band must never gate a count on the page.
    cuts.measured = false
    const fetchImpl = ok(goodBody)
    const error = await askNouls(state, questions, fetchImpl).catch((e) => e)
    expect(error).toBeInstanceOf(JevError)
    expect((error as JevError).status).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends one state, every question, and the pinned version — never jev-latest', async () => {
    const fetchImpl = ok(goodBody)
    await askNouls(state, questions, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${JEV_BASE_URL}/v1/systemone`)
    expect(JEV_MODEL).toBe('jev-1.13.0')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.model).toBe('jev-1.13.0')
    expect(body.model).not.toBe('jev-latest')
    expect(body.state).toBe(state)
    expect(Object.keys(body.questions)).toEqual(['result', 'action', 'scale', 'self-description'])
    expect(body.questions.result.type).toBe('noul')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer test-key' })
  })

  it('returns the probability and the responding model id beside it', async () => {
    const res = await askNouls(state, questions, ok(goodBody))
    expect(res.result).toEqual({ noul: 0.91, model: 'jev-1.13.0' })
    expect(Object.keys(res)).toEqual(['result', 'action', 'scale', 'self-description'])
  })

  it('refuses an answer from any model but the pinned one, or from no named model', async () => {
    const unnamed: Partial<typeof goodBody> = structuredClone(goodBody)
    delete unnamed.model
    for (const body of [unnamed, { ...goodBody, model: 'jev-1.14.0' }]) {
      const error = await askNouls(state, questions, ok(body)).catch((e) => e)
      expect(error).toBeInstanceOf(JevError)
      expect((error as JevError).status).toBe(0)
    }
  })

  it('refuses an answer set that is not the question set', async () => {
    const short = { ...goodBody, answers: { result: { type: 'noul', noul: 0.9 } } }
    await expect(askNouls(state, questions, ok(short))).rejects.toBeInstanceOf(JevError)
    const extra = { ...goodBody, answers: { ...goodBody.answers, invented: { type: 'noul', noul: 0.5 } } }
    await expect(askNouls(state, questions, ok(extra))).rejects.toBeInstanceOf(JevError)
  })

  it('refuses a probability that is not a finite number in [0,1]', async () => {
    for (const bad of [1.4, -0.1, Number.NaN, 'high', null]) {
      const body = { ...goodBody, answers: { ...goodBody.answers, scale: { type: 'noul', noul: bad } } }
      await expect(askNouls(state, questions, ok(body))).rejects.toBeInstanceOf(JevError)
    }
  })

  it('refuses an answer typed as anything but noul — no Score and no Choice reach this product', async () => {
    const body = { ...goodBody, answers: { ...goodBody.answers, scale: { type: 'score', score: 3 } } }
    await expect(askNouls(state, questions, ok(body))).rejects.toBeInstanceOf(JevError)
  })

  it('throws with the status on 401, 429 and 529, so the caller can fall back', async () => {
    for (const status of [401, 429, 529]) {
      const error = await askNouls(state, questions, failing(status)).catch((e) => e)
      expect(error).toBeInstanceOf(JevError)
      expect((error as JevError).status).toBe(status)
      expect((error as JevError).field).toBeNull()
    }
  })

  it('carries the named field on a 422, which is the one status nobody falls back on', async () => {
    const error = await askNouls(state, questions, failing(422, { error: { field: 'questions.scale.criteria' } })).catch((e) => e)
    expect(error).toBeInstanceOf(JevError)
    expect((error as JevError).status).toBe(422)
    expect((error as JevError).field).toBe('questions.scale.criteria')
  })

  it('throws status 0 when the key is absent, when the transport fails, and when the body is unreadable', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    let error = await askNouls(state, questions, ok(goodBody)).catch((e) => e)
    expect((error as JevError).status).toBe(0)

    vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
    error = await askNouls(state, questions, vi.fn().mockRejectedValue(new Error('ECONNRESET'))).catch((e) => e)
    expect((error as JevError).status).toBe(0)

    const unreadable = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new Error('not json') },
    } as unknown as Response)
    error = await askNouls(state, questions, unreadable).catch((e) => e)
    expect((error as JevError).status).toBe(0)
  })

  it('names no resume text in anything it throws', async () => {
    const error = await askNouls(state, questions, failing(429)).catch((e) => e)
    expect((error as Error).message).not.toMatch(/reconciliation/)
  })

  it('carries the per-request question cap Task A4 measured', async () => {
    expect(Number.isInteger(JEV_MAX_QUESTIONS)).toBe(true)
    expect(JEV_MAX_QUESTIONS).toBeGreaterThan(0)
  })
})
