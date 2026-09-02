'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { SignInGate } from '@/components/SignInGate'
import { readAdminClaim, signOutUser, watchUser } from '@/lib/firebase/client'

/**
 * The frame every page sits in, and the only place in the app that subscribes to Firebase's
 * sign-in state. Children are not rendered at all until a user exists, so no page can fire a
 * request at our API while signed out — the gate is structural, not a check each page repeats.
 * A sign-out unmounts the page below rather than leaving stale data on screen, and signing
 * back in mounts it fresh, so pages never have to notice that the user changed.
 *
 * It also owns every way out of a page: the nav links, the wordmark, Sign out, and the tab
 * itself. A page with unsaved work calls `useUnsavedChanges(true)` and the shell asks before
 * any of them throws that work away.
 */

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
  { href: '/applications/new', label: 'New Application' },
  { href: '/account', label: 'Account' },
] as const

const ADMIN_NAV = { href: '/admin', label: 'Admin' } as const

/** The links this person gets. Admin is drawn from the token's claim; the server is the guard. */
export function navItems(isAdmin: boolean): { href: string; label: string }[] {
  return isAdmin ? [...NAV, ADMIN_NAV] : [...NAV]
}

/**
 * How a page tells the shell it is holding unsaved work. A callback rather than a boolean:
 * the shell owns the state, the page only reports into it, and there is exactly one place
 * that decides what a leave attempt does.
 */
const UnsavedContext = createContext<(unsaved: boolean) => void>(() => {})

/**
 * The signed-in user, for the pages that are about them rather than their data. Null only
 * outside the shell, which no page is — so the hook throws rather than making every caller
 * handle a case that cannot happen.
 */
const UserContext = createContext<User | null>(null)

export function useCurrentUser(): User {
  const user = useContext(UserContext)
  if (!user) throw new Error('useCurrentUser must be used inside AppShell')
  return user
}

/** Declare that this page has edits that a navigation would discard. */
export function useUnsavedChanges(unsaved: boolean): void {
  const report = useContext(UnsavedContext)
  useEffect(() => {
    report(unsaved)
    // Unmounting is not the same as saving, but the page is gone and the warning would have
    // nothing left to protect.
    return () => report(false)
  }, [unsaved, report])
}

export function AppShell({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const pathname = usePathname()

  useEffect(
    () =>
      watchUser((next) => {
        setUser(next)
        setReady(true)
        // Read once per sign-in. A failure means no link, which is the safe way to be wrong.
        if (next) void readAdminClaim(next).then(setIsAdmin, () => setIsAdmin(false))
        else setIsAdmin(false)
      }),
    [],
  )

  // Covers the exits the router never sees: reload, close, typing a different address. The
  // browser shows its own wording here — `preventDefault` is all a page is allowed to say.
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  /** True when leaving is fine: nothing outstanding, or the person said to drop it. */
  const mayLeave = () =>
    !unsaved || window.confirm('Leave this page? Your unsaved edits will be lost.')

  // Firebase restores the persisted session from IndexedDB asynchronously. Showing the gate
  // during that gap would flash a sign-in form at somebody who is already signed in.
  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center px-6" aria-busy="true">
        <p className="text-sm text-ink-3">Checking your session…</p>
      </main>
    )
  }

  if (!user) return <SignInGate />

  return (
    <UserContext.Provider value={user}>
      <UnsavedContext.Provider value={setUnsaved}>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3.5">
            <Link
              href="/"
              className="font-display text-base font-medium tracking-tight text-ink"
              onClick={(e) => {
                if (!mayLeave()) e.preventDefault()
              }}
            >
              Find a Job
            </Link>

            <nav aria-label="Main" className="flex items-center gap-6 text-sm">
              {navItems(isAdmin).map(({ href, label }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    onClick={(e) => {
                      if (!active && !mayLeave()) e.preventDefault()
                    }}
                    className={
                      active
                        ? 'border-b border-accent pb-0.5 font-medium text-ink'
                        : 'border-b border-transparent pb-0.5 text-ink-2 hover:text-ink'
                    }
                  >
                    {label}
                  </Link>
                )
              })}
            </nav>

            <div className="ml-auto flex items-center gap-4 text-sm">
              <span className="hidden max-w-[22ch] truncate text-ink-3 sm:inline" title={user.email ?? ''}>
                {user.email ?? user.displayName ?? 'Signed in'}
              </span>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  if (mayLeave()) void signOutUser()
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {children}
      </UnsavedContext.Provider>
    </UserContext.Provider>
  )
}
