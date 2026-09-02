import { describe, it, expect, vi } from 'vitest'
import { authMessage } from '@/lib/authMessage'

// Firebase throws developer-facing codes; people get a sentence. Only the branches that
// depend on WHERE the error happened are pinned — the sign-in wall and the account page
// read the same wrong-password code differently, because on the account page the email is
// not in question.

const err = (code: string) => ({ code, message: `Firebase: Error (${code}).` })

describe('authMessage', () => {
  it('names the wrong-password case by where it happened', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(authMessage(err('auth/invalid-credential'), 'email')).toBe('Wrong email or password.')
    expect(authMessage(err('auth/invalid-credential'), 'account')).toBe('Wrong password.')
    expect(authMessage(err('auth/wrong-password'), 'account')).toBe('Wrong password.')
  })

  it('translates the codes the account page can raise', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(authMessage(err('auth/requires-recent-login'), 'account')).toBe('Sign in again, then retry.')
    expect(authMessage(err('auth/user-disabled'), 'email')).toBe('This account has been disabled.')
    expect(authMessage(err('auth/email-already-in-use'), 'account')).toBe(
      'That email already has an account. Sign in instead.',
    )
  })

  it('reads a switched-off provider against the button that was pressed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(authMessage(err('auth/operation-not-allowed'), 'google')).toContain('Google')
    expect(authMessage(err('auth/operation-not-allowed'), 'email')).toContain('Email and password')
  })

  it('never sends the account page to a password a Google account does not have', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(authMessage(err('auth/operation-not-allowed'), 'account')).toBe(
      'That sign-in method isn’t enabled for this app.',
    )
    expect(authMessage(err('auth/unauthorized-domain'), 'account')).toBe(
      'Google sign-in isn’t available on this address.',
    )
    expect(authMessage(err('auth/popup-blocked'), 'account')).toBe(
      'Your browser blocked the Google window. Allow pop-ups and try again.',
    )
  })

  it('falls back to one sentence for anything it does not know', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(authMessage(new Error('boom'), 'email')).toBe('Sign-in failed. Try again.')
    expect(authMessage(new Error('boom'), 'account')).toBe('That didn’t work. Try again.')
  })
})
