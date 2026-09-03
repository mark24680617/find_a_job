import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The wall, as first seen from /sign-in with and without ?mode=sign-up. Importing the gate
// reaches `@/lib/firebase/client`, which builds an Auth instance at module scope.
vi.mock('@/lib/firebase/client', () => ({
  auth: {},
  signInWithGoogle: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
}))

import { SignInGate } from '@/components/SignInGate'

describe('SignInGate initialMode', () => {
  it('opens on sign-in by default', () => {
    const markup = renderToStaticMarkup(createElement(SignInGate))
    expect(markup).toContain('Sign in to your vault')
    expect(markup).toContain('>Sign in<')
  })
  it('opens on sign-up when asked', () => {
    const markup = renderToStaticMarkup(createElement(SignInGate, { initialMode: 'sign-up' }))
    expect(markup).toContain('Create your vault')
    expect(markup).toContain('>Create account<')
  })
})
