'use client'

import { useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { authMessage } from '@/lib/authMessage'
import { changePassword, requestEmailChange } from '@/lib/firebase/client'
import { hasPasswordProvider } from '@/lib/providers'

/**
 * How signing in works, and the two things about it a password account may change. Each
 * change starts with the current password, because Firebase will not make either without a
 * fresh proof that this is the same person — and asking for it up front is what lets the
 * form say "wrong password" instead of "sign in again". An email change is not immediate:
 * Firebase sends a link to the NEW address and changes nothing until it is opened, so the
 * note says exactly that rather than "changed".
 *
 * A Google account has neither a password nor an email of its own here; it gets one line.
 */

interface Props {
  user: User
}

export function SignInSettings({ user }: Props) {
  const withPassword = hasPasswordProvider(user.providerData.map((p) => p.providerId))

  return (
    <section aria-labelledby="signin-heading">
      <h2 id="signin-heading" className="font-display text-lg tracking-tight text-ink">
        Sign-in
      </h2>
      {withPassword ? (
        <div className="mt-4 grid gap-8 md:grid-cols-2">
          <PasswordForm user={user} />
          <EmailForm user={user} />
        </div>
      ) : (
        <p className="mt-3 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
          You sign in with Google. Your password and email are managed there.
        </p>
      )}
    </section>
  )
}

function PasswordForm({ user }: { user: User }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNote('')
    try {
      await changePassword(user, current, next)
      setCurrent('')
      setNext('')
      setNote('Password changed.')
    } catch (err) {
      setError(authMessage(err, 'account'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <h3 className="text-sm font-medium text-ink-2">Change password</h3>
      <fieldset disabled={busy} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm text-ink-2">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            className="field field-boxed h-10 px-3"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-ink-2">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            className="field field-boxed h-10 px-3"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" className="btn btn-quiet" disabled={busy || !current || next.length < 6}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
          <p role="status" aria-live="polite" className={`text-sm ${error ? 'text-danger' : 'text-accent'}`}>
            {error || note}
          </p>
        </div>
      </fieldset>
    </form>
  )
}

function EmailForm({ user }: { user: User }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNote('')
    try {
      await requestEmailChange(user, current, next)
      setCurrent('')
      setNote(`We sent a link to ${next.trim()}. Your email changes when you open it.`)
      setNext('')
    } catch (err) {
      setError(authMessage(err, 'account'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <h3 className="text-sm font-medium text-ink-2">Change email</h3>
      <fieldset disabled={busy} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className="text-sm text-ink-2">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            className="field field-boxed h-10 px-3"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-ink-2">New email</span>
          <input
            type="email"
            autoComplete="email"
            required
            className="field field-boxed h-10 px-3"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" className="btn btn-quiet" disabled={busy || !current || !next.trim()}>
            {busy ? 'Sending…' : 'Change email'}
          </button>
          <p role="status" aria-live="polite" className={`max-w-[40ch] text-sm ${error ? 'text-danger' : 'text-accent'}`}>
            {error || note}
          </p>
        </div>
      </fieldset>
    </form>
  )
}
