'use client'

import { useState } from 'react'
import type { User } from 'firebase/auth'
import { apiFetch } from '@/lib/apiFetch'
import { authMessage } from '@/lib/authMessage'
import { reauthenticate } from '@/lib/firebase/client'
import { hasPasswordProvider } from '@/lib/providers'
import { readable } from '@/lib/readable'

/**
 * The one irreversible thing on the page, at the bottom of it, in the colour this product
 * keeps for destruction. The order is deliberate: prove it is you FIRST (a password, or the
 * Google window), then the confirm, then the request. Firebase requires the fresh sign-in
 * anyway; doing it before the confirm means nobody is asked "are you sure" and then told they
 * cannot. The server removes the data and the Auth user; what is left afterwards is this
 * browser's session, and signing out clears it.
 */

interface Props {
  user: User
  /** Called once the account is gone — the screen signs out, and the gate appears. */
  onDeleted: () => void
}

export function DeleteAccount({ user, onDeleted }: Props) {
  const withPassword = hasPasswordProvider(user.providerData.map((p) => p.providerId))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await reauthenticate(user, withPassword ? password : undefined)
    } catch (err) {
      setError(authMessage(err, 'account'))
      setBusy(false)
      return
    }
    if (!window.confirm('Delete your account and everything in it? This cannot be undone.')) {
      setBusy(false)
      return
    }
    try {
      await apiFetch('/api/account', { method: 'DELETE' })
      // `busy` stays set: the page is leaving.
      onDeleted()
    } catch (err) {
      setError(readable(err instanceof Error ? err.message : '') || 'That didn’t delete. Try again.')
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="delete-heading" className="border border-danger px-5 py-5">
      <h2 id="delete-heading" className="font-display text-lg tracking-tight text-ink">
        Delete account
      </h2>
      <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
        This removes every application and interview, the whole fact bank, and the sign-in
        itself. Nothing is kept, and nothing can be brought back.
      </p>
      <form
        className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void remove()
        }}
      >
        {withPassword && (
          <label className="grid gap-1.5">
            <span className="text-sm text-ink-2">Your password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
              className="field field-boxed h-10 w-56 px-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button type="submit" className="btn btn-danger" disabled={busy || (withPassword && !password)}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
        {error && (
          <p role="alert" className="basis-full text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
