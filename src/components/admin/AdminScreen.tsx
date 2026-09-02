'use client'

import { useEffect, useState } from 'react'
import { useCurrentUser } from '@/components/AppShell'
import { UserTable, type Busy } from '@/components/admin/UserTable'
import { filterUsers, sortByLastSignIn } from '@/lib/adminUsers'
import { ApiError, apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { AdminUser } from '@/lib/types'

/**
 * The administrator's page. It has nothing to show without the list, so a failed load is
 * the whole screen; a 403 is the one failure with its own sentence, because the address is
 * guessable and the person who typed it should be told plainly rather than shown an error.
 *
 * Search is local — the first page is already here — and the two actions replace one row
 * from the server's answer rather than refetching the list.
 */

interface Page {
  users: AdminUser[]
  nextPageToken?: string
}

const FORBIDDEN = 'This page is for the administrator.'

export function AdminScreen() {
  const me = useCurrentUser()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [nextToken, setNextToken] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [actionError, setActionError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  /** The list request. It sets nothing itself, so the mount effect can await it. */
  function fetchPage(token?: string) {
    return apiFetch<Page>(
      `/api/admin/users${token ? `?pageToken=${encodeURIComponent(token)}` : ''}`,
    )
  }

  /** Take a page in: the first one is the list, a later one extends it. */
  function absorb(page: Page, append: boolean) {
    setUsers((prev) => [...(append ? (prev ?? []) : []), ...page.users])
    setNextToken(page.nextPageToken)
  }

  // Once, on mount — the list is what the page is.
  useEffect(() => {
    let live = true
    fetchPage()
      .then((page) => live && absorb(page, false))
      .catch((err: unknown) => {
        if (!live) return
        if (err instanceof ApiError && err.status === 403) setLoadError(FORBIDDEN)
        else setLoadError(readable(err instanceof Error ? err.message : '') || 'The accounts could not be loaded.')
      })
    return () => {
      live = false
    }
  }, [])

  async function loadMore() {
    setLoadingMore(true)
    setActionError('')
    try {
      absorb(await fetchPage(nextToken), true)
    } catch (err) {
      setActionError(readable(err instanceof Error ? err.message : '') || 'More accounts could not be loaded.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function toggle(u: AdminUser) {
    if (
      !u.disabled &&
      !window.confirm(`Disable ${u.email || u.uid}? They cannot sign in until you enable them again.`)
    ) {
      return
    }
    setBusy({ uid: u.uid, verb: u.disabled ? 'Enabling…' : 'Disabling…' })
    setActionError('')
    try {
      const updated = await apiFetch<AdminUser>(`/api/admin/users/${u.uid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !u.disabled }),
      })
      setUsers((prev) => (prev ?? []).map((row) => (row.uid === u.uid ? updated : row)))
    } catch (err) {
      setActionError(readable(err instanceof Error ? err.message : '') || 'That didn’t save. Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(u: AdminUser) {
    if (!window.confirm(`Delete ${u.email || u.uid} and everything in their account? This cannot be undone.`)) {
      return
    }
    setBusy({ uid: u.uid, verb: 'Deleting…' })
    setActionError('')
    try {
      await apiFetch(`/api/admin/users/${u.uid}`, { method: 'DELETE' })
      setUsers((prev) => (prev ?? []).filter((row) => row.uid !== u.uid))
    } catch (err) {
      setActionError(readable(err instanceof Error ? err.message : '') || 'That didn’t delete. Try again.')
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p role="alert" className="text-[0.9375rem] text-danger">
          {loadError}
        </p>
      </main>
    )
  }

  if (!users) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16" aria-busy="true">
        <p className="text-sm text-ink-3">Reading the accounts…</p>
      </main>
    )
  }

  const shown = filterUsers(sortByLastSignIn(users), query)
  const disabledCount = users.filter((u) => u.disabled).length

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-10 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">Accounts</h1>
          <p className="tnum mt-2 text-sm text-ink-3">
            {users.length} {users.length === 1 ? 'account' : 'accounts'} · {disabledCount} disabled
          </p>
        </div>
        <label className="grid gap-1.5">
          <span className="sr-only">Search accounts</span>
          <input
            type="search"
            placeholder="Email or name"
            className="field field-boxed h-10 w-64 px-3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </header>

      <div className="mt-8">
        <UserTable users={shown} you={me.uid} busy={busy} onToggle={(u) => void toggle(u)} onDelete={(u) => void remove(u)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {nextToken && (
          <button type="button" className="btn btn-quiet" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-danger">
            {actionError}
          </p>
        )}
      </div>
    </main>
  )
}
