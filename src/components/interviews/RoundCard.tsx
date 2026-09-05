'use client'

import Link from 'next/link'
import { useState } from 'react'
import { BriefView } from '@/components/interviews/BriefView'
import { apiDownload } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import { formatWhen, ROUND_LABEL } from '@/lib/rounds'
import type { InterviewRound, ResearchSource } from '@/lib/types'

/**
 * One logged round: what kind it is, when, who is on it — and the brief written for it.
 *
 * A round whose notice never stated a time says so rather than showing a blank: "time not
 * stated" is a fact about the notice, and the agent is not allowed to guess one. That is also
 * why the calendar export disappears there — there is nothing to put in a calendar, and a
 * button that can only fail is worse than no button.
 *
 * What the notice did not say is shown amber, display-only. Answering those is roadmap; today
 * they are here because knowing what you still have to find out is most of the preparation.
 */

interface Props {
  appId: string
  round: InterviewRound
  /** True only for a round logged just now whose brief the model could not write. */
  briefFailed?: boolean
  /** The map's sources, so a brief's cited question can name the guide that reported it. */
  sources?: ResearchSource[]
}

export function RoundCard({ appId, round, briefFailed = false, sources }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const when = formatWhen(round.datetime)
  const asks = round.askHuman ?? []

  async function download() {
    setBusy(true)
    setError('')
    try {
      await apiDownload(`/api/applications/${appId}/interviews/${round.id}/ics`, 'interview.ics')
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') || 'That didn’t download. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="min-w-0 border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {/*
          The card is the summary; the page is the round. A chip is a label everywhere else in
          the product, so this one has to answer the pointer to read as the way in — quiet at
          rest, pine on touch. And two rounds of the same kind produce two chips reading
          "Technical", so the name carries the time as well; a screen reader hears which one.
        */}
        <Link
          href={`/applications/${appId}/interviews/${round.id}`}
          aria-label={`Open ${ROUND_LABEL[round.roundType]} round${when ? `, ${when}` : ''}`}
          className="chip shrink-0 uppercase tracking-[0.12em] transition-colors hover:border-accent hover:text-accent"
        >
          {ROUND_LABEL[round.roundType]}
        </Link>
        {when ? (
          <time dateTime={round.datetime} className="tnum text-[0.9375rem] text-ink">
            {when}
          </time>
        ) : (
          <span className="text-[0.9375rem] text-ink-3">Time not stated</span>
        )}
        {when && (
          <button
            type="button"
            // Several of these can be on screen at once, so the name carries the round — and
            // it opens with the visible words, so "add to calendar" spoken at the screen still
            // matches what is written on it (WCAG 2.5.3).
            aria-label={`Add to calendar: ${ROUND_LABEL[round.roundType]}`}
            className="btn-link ml-auto shrink-0 text-[0.8125rem]"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy ? 'Preparing…' : 'Add to calendar'}
          </button>
        )}
      </div>

      {round.people.length > 0 && (
        <p className="mt-1.5 max-w-[62ch] text-sm text-ink-2">With {round.people.join(', ')}</p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {asks.length > 0 && (
        <div className="mt-4 grid gap-2">
          {asks.map((ask, i) => (
            <div
              key={`${ask.question}-${i}`}
              className="min-w-0 border border-amber bg-amber-soft px-4 py-3"
            >
              <p className="max-w-[58ch] text-[0.9375rem] leading-snug font-medium text-ink">
                {ask.question}
              </p>
              {ask.why !== '' && (
                <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-ink-2">{ask.why}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {round.prepBrief ? (
        <BriefView brief={round.prepBrief} sources={sources} />
      ) : (
        briefFailed && (
          <p className="mt-4 max-w-[62ch] text-sm text-ink-3">
            The brief couldn’t be written — the round is saved. Try logging it again later.
          </p>
        )
      )}
    </article>
  )
}
