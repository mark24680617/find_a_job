'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
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
 * A ledger keeps growing, so each column reads most recent first, by that same date, and stops
 * at six: the cards that moved last are the ones a glance should land on, and the rest are one
 * "Show all" away, with the button and the heading both counting the whole column. Rejected starts
 * folded to its heading and count — a rejection is finished business, kept for the record, and a
 * long run of them is the last thing to read on the way to the live ones. Offer stays open: an
 * ending too, but one still to be acted on. What is opened is kept in this component and nowhere
 * else, so a reload puts every column back at six and Rejected folded.
 *
 * The other way in is by name. The field above the columns narrows all five at once to the
 * records whose company and role, between them, hold every word typed, in any order. While it
 * holds a query nothing is capped or folded and each heading counts its matches; when nothing
 * matches, one line says so where the columns were. Escape empties it.
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

/**
 * Most recent activity first, by `lastTouched`, for `Array.prototype.sort`. A record whose date
 * can't be read goes to the end rather than wherever a NaN comparison happens to leave it, and a
 * tie compares equal — the sort is stable, so ties keep the order the list arrived in, which is
 * newest-created first.
 */
export function byLastTouched(a: Application, b: Application): number {
  const ta = Date.parse(lastTouched(a))
  const tb = Date.parse(lastTouched(b))
  const lostA = Number.isNaN(ta)
  const lostB = Number.isNaN(tb)
  if (lostA || lostB) return Number(lostA) - Number(lostB)
  return tb - ta
}

/** The words of a query, lowercased. None for a blank one. */
function words(query: string): string[] {
  const q = query.trim().toLowerCase()
  return q === '' ? [] : q.split(/\s+/)
}

/**
 * Whether a record answers the search: every word of the query appears somewhere in its company
 * or its role, in any order. The two are joined with a space, so no word can start in one and
 * finish in the other. A query with no words keeps every record.
 */
export function matchesQuery(app: Application, query: string): boolean {
  const text = `${app.company} ${app.role}`.toLowerCase()
  return words(query).every((word) => text.includes(word))
}

/** How many cards a column shows before the rest wait behind its button. */
const CAP = 6

export interface ColumnView {
  /** The cards to draw, most recent first. */
  shown: Application[]
  /** How many of the column's records are not drawn — past the cap, or behind the fold. */
  hidden: number
  /** The words on the column's one button, or null when it has none. */
  toggle: string | null
}

/**
 * What one column draws. Its records most recent first; with no query, the first `cap` of them
 * and a button for the rest — or, for a column that starts `collapsed`, none of them and a button
 * that says how many there are, until it is opened, when it opens whole. While a query is set,
 * every match and no button: a search that kept some of its answers behind a press would be
 * answering a smaller question than the one asked.
 */
export function columnView(
  apps: Application[],
  {
    query,
    cap,
    expanded,
    collapsed,
  }: { query: string; cap: number; expanded: boolean; collapsed: boolean },
): ColumnView {
  const matches = apps.filter((app) => matchesQuery(app, query)).sort(byLastTouched)
  const total = matches.length
  if (words(query).length > 0 || total === 0) return { shown: matches, hidden: 0, toggle: null }
  if (collapsed) {
    return expanded
      ? { shown: matches, hidden: 0, toggle: 'Hide' }
      : { shown: [], hidden: total, toggle: `Show ${total}` }
  }
  if (total <= cap) return { shown: matches, hidden: 0, toggle: null }
  return expanded
    ? { shown: matches, hidden: 0, toggle: 'Show fewer' }
    : { shown: matches.slice(0, cap), hidden: total - cap, toggle: `Show all ${total}` }
}

/**
 * What the board says about a search: nothing without one; how many records match, for a screen
 * reader, since the column counts already show it; and, when none do, the line that stands on
 * screen in place of the columns. Both name the query: a live region speaks only when its words
 * change, so a second search that found as many as the first would otherwise go unsaid.
 */
export function searchStatus(query: string, matches: number): string {
  const q = query.trim()
  if (q === '') return ''
  if (matches === 0) return `No application matches “${q}”.`
  return matches === 1 ? `1 application matches “${q}”.` : `${matches} applications match “${q}”.`
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

/** How long the typing has to rest before the board says how many records match. */
const SETTLE_MS = 600

/** The board's columns, shared by the search row so the field sits exactly on the first. */
const GRID = 'grid gap-x-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5'

export function PipelineBoard({ apps, onMove, onRemove }: Props) {
  const [query, setQuery] = useState('')
  // Which columns have been opened past their cap, or out of their fold.
  const [expanded, setExpanded] = useState<Partial<Record<AppStatus, boolean>>>({})
  const [spoken, setSpoken] = useState('')

  const columns = COLUMNS.map((column) => {
    const open = expanded[column.status] ?? false
    // Rejected alone starts folded; the top of the file says why.
    const view = columnView(
      apps.filter((a) => a.status === column.status),
      { query, cap: CAP, expanded: open, collapsed: column.status === 'rejected' },
    )
    return { ...column, open, view }
  })
  const found = columns.reduce((sum, { view }) => sum + view.shown.length + view.hidden, 0)
  const message = searchStatus(query, found)
  const nothingMatches = found === 0 && message !== ''

  // The line on screen keeps up with every key; what a screen reader is told waits for the typing
  // to rest. A sentence per keystroke would still be reading out the first when the fifth landed.
  useEffect(() => {
    const timer = window.setTimeout(() => setSpoken(message), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [message])

  return (
    <section aria-label="Pipeline" className="mt-8">
      <label htmlFor="board-search" className="sr-only">
        Find an application
      </label>
      {/* One column wide at every breakpoint, on the same grid as the columns below: any fixed
          width ends somewhere inside the second column at one screen size or another. */}
      <div className={GRID}>
        <input
          id="board-search"
          type="search"
          placeholder="Find an application"
          className="field field-boxed h-10 px-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape empties the field in every browser, not only the ones that do it natively —
            // except mid-composition, where an IME's Escape abandons the word, not the query.
            if (e.key === 'Escape' && !e.nativeEvent.isComposing && query !== '') setQuery('')
          }}
        />
      </div>

      {/* The board's one status region, drawn from the first paint and empty until there is a
          search to report: a region that arrives already carrying its message goes unannounced
          by several screen readers. The no-match line is shown at once and hidden from the
          accessibility tree; the copy beside it is the same sentence, set once the typing rests.
          Its margin rides on the line, so when there is nothing to show it takes no room. It may
          break inside a word: it repeats the query as typed, and a pasted posting link is one
          word wider than a phone. */}
      <p role="status">
        {nothingMatches && (
          <span aria-hidden="true" className="mt-6 block break-words text-[0.9375rem] text-ink-2">
            {message}
          </span>
        )}
        <span className="sr-only">{spoken}</span>
      </p>

      {!nothingMatches && (
        <div className={`${GRID} mt-6 gap-y-9`}>
          {columns.map(({ status, label, open, view }) => (
            <section key={status} aria-labelledby={`col-${status}`}>
              <div className="flex items-baseline justify-between gap-2 border-b border-line-strong pb-1.5">
                <h2
                  id={`col-${status}`}
                  className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-ink-2"
                >
                  {label}
                </h2>
                {/* The whole column — or while searching, its matches — never just the cards on
                    show, so a folded or capped column still says what it holds. */}
                <span className="tnum text-[0.6875rem] text-ink-3">
                  {view.shown.length + view.hidden}
                </span>
              </div>

              {/* Folded rather than removed: the button below points at this list by id. */}
              <ul
                id={`col-${status}-list`}
                hidden={view.shown.length === 0 && view.hidden > 0}
                className="mt-3 flex flex-col gap-2.5"
              >
                {view.shown.map((app) => (
                  <li key={app.id}>
                    <Card app={app} onMove={onMove} onRemove={onRemove} />
                  </li>
                ))}
              </ul>

              {/* Under the list, and one element whichever way it reads, so the focus stays on it
                  through a press while the cards come and go above. Named for its column, since
                  two can read the same, with the visible words first (WCAG 2.5.3). */}
              {view.toggle && (
                <button
                  type="button"
                  className="btn-link mt-2.5 min-h-6 text-[0.75rem]"
                  aria-expanded={open}
                  aria-controls={`col-${status}-list`}
                  aria-label={`${view.toggle}: ${label}`}
                  onClick={() => setExpanded((prev) => ({ ...prev, [status]: !prev[status] }))}
                >
                  {view.toggle}
                </button>
              )}
            </section>
          ))}
        </div>
      )}
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
