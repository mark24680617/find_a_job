'use client'

import Link from 'next/link'
import { useState } from 'react'
import { readable } from '@/lib/readable'
import type { Application, AppStatus, TimelineEvent } from '@/lib/types'

/**
 * Every application, in the column it has reached.
 *
 * The board is a ledger, not a workspace: five ruled columns, one line per record, no
 * dragging. What a person comes here for is the answer to "where is everything, and what
 * has gone quiet" — so each card carries the one number that is hard to hold in your head,
 * the days since anything last happened to it.
 *
 * A card asks one question rather than offering five answers. What actually happens next to a
 * draft is that you submit it, and to an applied record that somebody writes back — so the card
 * offers that one move, labelled with the column it lands in, and keeps the full list of
 * destinations in a quiet select underneath for the corrections that don't follow the path. Both
 * go through the same PATCH and write the same timeline entry.
 *
 * The rest of the card is one link to the record, so the whole card is a click target; every
 * control stacks above that link rather than inside it.
 */

/** The columns, in the order an application moves through them. */
export const COLUMNS: readonly { status: AppStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'applied', label: 'Applied' },
  { status: 'interviewing', label: 'Interviewing' },
  { status: 'offer', label: 'Offer' },
  { status: 'rejected', label: 'Rejected' },
]

/** When anything last happened to this record — the newest timeline entry, else its creation. */
export function lastTouched(app: Application): string {
  const last = app.timeline.at(-1)?.at
  return last && !Number.isNaN(Date.parse(last)) ? last : app.createdAt
}

/** How long it has sat there: `today`, `yesterday`, `12 days`. Empty when the date is unreadable. */
export function ageLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today' // a clock ahead of ours is still today's news
  if (days === 1) return 'yesterday'
  return `${days} days`
}

/**
 * The PATCH that moves a record to another column: the new status, and the timeline with one
 * entry appended. The whole array is sent rather than a Firestore array-union so the history
 * stays ordered and readable, and it is composed here — from the copy the board is showing —
 * for the same reason the review screen composes its own: the server does not invent events.
 */
export function statusChange(
  app: Application,
  next: AppStatus,
  at = new Date().toISOString(),
): { status: AppStatus; timeline: TimelineEvent[] } {
  return { status: next, timeline: [...app.timeline, { event: `status → ${next}`, at }] }
}

/** A step the record can take from where it is: the words for it, and where it lands. */
export interface NextStep {
  label: string
  to: AppStatus
  /** `advance` is the expected next thing; `aside` is the other way it can end. */
  tone: 'advance' | 'aside'
}

/**
 * What happens next, named by where it lands. One word each, matching the column heading it
 * moves the card under — a button that says "Applied" beside a column called Applied leaves
 * nothing to work out, where a sentence ("I submitted it") had to be read before it could be
 * clicked. An offer and a rejection are both ends of the line, so neither offers a next step —
 * correcting one is what the select below is for.
 */
const NEXT_STEPS: Record<AppStatus, NextStep[]> = {
  draft: [{ label: 'Applied', to: 'applied', tone: 'advance' }],
  applied: [{ label: 'Interviewing', to: 'interviewing', tone: 'advance' }],
  interviewing: [
    { label: 'Offer', to: 'offer', tone: 'advance' },
    { label: 'Rejected', to: 'rejected', tone: 'aside' },
  ],
  offer: [],
  rejected: [],
}

export function nextSteps(status: AppStatus): NextStep[] {
  return NEXT_STEPS[status] ?? []
}

interface Props {
  apps: Application[]
  /** Persist the move and hand back the updated record. Rejects with a message to show. */
  onMove: (app: Application, next: AppStatus) => Promise<void>
  /** Delete the record and drop it from the board. Rejects with a message to show. */
  onRemove: (app: Application) => Promise<void>
}

export function PipelineBoard({ apps, onMove, onRemove }: Props) {
  return (
    <section
      aria-label="Pipeline"
      className="mt-8 grid gap-x-5 gap-y-9 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
    >
      {COLUMNS.map(({ status, label }) => {
        const inColumn = apps.filter((a) => a.status === status)
        return (
          <section key={status} aria-labelledby={`col-${status}`}>
            <div className="flex items-baseline justify-between gap-2 border-b border-line-strong pb-1.5">
              <h2
                id={`col-${status}`}
                className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-ink-2"
              >
                {label}
              </h2>
              <span className="tnum text-[0.6875rem] text-ink-3">{inColumn.length}</span>
            </div>

            <ul className="mt-3 flex flex-col gap-2.5">
              {inColumn.map((app) => (
                <li key={app.id}>
                  <Card app={app} onMove={onMove} onRemove={onRemove} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </section>
  )
}

function Card({
  app,
  onMove,
  onRemove,
}: {
  app: Application
  onMove: Props['onMove']
  onRemove: Props['onRemove']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const touched = lastTouched(app)
  const steps = nextSteps(app.status)

  /** One wrapper for both writes: the card is frozen while either is in flight. */
  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      // A removal that failed leaves the card on the board; a move that failed leaves it in
      // its column. Either way the card is still here and has to come back to life.
      setError(readable(err instanceof Error ? err.message : '') || fallback)
      setBusy(false)
    }
    // No `finally`: success always unmounts this card — a move puts it in another column's
    // list, a removal takes it off the board — so there is no `busy` left to clear.
  }

  const move = (next: AppStatus) =>
    run(() => onMove(app, next), 'That didn’t save. Try again.')

  function remove() {
    // Naming the record and what goes with it, because nothing here comes back: the answers
    // written against this posting and any interview rounds are deleted with it.
    const sure = window.confirm(
      `Remove ${app.company} · ${app.role}?\n\n` +
        'Its questions, drafted answers and interview rounds are deleted with it. This cannot be undone.',
    )
    if (sure) void run(() => onRemove(app), 'That didn’t delete. Try again.')
  }

  return (
    <article className="relative rounded-[3px] border border-line bg-surface px-3 pt-2.5 pb-2 transition-colors hover:border-line-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent">
      <h3 className="font-display text-[0.9375rem] leading-snug text-ink">
        {/* The link covers the card, so the card wears its focus ring rather than the four
            words inside it; every control below sits above the link in the stack. */}
        <Link
          href={`/applications/${app.id}`}
          className="after:absolute after:inset-0 focus-visible:outline-none"
        >
          {app.company}
        </Link>
      </h3>
      <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-2">{app.role}</p>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        {/* No tooltip: the link above covers the card, so a `title` here would never show. */}
        <time dateTime={touched} className="tnum shrink-0 text-[0.6875rem] text-ink-3">
          {ageLabel(touched)}
        </time>

        {/* Nothing at the end of the line: an offer and a rejection are corrected below, not
            advanced. The row keeps the age on its own where that happens. */}
        {steps.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {steps.map(({ label, to, tone }) => (
              <button
                key={to}
                type="button"
                className={
                  tone === 'advance'
                    ? 'btn btn-quiet relative z-10 min-h-7 px-2 text-[0.75rem]'
                    : 'btn-link relative z-10 text-[0.75rem] text-ink-3'
                }
                disabled={busy}
                onClick={() => void move(to)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The corrections, ruled off from the step above: any column, or none at all. */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-1.5">
        <select
          aria-label={`Move ${app.company} to another column`}
          className="relative z-10 max-w-[8.5rem] rounded-[3px] border border-line bg-surface px-1 py-0.5 text-[0.6875rem] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 disabled:cursor-not-allowed disabled:opacity-55"
          // Always the placeholder, never the current column: this is an action, not a field
          // that shows where the record is — the column it sits in already says that.
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && void move(e.target.value as AppStatus)}
        >
          <option value="">Move to…</option>
          {COLUMNS.filter((c) => c.status !== app.status).map(({ status, label }) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-label={`Remove ${app.company} · ${app.role}`}
          className="btn-link relative z-10 shrink-0 text-[0.6875rem] text-ink-3 hover:text-danger"
          disabled={busy}
          onClick={remove}
        >
          Remove
        </button>
      </div>

      {error && (
        <p role="alert" className="relative z-10 mt-1.5 text-[0.6875rem] text-danger">
          {error}
        </p>
      )}
    </article>
  )
}
