'use client'

import { useState } from 'react'
import { signInWithEmail, signInWithGoogle, signUpWithEmail } from '@/lib/firebase/client'

/**
 * The sign-in wall. Two ways in, because the Google provider may or may not be switched on in
 * the Firebase console at any given moment and a dead button is worse than two live ones.
 *
 * Nothing here talks to our API — `AppShell` only renders the app once Firebase reports a user,
 * so a signed-out visitor never reaches a route handler and never sees a 401.
 */

const TAGLINE = 'Your story is unique. AI helps you tell it — it doesn’t replace it.'

/**
 * Firebase throws `FirebaseError` with a machine code and a message written for developers
 * ("Firebase: Error (auth/invalid-credential)."). Show the person what went wrong instead.
 */
function authMessage(error: unknown, kind: 'google' | 'email'): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
  // The person reading the screen cannot act on `auth/unauthorized-domain`; whoever is running
  // the app can. The code goes to the console so a failure is never a dead end for both of them.
  console.warn('sign-in failed:', code || error)
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.'
    case 'auth/invalid-email':
      return 'That doesn’t look like an email address.'
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.'
    case 'auth/weak-password':
      return 'Passwords need at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.'
    // Fires for whichever provider is switched off in the Firebase console, so it can only be
    // read against the button that was actually pressed. Naming the wrong one sends the person
    // to a method that is equally dead.
    case 'auth/operation-not-allowed':
      return kind === 'google'
        ? 'Google sign-in isn’t enabled yet. Use your email and password.'
        : 'Email and password sign-in isn’t enabled for this app yet.'
    // Firebase only allows OAuth pop-ups from domains on its authorized list, and a fresh
    // project does not have localhost on it. Nothing the person at the keyboard can fix.
    case 'auth/unauthorized-domain':
      return 'Google sign-in isn’t available on this address. Use your email and password.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow pop-ups, or use your email.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window closed before sign-in finished.'
    case 'auth/network-request-failed':
      return 'We couldn’t reach Firebase. Check your connection and try again.'
    default:
      return 'Sign-in failed. Try again.'
  }
}

export function SignInGate() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'google' | 'email' | null>(null)
  const [error, setError] = useState('')

  const signingUp = mode === 'sign-up'

  async function attempt(kind: 'google' | 'email', run: () => Promise<unknown>) {
    setBusy(kind)
    setError('')
    try {
      await run()
      // No navigation on success: `watchUser` fires and AppShell swaps this out.
    } catch (err) {
      setError(authMessage(err, kind))
      setBusy(null)
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="font-display text-xs uppercase tracking-[0.18em] text-accent">Find a Job</p>
        <h1 className="mt-5 font-display text-3xl leading-tight tracking-tight text-ink">
          {signingUp ? 'Create your vault' : 'Sign in to your vault'}
        </h1>
        <p className="mt-3 max-w-[34ch] text-[0.9375rem] leading-relaxed text-ink-2">{TAGLINE}</p>

        <button
          type="button"
          className="btn btn-quiet mt-8 w-full"
          disabled={busy !== null}
          onClick={() => void attempt('google', signInWithGoogle)}
        >
          {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>

        <div
          className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-ink-3"
          aria-hidden="true"
        >
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void attempt('email', () =>
              signingUp ? signUpWithEmail(email, password) : signInWithEmail(email, password),
            )
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              className="field field-boxed h-10 px-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink-2">Password</span>
            <input
              type="password"
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              required
              minLength={6}
              className="field field-boxed h-10 px-3"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <button type="submit" className="btn btn-primary mt-1" disabled={busy !== null}>
            {busy === 'email'
              ? signingUp
                ? 'Creating your account…'
                : 'Signing in…'
              : signingUp
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        {/* A polite status, so the failure reaches a screen reader that never saw the red
            text without interrupting whatever it is in the middle of saying. */}
        <p role="status" className="mt-4 min-h-5 text-sm text-danger">
          {error}
        </p>

        <p className="mt-2 text-sm text-ink-2">
          {signingUp ? 'Already have a vault?' : 'No vault yet?'}{' '}
          <button
            type="button"
            className="btn-link font-medium text-accent"
            onClick={() => {
              setMode(signingUp ? 'sign-in' : 'sign-up')
              setError('')
            }}
          >
            {signingUp ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </main>
  )
}
