'use client'

import { useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { ParseConfirm } from '@/components/wizard/ParseConfirm'
import { SourceStep } from '@/components/wizard/SourceStep'
import type { Application } from '@/lib/types'

/**
 * Starting an application: hand over the posting, then read back what the agent made of it.
 *
 * Two steps on one page rather than two routes. The create is what produces the record, so
 * there is no id to put in an address until the first step has finished — and once it has,
 * the confirmation is about the thing that was just made, not a new place to be.
 *
 * Nothing on the second step is a draft: the record was written by the create, and each
 * correction goes straight back. Leaving the page is safe at any point after that, which is
 * why this page never claims unsaved work.
 */

export default function NewApplicationPage() {
  return (
    <AppShell>
      <NewApplication />
    </AppShell>
  )
}

function NewApplication() {
  const [app, setApp] = useState<Application | null>(null)

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-16">
      <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">
        New application
      </h1>
      <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
        {app
          ? 'What the agent read out of the posting. Correct anything it got wrong before you write from it.'
          : 'One posting, one record. The answers get written later, from your profile.'}
      </p>

      {app ? <ParseConfirm app={app} onUpdated={setApp} /> : <SourceStep onCreated={setApp} />}
    </main>
  )
}
