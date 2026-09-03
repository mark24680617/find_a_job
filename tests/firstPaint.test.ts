import { describe, it, expect } from 'vitest'
import { firstPaint, SIGNED_IN_COOKIE } from '@/lib/landing/firstPaint'

// What the shell paints before Firebase has said who is here. The one decision that matters
// is the first: a machine that has never signed in gets the landing at once, a machine that
// has gets the checking line — so a new visitor never waits and a returning one never sees
// the landing flash before their dashboard.

describe('firstPaint', () => {
  it('paints the slot at once for a new visitor while the session is still unknown', () => {
    expect(firstPaint(false, false, false, true)).toBe('gate')
  })
  it('holds the checking line for a returning visitor while the session is still unknown', () => {
    expect(firstPaint(false, false, true, true)).toBe('checking')
  })
  it('always holds the checking line when there is no slot to paint', () => {
    expect(firstPaint(false, false, false, false)).toBe('checking')
    expect(firstPaint(false, false, true, false)).toBe('checking')
  })
  it('once the session is known, the user decides', () => {
    expect(firstPaint(true, true, false, true)).toBe('app')
    expect(firstPaint(true, true, true, false)).toBe('app')
    expect(firstPaint(true, false, true, true)).toBe('gate')
    expect(firstPaint(true, false, false, false)).toBe('gate')
  })
  it('names the cookie once, for the client that sets it and the server that reads it', () => {
    expect(SIGNED_IN_COOKIE).toBe('fj-signed-in')
  })
})
