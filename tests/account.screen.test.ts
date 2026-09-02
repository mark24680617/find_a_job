import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { User } from 'firebase/auth'

// The account page's sections as first seen. A static render is what can be checked without
// a DOM: what each section says for a Google account versus a password one, and that the
// counts read as a dash until they arrive. Both Firebase modules are faked — importing
// either initialises Firebase, which throws outside a browser.
vi.mock('@/lib/firebase/client', () => ({
  auth: {},
  updateAccountProfile: vi.fn(),
  changePassword: vi.fn(),
  requestEmailChange: vi.fn(),
  reauthenticate: vi.fn(),
  signOutUser: vi.fn(),
}))
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { Overview } from '@/components/account/Overview'
import { NameAndPhoto } from '@/components/account/NameAndPhoto'
import { SignInSettings } from '@/components/account/SignInSettings'
import { DeleteAccount } from '@/components/account/DeleteAccount'

export const fakeUser = (over: Partial<{ email: string; displayName: string | null; photoURL: string | null; providerIds: string[] }> = {}) =>
  ({
    uid: 'user-1',
    email: over.email ?? 'mark@example.com',
    displayName: over.displayName ?? null,
    photoURL: over.photoURL ?? null,
    providerData: (over.providerIds ?? ['password']).map((providerId) => ({ providerId })),
    metadata: {
      creationTime: 'Fri, 28 Aug 2026 02:51:50 GMT',
      lastSignInTime: 'Tue, 01 Sep 2026 22:25:00 GMT',
    },
  }) as unknown as User

describe('Overview', () => {
  it('names the sign-in method and dates, and dashes the counts until they arrive', () => {
    const markup = renderToStaticMarkup(createElement(Overview, { user: fakeUser({ providerIds: ['google.com'] }), usage: null }))
    expect(markup).toContain('mark@example.com')
    expect(markup).toContain('Google')
    expect(markup).toContain('2026')
    expect(markup).toContain('—')
    expect(markup).toContain('href="/profile"')
  })

  it('shows the counts once they are known', () => {
    const markup = renderToStaticMarkup(createElement(Overview, { user: fakeUser(), usage: { applications: 4, facts: 18 } }))
    expect(markup).toContain('Email and password')
    expect(markup).toMatch(/>4</)
    expect(markup).toMatch(/>18</)
  })
})

describe('NameAndPhoto', () => {
  it('seeds the fields from the account and offers Save', () => {
    const markup = renderToStaticMarkup(
      createElement(NameAndPhoto, { user: fakeUser({ displayName: 'Mark Qiu', photoURL: 'https://example.com/me.png' }), onDirty: () => {} }),
    )
    expect(markup).toContain('value="Mark Qiu"')
    expect(markup).toContain('value="https://example.com/me.png"')
    expect(markup).toContain('src="https://example.com/me.png"')
    expect(markup).toContain('>Save<')
  })

  it('shows the first letter when there is no photo', () => {
    const markup = renderToStaticMarkup(createElement(NameAndPhoto, { user: fakeUser({ displayName: 'Mark' }), onDirty: () => {} }))
    expect(markup).not.toContain('<img')
    expect(markup).toContain('>M<')
  })
})

describe('SignInSettings', () => {
  it('offers both changes to an account with a password', () => {
    const markup = renderToStaticMarkup(createElement(SignInSettings, { user: fakeUser() }))
    expect(markup).toContain('Change password')
    expect(markup).toContain('Change email')
    // Matched without regard to case: React 19 serialises this prop as it is written,
    // `autoComplete`, and HTML attribute names are case-insensitive anyway.
    expect(markup).toMatch(/autocomplete="current-password"/i)
    expect(markup).toMatch(/autocomplete="new-password"/i)
  })

  it('tells a Google account where its password lives instead', () => {
    const markup = renderToStaticMarkup(createElement(SignInSettings, { user: fakeUser({ providerIds: ['google.com'] }) }))
    expect(markup).toContain('You sign in with Google')
    expect(markup).not.toContain('Change password')
    expect(markup).not.toContain('<form')
  })
})

describe('DeleteAccount', () => {
  it('names what goes, in danger, and asks a password account for its password', () => {
    const markup = renderToStaticMarkup(createElement(DeleteAccount, { user: fakeUser(), onDeleted: () => {} }))
    expect(markup).toContain('border-danger')
    expect(markup).toContain('btn btn-danger')
    expect(markup).toContain('Delete my account')
    expect(markup).toContain('every application')
    expect(markup).toContain('type="password"')
  })

  it('asks a Google account for nothing up front — the Google window is the check', () => {
    const markup = renderToStaticMarkup(createElement(DeleteAccount, { user: fakeUser({ providerIds: ['google.com'] }), onDeleted: () => {} }))
    expect(markup).not.toContain('type="password"')
    expect(markup).toContain('Delete my account')
  })
})

// Not covered here: the re-authentication sequences, the confirm, the sign-out after a
// delete, and the unsaved-work signal from the name form. All of them are click handlers or
// effects, and this suite has no DOM to run them in.
