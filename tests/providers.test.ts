import { describe, it, expect } from 'vitest'
import { hasPasswordProvider, providerLabel } from '@/lib/providers'

// Firebase names providers by id; people are told what they sign in with. The password
// provider is the one that decides whether the account page offers password and email
// changes at all, so that check is a named function rather than a string compare in JSX.

describe('providerLabel', () => {
  it('names the two providers this app enables', () => {
    expect(providerLabel('google.com')).toBe('Google')
    expect(providerLabel('password')).toBe('Email and password')
  })
  it('passes anything else through verbatim rather than inventing a name', () => {
    expect(providerLabel('github.com')).toBe('github.com')
  })
  it('shows a dash for no provider at all', () => {
    expect(providerLabel('')).toBe('—')
  })
})

describe('hasPasswordProvider', () => {
  it('is true when the password provider is linked, whatever else is', () => {
    expect(hasPasswordProvider(['password'])).toBe(true)
    expect(hasPasswordProvider(['google.com', 'password'])).toBe(true)
  })
  it('is false for a Google-only account and for none', () => {
    expect(hasPasswordProvider(['google.com'])).toBe(false)
    expect(hasPasswordProvider([])).toBe(false)
  })
})
