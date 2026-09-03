'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AppShell } from '@/components/AppShell'
import { SignInGate } from '@/components/SignInGate'

/**
 * The sign-in wall, on its own address. A signed-out visitor gets the form; a signed-in one
 * has nothing to do here and is sent home. The redirect runs from an effect, after the shell
 * has confirmed there is a user, so nobody is bounced on the strength of a stale cookie.
 */

interface Props {
  mode: 'sign-in' | 'sign-up'
  returning: boolean
}

function ToDashboard() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/')
  }, [router])
  return (
    <main className="flex flex-1 items-center justify-center px-6" aria-busy="true">
      <p className="text-sm text-ink-3">Opening your vault…</p>
    </main>
  )
}

export function SignInScreen({ mode, returning }: Props) {
  return (
    <AppShell signedOut={<SignInGate initialMode={mode} />} returning={returning}>
      <ToDashboard />
    </AppShell>
  )
}
