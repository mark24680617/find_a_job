'use client'

import { dateOnly } from '@/lib/dates'
import { providerLabel } from '@/lib/providers'
import type { AdminUser } from '@/lib/types'

/**
 * Every account, one row each, ruled and quiet like the fact bank. Numbers, never content:
 * the panel knows how much someone holds and nothing about what. Two actions per row, both
 * text — a table of buttons drowns the table — and the administrator's own row has neither,
 * because the server would refuse them anyway and a button that always fails is worse than
 * no button.
 */

/** The row whose request is in flight, and the verb its actions read until the server answers. */
export interface Busy {
  uid: string
  verb: 'Disabling…' | 'Enabling…' | 'Deleting…'
}

interface Props {
  users: AdminUser[]
  /** The administrator's own uid — that row gets "you" instead of actions. */
  you: string
  /** What is in flight, if anything; every row's actions wait on it. */
  busy: Busy | null
  onToggle: (user: AdminUser) => void
  onDelete: (user: AdminUser) => void
}

// The last column carries the row's actions. It is headed like the fact bank's: named for a
// screen reader, blank to the eye, because a word over two text buttons only adds noise.
const HEAD = ['Email', 'Name', 'Sign-in', 'Created', 'Last sign-in', 'Applications', 'Facts', 'Status', 'Actions'] as const
const ACTIONS = HEAD.length - 1

export function UserTable({ users, you, busy, onToggle, onDelete }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-[0.9375rem]">
        <thead>
          <tr className="border-b border-line-strong text-left text-xs uppercase tracking-[0.12em] text-ink-3">
            {HEAD.map((h, i) => (
              <th key={i} scope="col" className={`py-2 pr-4 font-medium ${i >= 5 && i <= 6 ? 'text-right' : ''}`}>
                {i === ACTIONS ? <span className="sr-only">{h}</span> : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.length === 0 && (
            <tr>
              <td colSpan={HEAD.length} className="py-6 text-sm text-ink-3">
                No accounts match.
              </td>
            </tr>
          )}
          {users.map((u) => {
            const pending = busy?.uid === u.uid ? busy.verb : null
            const self = u.uid === you
            return (
              <tr key={u.uid} className="border-b border-line align-top">
                <td className="py-2.5 pr-4">
                  <span className="text-ink">{u.email || '—'}</span>
                  {!u.emailVerified && u.email && (
                    <span className="ml-2 text-xs text-ink-3">unverified</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-ink-2">{u.displayName || '—'}</td>
                <td className="py-2.5 pr-4 text-ink-2">{providerLabel(u.provider)}</td>
                <td className="tnum py-2.5 pr-4 text-ink-2">{dateOnly(u.createdAt)}</td>
                <td className="tnum py-2.5 pr-4 text-ink-2">
                  {u.lastSignInAt ? dateOnly(u.lastSignInAt) : 'never'}
                </td>
                <td className="tnum py-2.5 pr-4 text-right">{u.applications}</td>
                <td className="tnum py-2.5 pr-4 text-right">{u.facts}</td>
                <td className="py-2.5 pr-4">
                  {u.disabled ? (
                    <span className="text-danger">disabled</span>
                  ) : (
                    <span className="text-ink-2">active</span>
                  )}
                </td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  {self ? (
                    <span className="text-sm text-ink-3">you</span>
                  ) : pending ? (
                    <span className="text-sm text-ink-3">{pending}</span>
                  ) : (
                    <span className="flex justify-end gap-4 text-sm">
                      <button type="button" className="btn-link" disabled={busy !== null} onClick={() => onToggle(u)}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        type="button"
                        className="btn-link text-danger"
                        disabled={busy !== null}
                        onClick={() => onDelete(u)}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
