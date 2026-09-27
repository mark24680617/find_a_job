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

import { AppShell, activeHref, navItems } from '@/components/AppShell'

describe('navItems', () => {
  it('puts Resume after Profile, and keeps Account last for everyone', () => {
    expect(navItems(false).map((n) => n.label)).toEqual([
      'Dashboard', 'Profile', 'Resume', 'New Application', 'Account',
    ])
    expect(navItems(false).at(-1)).toEqual({ href: '/account', label: 'Account' })
  })
  it('adds Admin last, only for the administrator', () => {
    expect(navItems(true).map((n) => n.href)).toEqual([
      '/', '/profile', '/profile/resume', '/applications/new', '/account', '/admin',
    ])
  })
})

describe('activeHref', () => {
  it('marks only the nested entry on /profile/resume', () => {
    expect(activeHref('/profile/resume', navItems(false))).toBe('/profile/resume')
  })
  it('marks Profile on /profile', () => {
    expect(activeHref('/profile', navItems(false))).toBe('/profile')
  })
  it('marks Dashboard only on /', () => {
    expect(activeHref('/', navItems(false))).toBe('/')
  })
  it('marks nothing on an application page, as before', () => {
    expect(activeHref('/applications/abc123', navItems(false))).toBeUndefined()
  })
  it('marks Admin on /admin for the administrator', () => {
    expect(activeHref('/admin', navItems(true))).toBe('/admin')
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
