'use client'

import { useCallback, useEffect, useState } from 'react'
import { useCurrentUser, useUnsavedChanges } from '@/components/AppShell'
import { DeleteAccount } from '@/components/account/DeleteAccount'
import { NameAndPhoto } from '@/components/account/NameAndPhoto'
import { Overview } from '@/components/account/Overview'
import { SignInSettings } from '@/components/account/SignInSettings'
import { apiFetch } from '@/lib/apiFetch'
import { signOutUser } from '@/lib/firebase/client'
import type { Usage } from '@/lib/types'

/**
 * The account page: the Firebase Auth identity behind the vault, as distinct from the vault
 * itself (that is /profile). Four sections, top to bottom — what is known, what can be
 * typed, how signing in works, and the one irreversible action — each its own component,
 * because each talks to Firebase differently. This screen only composes them, fetches the
 * two counts, and relays the name form's unsaved state to the shell.
 */

const SECTION_GAP = 'mt-14'

export function AccountScreen() {
  const user = useCurrentUser()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    let live = true
    apiFetch<Usage>('/api/account')
      .then((next) => live && setUsage(next))
      // The counts are the only thing that came from the server; the dashes stay.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  useUnsavedChanges(dirty)
  const onDirty = useCallback((next: boolean) => setDirty(next), [])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-10 pb-16">
      <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">Account</h1>
      <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
        How you sign in, and what is kept under it. Your facts and answers are on the profile.
      </p>

      <div className={SECTION_GAP}>
        <Overview user={user} usage={usage} />
      </div>
      <div className={SECTION_GAP}>
        <NameAndPhoto user={user} onDirty={onDirty} />
      </div>
      <div className={SECTION_GAP}>
        <SignInSettings user={user} />
      </div>
      <div className={SECTION_GAP}>
        {/* The Auth user is already gone by the time this fires; signing out clears the
            session this browser still holds, and the shell drops to the gate. A rejected
            sign-out would otherwise leave the button reading "Deleting…" forever, so it
            reloads instead — the gate is where that lands too, the account being gone. */}
        <DeleteAccount
          user={user}
          onDeleted={() => signOutUser().catch(() => window.location.reload())}
        />
      </div>
    </main>
  )
}
