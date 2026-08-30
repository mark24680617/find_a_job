'use client'

import Link from 'next/link'
import { useState } from 'react'
import { apiDownload } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import { formatWhen, ROUND_LABEL } from '@/lib/rounds'
import type { Application, InterviewRound } from '@/lib/types'

/**
 * The interviews still ahead, across every application, soonest first.
 *
 * It sits above the board because it is the only thing on this page with a deadline, and it
 * disappears entirely when there are none — an empty "Upcoming" heading is a promise the
 * product has not kept yet, and most people here have no rounds booked at all.
 *
 * "Add to calendar" hands the event to whatever the person actually lives in. It downloads
 * rather than links out: the round belongs to them, and a calendar entry read on a phone at
 * the wrong moment is the failure this is here to prevent.
 */

export interface UpcomingRound {
  app: Application
  round: InterviewRound
}

/** Milliseconds, or NaN for a round whose notice never yielded a readable time. */
const startsAt = (u: UpcomingRound) => Date.parse(u.round.datetime ?? '')

/**
 * The rounds still ahead, soonest first. A round with no time on it cannot be placed on this
 * list at all — `NaN >= now` is false — which is the same answer the .ics route gives.
 */
export function upcomingRounds(all: UpcomingRound[], now = Date.now()): UpcomingRound[] {
  return all.filter((u) => startsAt(u) >= now).sort((a, b) => startsAt(a) - startsAt(b))
}

export function UpcomingStrip({ items }: { items: UpcomingRound[] }) {
  if (items.length === 0) return null

  return (
    <section aria-labelledby="next-up" className="mt-8">
      <h2
        id="next-up"
        className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-ink-2"
      >
        Next up
      </h2>
      <ul className="mt-2 border-t border-line-strong">
        {items.map((item) => (
          <Row key={`${item.app.id}:${item.round.id}`} item={item} />
        ))}
      </ul>
    </section>
  )
}

function Row({ item: { app, round } }: { item: UpcomingRound }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    setBusy(true)
    setError('')
    try {
      await apiDownload(`/api/applications/${app.id}/interviews/${round.id}/ics`, 'interview.ics')
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') || 'That didn’t download. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-3">
      <time dateTime={round.datetime} className="tnum text-[0.9375rem] text-ink">
        {formatWhen(round.datetime)}
      </time>

      <p className="text-[0.9375rem] text-ink-2">
        <Link
          href={`/applications/${app.id}`}
          className="text-ink underline-offset-4 hover:underline"
        >
          {app.company}
        </Link>
        <span className="text-ink-3"> · </span>
        {ROUND_LABEL[round.roundType]}
        {round.people.length > 0 && (
          <span className="text-ink-3"> · with {round.people.join(', ')}</span>
        )}
      </p>

      <div className="ml-auto flex items-baseline gap-3">
        {error && (
          <span role="alert" className="text-[0.8125rem] text-danger">
            {error}
          </span>
        )}
        <button
          type="button"
          // Every row's button says the same three words, so the name has to carry the row —
          // and it opens with them verbatim, so "add to calendar" spoken at the screen still
          // matches what is written on it (WCAG 2.5.3).
          aria-label={`Add to calendar: ${app.company} ${ROUND_LABEL[round.roundType]}`}
          className="btn-link shrink-0 text-[0.8125rem]"
          disabled={busy}
          onClick={() => void download()}
        >
          {busy ? 'Preparing…' : 'Add to calendar'}
        </button>
      </div>
    </li>
  )
}
