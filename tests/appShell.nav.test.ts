import { describe, it, expect, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Importing the shell reaches `@/lib/firebase/client`, which builds an Auth instance at
// module scope. `watchUser` never calls back, so every render below is the shell as it is
// before the session is known.
vi.mock('@/lib/firebase/client', () => ({
  auth: {},
  watchUser: vi.fn(),
  signOutUser: vi.fn(),
  readAdminClaim: vi.fn(),
}))

import { AppShell, navItems } from '@/components/AppShell'

describe('navItems', () => {
  it('shows Account to everyone, after New Application', () => {
    expect(navItems(false).map((n) => n.label)).toEqual(['Dashboard', 'Profile', 'New Application', 'Account'])
    expect(navItems(false).at(-1)).toEqual({ href: '/account', label: 'Account' })
  })
  it('adds Admin last, only for the administrator', () => {
    expect(navItems(true).map((n) => n.href)).toEqual(['/', '/profile', '/applications/new', '/account', '/admin'])
  })
})

describe('AppShell before the session is known', () => {
  const html = (props: { signedOut?: ReactNode; returning?: boolean }) =>
    renderToStaticMarkup(
      // `children` is required on the shell's props, and createElement's types never count a
      // trailing argument towards them. Both forms build the same element.
      // eslint-disable-next-line react/no-children-prop -- see above
      createElement(AppShell, { ...props, children: createElement('p', null, 'THE APP') }),
    )

  it('paints the signed-out slot at once for a visitor who has never signed in here', () => {
    const markup = html({ signedOut: createElement('p', null, 'THE LANDING'), returning: false })
    expect(markup).toContain('THE LANDING')
    expect(markup).not.toContain('Checking your session')
    expect(markup).not.toContain('THE APP')
  })

  it('holds the checking line for a visitor who has signed in here before', () => {
    const markup = html({ signedOut: createElement('p', null, 'THE LANDING'), returning: true })
    expect(markup).toContain('Checking your session')
    expect(markup).not.toContain('THE LANDING')
  })

  it('holds the checking line on pages that bring no slot, as before', () => {
    expect(html({})).toContain('Checking your session')
  })
})
