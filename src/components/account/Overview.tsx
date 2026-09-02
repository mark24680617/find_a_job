'use client'

import Link from 'next/link'
import { type ReactNode } from 'react'
import type { User } from 'firebase/auth'
import { dateOnly } from '@/lib/dates'
import { providerLabel } from '@/lib/providers'
import type { Usage } from '@/lib/types'

/**
 * What Firebase and Firestore know about this account, read-only, as a ledger: a label, a
 * value, a rule. The two counts arrive one request after the page and read as a dash until
 * they do — nothing else here waits on them.
 */

interface Props {
  user: User
  usage: Usage | null
}

export function Overview({ user, usage }: Props) {
  const provider = user.providerData[0]?.providerId ?? ''
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Email', value: user.email ?? '—' },
    { label: 'Signs in with', value: providerLabel(provider) },
    { label: 'Member since', value: dateOnly(user.metadata.creationTime) },
    { label: 'Last signed in', value: dateOnly(user.metadata.lastSignInTime) },
    { label: 'Applications', value: <span className="tnum">{usage ? usage.applications : '—'}</span> },
    {
      label: 'Facts',
      value: (
        <>
          <span className="tnum">{usage ? usage.facts : '—'}</span>
          <Link href="/profile" className="btn-link ml-3 text-sm">
            Open the profile
          </Link>
        </>
      ),
    },
  ]
  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="font-display text-lg tracking-tight text-ink">
        Overview
      </h2>
      <dl className="mt-4 divide-y divide-line border-y border-line">
        {rows.map(({ label, value }) => (
          <div key={label} className="grid gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6">
            <dt className="text-sm text-ink-3">{label}</dt>
            <dd className="min-w-0 text-[0.9375rem] text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
