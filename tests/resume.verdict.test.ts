import { afterEach, describe, it, expect, vi } from 'vitest'
import { CUTS_MEASURED, FAIL_AT, PASS_AT } from '@/lib/resume/cuts'
import { NOULS_PER_BULLET, counts, toVerdict } from '@/lib/resume/verdict'
import type { BulletJudgement, CheckResult, StoredResume } from '@/lib/resume/types'

// `judge.ts` imports `JevError` as a value, so this file's chain reaches `src/ai/jev.ts` and its
// `import 'server-only'`. No `vi.mock` for it: `vitest.config.mts` aliases the package to
// `tests/mocks/server-only.ts` (Task C5), so every test file gets the empty module for free.
//
// amended 2026-09-24, R6 and R50: every JEV-path test passes `jevEnabled: true`, because the
// default gate reads CUTS_MEASURED and the key, and neither is this file's to decide.

import { JevError } from '@/ai/jev'
import { BULLET_NOUL_IDS } from '@/ai/nouls'
import { JUDGE_CONCURRENCY, askWithFallback, jevEnabled, judgeBullets } from '@/lib/resume/judge'

// The cut points come from Task A4's probe against the owner's labels on the §10 fixtures, so the
// numbers are not written here — the relationships are. A value between the two cuts is
// `unjudged`, drawn as its own row and never counted, because under D2 a counted item owes the
// user an honest expansion and there is none for a judge that was not confident.

const judgement = (over: Partial<BulletJudgement> = {}): BulletJudgement => ({
  bulletId: 'b1', questionId: 'result', noul: 0.9, verdict: 'pass',
  model: 'jev-1.13.0', judge: 'jev', ...over,
})

const check = (
  state: CheckResult['state'],
  checkId = 'file-size',
): Pick<CheckResult, 'checkId' | 'state'> => ({ checkId, state })

describe('toVerdict', () => {
  it('reads a JEV probability against the two cut points, inclusively at both', () => {
    expect(PASS_AT).toBeGreaterThan(FAIL_AT)
    expect(toVerdict(1, 'jev', null)).toBe('pass')
    expect(toVerdict(PASS_AT, 'jev', null)).toBe('pass')
    expect(toVerdict(0, 'jev', null)).toBe('fail')
    expect(toVerdict(FAIL_AT, 'jev', null)).toBe('fail')
  })

  it('calls the band unjudged rather than quietly failing it', () => {
    expect(toVerdict((PASS_AT + FAIL_AT) / 2, 'jev', null)).toBe('unjudged')
  })

  it('has no band on the fallback: yes is pass, no is fail, nothing is unjudged', () => {
    expect(toVerdict(null, 'gemini', 'yes')).toBe('pass')
    expect(toVerdict(null, 'gemini', 'no')).toBe('fail')
  })

  it('is unjudged when the judge that was named answered nothing usable', () => {
    expect(toVerdict(null, 'jev', null)).toBe('unjudged')
    expect(toVerdict(null, 'gemini', null)).toBe('unjudged')
  })

  it('keeps the denominator at four whichever judge answered', () => {
    expect(NOULS_PER_BULLET).toBe(4)
  })
})

describe('counts', () => {
  it('is .length arithmetic over the rows on the page, and nothing a model claimed', () => {
    const judgements = [
      judgement({ verdict: 'pass' }),
      judgement({ questionId: 'action', verdict: 'fail' }),
      judgement({ questionId: 'scale', verdict: 'unjudged', noul: null }),
      judgement({ questionId: 'self-description', verdict: 'pass' }),
    ]
    const checks = [check('pass'), check('fail'), check('fail'), check('not-run')]
    expect(counts(judgements, checks)).toEqual({ checked: 6, needAttention: 3, unjudged: 1 })
  })

  it('counts a not-run check as neither checked nor needing attention', () => {
    expect(counts([], [check('not-run'), check('not-run')])).toEqual({
      checked: 0, needAttention: 0, unjudged: 0,
    })
  })

  it('counts nothing at all on an empty run', () => {
    expect(counts([], [])).toEqual({ checked: 0, needAttention: 0, unjudged: 0 })
  })

  // D4 and §7 (final review, page-3): the gap row states a period and gives no verdict, so a gap
  // that was found is a check that ran and never one that needs attention.
  it('counts a found employment gap as checked and never as needing attention', () => {
    expect(counts([], [check('fail', 'employment-gap'), check('fail')])).toEqual({
      checked: 2, needAttention: 1, unjudged: 0,
    })
    expect(counts([], [check('not-run', 'employment-gap')])).toEqual({
      checked: 0, needAttention: 0, unjudged: 0,
    })
  })
})

describe('judgeBullets', () => {
  const entries: StoredResume['entries'] = [
    {
      org: 'Marram Systems', role: 'Backend Engineer',
      fromRaw: 'Jan 2020', toRaw: 'Dec 2021', from: '2020-01', to: '2021-12',
      bulletIds: ['b1', 'b2'], bulletLines: [4, 5],
    },
  ]
  const bullets: StoredResume['bullets'] = [
    { id: 'b1', entryIndex: 0, lines: [4], text: 'Cut reconciliation from 4 hours to 18 minutes.' },
    { id: 'b2', entryIndex: 0, lines: [5], text: 'A results-driven team player.' },
  ]
  const jevAnswer = {
    result: { noul: 0.93, model: 'jev-1.13.0' },
    action: { noul: 0.9, model: 'jev-1.13.0' },
    scale: { noul: 0.88, model: 'jev-1.13.0' },
    'self-description': { noul: 0.95, model: 'jev-1.13.0' },
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks one request per bullet, with that bullet and its role line as the whole state', async () => {
    const askNouls = vi.fn().mockResolvedValue(jevAnswer)
    const fallback = vi.fn()
    const out = await judgeBullets(bullets, entries, { askNouls, fallback, jevEnabled: true })
    expect(askNouls).toHaveBeenCalledTimes(2)
    expect(askNouls.mock.calls[0][0]).toBe(
      'Role: Backend Engineer, Marram Systems\nLine from the resume: Cut reconciliation from 4 hours to 18 minutes.',
    )
    expect(Object.keys(askNouls.mock.calls[0][1])).toEqual(['result', 'action', 'scale', 'self-description'])
    expect(out).toHaveLength(8)
    expect(out[0]).toEqual({
      bulletId: 'b1', questionId: 'result', noul: 0.93, verdict: 'pass',
      model: 'jev-1.13.0', judge: 'jev',
    })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back on 401, 429, 529 and a transport failure, and stamps the judge on every row', async () => {
    for (const status of [401, 429, 529, 0]) {
      const askNouls = vi.fn().mockRejectedValue(new JevError(status, null, 'the judge answered'))
      const fallback = vi.fn().mockResolvedValue({
        result: 'yes', action: 'yes', scale: 'no', 'self-description': 'yes',
      })
      const out = await judgeBullets([bullets[0]], entries, { askNouls, fallback, jevEnabled: true })
      expect(fallback).toHaveBeenCalledTimes(1)
      expect(out.every((j) => j.judge === 'gemini')).toBe(true)
      expect(out.every((j) => j.noul === null)).toBe(true)
      expect(out.map((j) => j.verdict)).toEqual(['pass', 'pass', 'fail', 'pass'])
      expect(out[0].model).toBe('gemini-3.8-flash')
    }
  })

  it('does not fall back on a 422 — that is our bug in a question shape, not a vendor outage', async () => {
    const askNouls = vi.fn().mockRejectedValue(new JevError(422, 'questions.scale.criteria', 'the judge answered 422'))
    const fallback = vi.fn()
    const error = await judgeBullets(bullets, entries, { askNouls, fallback, jevEnabled: true }).catch((e) => e)
    expect(error).toBeInstanceOf(JevError)
    expect((error as JevError).field).toBe('questions.scale.criteria')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back per bullet, so one bad minute does not relabel the whole resume', async () => {
    const askNouls = vi
      .fn()
      .mockResolvedValueOnce(jevAnswer)
      .mockRejectedValueOnce(new JevError(529, null, 'the judge answered 529'))
    const fallback = vi.fn().mockResolvedValue({
      result: 'no', action: 'no', scale: 'no', 'self-description': 'no',
    })
    const out = await judgeBullets(bullets, entries, { askNouls, fallback, jevEnabled: true })
    expect(out.filter((j) => j.bulletId === 'b1').every((j) => j.judge === 'jev')).toBe(true)
    expect(out.filter((j) => j.bulletId === 'b2').every((j) => j.judge === 'gemini')).toBe(true)
  })

  it('stops asking JEV for the rest of the run after a timeout, but keeps asking after a 529', async () => {
    const three = [...bullets, { id: 'b3', entryIndex: 0, lines: [6], text: 'Led the migration.' }]
    const answers = { result: 'yes', action: 'yes', scale: 'no', 'self-description': 'yes' }

    // C8b: the first JUDGE_CONCURRENCY bullets all begin before the first timeout lands, so the
    // bullet after them is the one the breaker spares JEV.
    const five = [...three, { id: 'b4', entryIndex: 0, lines: [7], text: 'Ran the rota.' }, { id: 'b5', entryIndex: 0, lines: [8], text: 'Wrote the runbook.' }]
    const timedOut = vi.fn().mockRejectedValue(new JevError(0, null, 'the judge could not be reached (TimeoutError)'))
    const fallbackA = vi.fn().mockResolvedValue(answers)
    const outA = await judgeBullets(five, entries, { askNouls: timedOut, fallback: fallbackA, jevEnabled: true })
    expect(timedOut).toHaveBeenCalledTimes(JUDGE_CONCURRENCY)
    expect(fallbackA).toHaveBeenCalledTimes(5)
    expect(outA.every((j) => j.judge === 'gemini')).toBe(true)

    const overloaded = vi.fn().mockRejectedValue(new JevError(529, null, 'the judge answered 529'))
    const fallbackB = vi.fn().mockResolvedValue(answers)
    await judgeBullets(three, entries, { askNouls: overloaded, fallback: fallbackB, jevEnabled: true })
    expect(overloaded).toHaveBeenCalledTimes(3)
    expect(fallbackB).toHaveBeenCalledTimes(3)
  })

  it('asks JEV nothing when the gate is shut, and every row is the fallback’s', async () => {
    // R6: unmeasured cut points or no key — the permanent Gemini fallback, named on the page.
    const askNouls = vi.fn()
    const fallback = vi.fn().mockResolvedValue({
      result: 'yes', action: 'yes', scale: 'yes', 'self-description': 'yes',
    })
    const out = await judgeBullets(bullets, entries, { askNouls, fallback, jevEnabled: false })
    expect(askNouls).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(out.every((j) => j.judge === 'gemini')).toBe(true)
  })

  it('opens the gate only when the cut points were measured and a key is set', () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(jevEnabled()).toBe(false)
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key')
    expect(jevEnabled()).toBe(CUTS_MEASURED)
  })

  it('judges a bullet whose entry it cannot find, on the line alone', async () => {
    const askNouls = vi.fn().mockResolvedValue(jevAnswer)
    const orphan = [{ id: 'b9', entryIndex: 7, lines: [9], text: 'Shipped the ledger.' }]
    await judgeBullets(orphan, entries, { askNouls, fallback: vi.fn(), jevEnabled: true })
    expect(askNouls.mock.calls[0][0]).toBe('Line from the resume: Shipped the ledger.')
  })

  it('returns nothing, and calls nobody, when there is nothing to judge', async () => {
    const askNouls = vi.fn()
    await expect(judgeBullets([], entries, { askNouls, fallback: vi.fn(), jevEnabled: true })).resolves.toEqual([])
    expect(askNouls).not.toHaveBeenCalled()
  })

  describe('four bullets at a time', () => {
    // Deferred `askNouls` answers, driven by the test: every call waits until the test settles it,
    // so the test decides which bullet answers first. The bullet is read back from its own state.
    const numbered = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `b${i + 1}`, entryIndex: 0, lines: [i + 4], text: `Shipped item b${i + 1}.` }))
    const pendingCalls = () => {
      const pending: { id: string; settle: (fail?: Error) => void }[] = []
      const askNouls = vi.fn((state: string) => new Promise<typeof jevAnswer>((resolve, reject) => {
        const id = /(b\d+)\.$/.exec(state)![1]
        pending.push({ id, settle: (fail) => (fail ? reject(fail) : resolve(jevAnswer)) })
      }))
      return { pending, askNouls }
    }
    const settleAll = () => new Promise((r) => setTimeout(r, 0))
    const fallbackAnswers = { result: 'yes', action: 'yes', scale: 'no', 'self-description': 'yes' }

    it('returns rows in bullet order even when later bullets answer first', async () => {
      const { pending, askNouls } = pendingCalls()
      let done = false
      const run = judgeBullets(numbered(10), entries, { askNouls, fallback: vi.fn(), jevEnabled: true })
        .finally(() => { done = true })
      const answered: string[] = []
      while (!done) {
        await settleAll()
        // Newest first: of the bullets in flight, the last one asked answers first.
        for (const call of pending.splice(0).reverse()) {
          answered.push(call.id)
          call.settle()
        }
      }
      const out = await run
      expect(answered[0]).not.toBe('b1')
      expect(out).toHaveLength(40)
      expect(out.map((j) => j.bulletId)).toEqual(
        Array.from({ length: 10 }, (_, i) => Array(4).fill(`b${i + 1}`)).flat(),
      )
      expect(out.map((j) => j.questionId)).toEqual(Array(10).fill([...BULLET_NOUL_IDS]).flat())
    })

    it('never has more than JUDGE_CONCURRENCY bullets in flight, and asks every bullet', async () => {
      let inFlight = 0
      let most = 0
      const askNouls = vi.fn<(state: string) => Promise<typeof jevAnswer>>(() => {
        inFlight += 1
        most = Math.max(most, inFlight)
        return Promise.resolve().then(() => {
          inFlight -= 1
          return jevAnswer
        })
      })
      await judgeBullets(numbered(10), entries, { askNouls, fallback: vi.fn(), jevEnabled: true })
      expect(JUDGE_CONCURRENCY).toBe(4)
      expect(most).toBe(JUDGE_CONCURRENCY)
      expect(askNouls.mock.calls.map(([state]) => /(b\d+)\.$/.exec(state)![1]).sort()).toEqual(
        ['b1', 'b10', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'],
      )
    })

    it('lets bullets in flight finish on JEV after a timeout, and sends every later bullet to Gemini', async () => {
      const { pending, askNouls } = pendingCalls()
      const fallback = vi.fn().mockResolvedValue(fallbackAnswers)
      let done = false
      const run = judgeBullets(numbered(8), entries, { askNouls, fallback, jevEnabled: true })
        .finally(() => { done = true })
      while (!done) {
        await settleAll()
        // b2 times out on its own round, before any other bullet answers.
        const b2 = pending.findIndex((call) => call.id === 'b2')
        if (b2 >= 0) pending.splice(b2, 1)[0].settle(new JevError(0, null, 'the judge could not be reached (TimeoutError)'))
        else for (const call of pending.splice(0)) call.settle()
      }
      const out = await run
      expect(askNouls.mock.calls.map(([state]) => /(b\d+)\.$/.exec(state)![1])).toEqual(['b1', 'b2', 'b3', 'b4'])
      const judgeOf = (id: string) => [...new Set(out.filter((j) => j.bulletId === id).map((j) => j.judge))]
      for (const id of ['b1', 'b3', 'b4']) expect(judgeOf(id)).toEqual(['jev'])
      for (const id of ['b2', 'b5', 'b6', 'b7', 'b8']) expect(judgeOf(id)).toEqual(['gemini'])
      expect(fallback).toHaveBeenCalledTimes(5)
      expect([...new Set(out.map((j) => j.bulletId))]).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'])
    })
  })
})

describe('askWithFallback', () => {
  it('stamps the judge, and hands the fallback the system prompt it was given', async () => {
    // R50 and R34: D6 and D7b call this with the Gaps prompt and a skill question set.
    const askNouls = vi.fn().mockRejectedValue(new JevError(529, null, 'the judge answered 529'))
    const fallback = vi.fn().mockResolvedValue({ s1: 'no' })
    const questions = { s1: { instructions: 'q', criteria: { true: 'q', false: 'not q' } } }
    const out = await askWithFallback('the whole visible resume', questions, {
      askNouls, fallback, jevEnabled: true, fallbackSystem: 'GAPS SYSTEM',
    })
    expect(out.judge).toBe('gemini')
    expect(out.answers.s1).toEqual({ noul: null, verdict: 'fail', model: 'gemini-3.8-flash', judge: 'gemini' })
    expect(fallback.mock.calls[0][3]).toBe('GAPS SYSTEM')
  })
})
