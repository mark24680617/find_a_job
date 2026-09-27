import { describe, it, expect } from 'vitest'
import { CUTS_MEASURED, FAIL_AT, PASS_AT, REPEAT_SPREAD } from '@/lib/resume/cuts'

describe('the cut points', () => {
  // Amended 2026-09-24, R7: REPEAT_SPREAD is a width, not a probability, and 0 is a real answer —
  // five identical requests that came back identical. FAIL_AT may be exactly 0 as well.
  it('are finite, and the spread is a width in [0, 1)', () => {
    for (const cut of [PASS_AT, FAIL_AT, REPEAT_SPREAD]) {
      expect(Number.isFinite(cut)).toBe(true)
    }
    expect(REPEAT_SPREAD).toBeGreaterThanOrEqual(0)
    expect(REPEAT_SPREAD).toBeLessThan(1)
  })

  it('leave a band between them, which is where `unjudged` lives', () => {
    // Without this there is no third verdict, and a judge that was not confident would be
    // silently read as a fail — the one thing spec §6.1 refuses.
    expect(FAIL_AT).toBeGreaterThanOrEqual(0)
    expect(FAIL_AT).toBeLessThan(PASS_AT)
    expect(PASS_AT).toBeLessThan(1)
  })

  it('leave a band at least as wide as the judge\'s own spread over identical requests', () => {
    // Measured by `scripts/jev-probe.ts repeat`. A narrower band would call the same line pass
    // on one run and fail on the next, and the count on screen would move without the resume
    // moving.
    expect(PASS_AT - FAIL_AT).toBeGreaterThanOrEqual(REPEAT_SPREAD)
  })

  it('say whether they were measured, which is what gates JEV in Tasks C5 and C8', () => {
    // R6: a boolean flag, not a numeral — `CUTS_MEASURED && TYPESAFE_API_KEY present` asks JEV.
    expect(typeof CUTS_MEASURED).toBe('boolean')
  })
})
