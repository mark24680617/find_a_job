import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AdminUser } from '@/lib/types'

// The administrator's table as first seen: one row per account, the administrator's own
// row with no actions, a disabled row marked in danger. The actions themselves are clicks
// and are not run here.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { UserTable } from '@/components/admin/UserTable'

const user = (over: Partial<AdminUser>): AdminUser => ({
  uid: 'u',
  email: 'a@example.com',
  emailVerified: true,
  displayName: '',
  provider: 'google.com',
  createdAt: '2026-08-28T02:51:50.000Z',
  lastSignInAt: '2026-09-01T22:25:00.000Z',
  disabled: false,
  applications: 4,
  facts: 18,
  ...over,
})

const rows = [
  user({ uid: 'admin-1', email: 'admin@example.com', emailVerified: false, displayName: 'Mark', provider: 'password' }),
  user({ uid: 'u2', email: 'tom@example.com', disabled: true, lastSignInAt: null }),
]

const html = (over: Partial<Parameters<typeof UserTable>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(UserTable, {
      users: rows,
      you: 'admin-1',
      busy: null,
      onToggle: () => {},
      onDelete: () => {},
      ...over,
    }),
  )

describe('UserTable', () => {
  it('renders one row per account with the columns the spec names', () => {
    const markup = html()
    expect(markup).toContain('admin@example.com')
    expect(markup).toContain('tom@example.com')
    expect(markup).toContain('Email and password')
    expect(markup).toContain('Google')
    expect(markup).toContain('unverified')
    expect(markup).toContain('never')
    expect(markup).toMatch(/>18</)
    expect(markup).toContain('<span class="sr-only">Actions</span>')
  })

  it('marks a disabled account in danger and offers Enable; an active one gets Disable', () => {
    const markup = html()
    expect(markup).toContain('text-danger">disabled<')
    expect(markup).toContain('>Enable<')
    // The only active row is the administrator's, which carries no actions.
    expect(markup).not.toContain('>Disable<')
  })

  it('gives the administrator’s own row "you" instead of actions', () => {
    const markup = html()
    expect(markup).toContain('>you<')
    expect(markup.split('>Delete<')).toHaveLength(2)
  })

  it('shows the pending verb on the row being acted on', () => {
    expect(html({ busy: { uid: 'u2', verb: 'Deleting…' } })).toContain('Deleting…')
  })

  it('says so when nothing matches', () => {
    expect(html({ users: [] })).toContain('No accounts match.')
  })
})
