import { describe, it, expect, vi } from 'vitest'

// Importing the shell reaches `@/lib/firebase/client`, which builds an Auth instance at
// module scope. The nav is the only thing under test here, and it is a pure function.
vi.mock('@/lib/firebase/client', () => ({
  auth: {},
  watchUser: vi.fn(),
  signOutUser: vi.fn(),
  readAdminClaim: vi.fn(),
}))

import { navItems } from '@/components/AppShell'

describe('navItems', () => {
  it('shows Account to everyone, after New Application', () => {
    expect(navItems(false).map((n) => n.label)).toEqual(['Dashboard', 'Profile', 'New Application', 'Account'])
    expect(navItems(false).at(-1)).toEqual({ href: '/account', label: 'Account' })
  })
  it('adds Admin last, only for the administrator', () => {
    expect(navItems(true).map((n) => n.href)).toEqual(['/', '/profile', '/applications/new', '/account', '/admin'])
  })
})
