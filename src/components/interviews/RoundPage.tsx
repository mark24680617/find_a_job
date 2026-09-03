'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { BriefView } from '@/components/interviews/BriefView'
import { apiDownload, apiFetch } from '@/lib/apiFetch'
import { mapRoundToStage, nextStage, stagePosition } from '@/lib/processMap'
import { readable } from '@/lib/readable'
import { formatWhen, ROUND_LABEL } from '@/lib/rounds'
import type { Application, InterviewRound, ProcessMap } from '@/lib/types'

/**
 * One round, on its own page: what it is and when, where it sits on the reported loop, the
 * brief written for it, and the notice it came from. The application page's card links here;
 * the map's pinned rounds link here. This is where the mock interview will live.
 */

interface PlacementProps {
  round: InterviewRound
  rounds: InterviewRound[]
  map: ProcessMap | undefined
  appId: string
  /** The other rounds could not be read, so `rounds` is short rather than empty. */
  roundsFailed?: boolean
}

/** Where this round sits on the map — or why it does not. Exported for the static test. */
export function RoundPlacement({ round, rounds, map, appId, roundsFailed = false }: PlacementProps) {
  if (!map) {
    return (
      <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
        Nothing is known yet about how this company runs its loop.{' '}
        <Link href={`/applications/${appId}`} className="btn-link">
          Research the process
        </Link>{' '}
        on the application page to place this round.
      </p>
    )
  }
  // Placing a round means knowing which stages the rounds booked before it already took, so a
  // list that failed to arrive is not a short list — it is no answer at all. Saying "not on the
  // loop" here would report a failed request as a fact about the company.
  if (roundsFailed) {
    return (
      <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
        The other rounds couldn’t be loaded, so this one can’t be placed — reload to try again.
      </p>
    )
  }
  // The list is the other rounds; this one has to be in it to be found among them. It is
  // missing whenever the round was opened from a link rather than reached through the list.
  const known = rounds.some((r) => r.id === round.id) ? rounds : [...rounds, round]
  const stage = mapRoundToStage(round, known, map)
  if (!stage) {
    return (
      <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
        This round isn’t on the reported loop — ask the recruiter where it fits.
      </p>
    )
  }
  const next = nextStage(stage, map)
  return (
    <div className="max-w-[62ch]">
      <p className="text-[0.9375rem] text-ink">
        <span className="tnum font-medium text-accent">{stagePosition(stage, map)}</span> · {stage.name}
      </p>
      <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-2">{stage.whatItProbes}</p>
      {stage.tips.length > 0 && (
        <ul className="mt-2 grid gap-1 text-[0.9375rem] leading-relaxed text-ink-2">
          {stage.tips.map((t, i) => (
            <li key={`${t}-${i}`} className="flex gap-2">
              <span aria-hidden="true" className="text-ink-3">–</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-ink-3">{next ? `Next: ${next.name}` : 'This is the last reported stage.'}</p>
    </div>
  )
}

interface Props {
  appId: string
  rid: string
}

export function RoundPage({ appId, rid }: Props) {
  const [app, setApp] = useState<Application | null>(null)
  const [round, setRound] = useState<InterviewRound | null>(null)
  const [rounds, setRounds] = useState<InterviewRound[]>([])
  // The sibling rounds are the only optional read of the three, so its failure is carried
  // rather than swallowed: an empty list and an unread one say very different things about
  // where this round sits, and the placement has to be able to tell them apart.
  const [roundsFailed, setRoundsFailed] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([
      apiFetch<Application>(`/api/applications/${appId}`),
      apiFetch<InterviewRound>(`/api/applications/${appId}/interviews/${rid}`),
      apiFetch<InterviewRound[]>(`/api/applications/${appId}/interviews`).catch(() => null),
    ])
      .then(([a, r, rs]) => {
        if (!live) return
        setApp(a)
        setRound(r)
        setRounds(rs ?? [])
        setRoundsFailed(rs === null)
      })
      .catch((err: unknown) => live && setLoadError(readable(err instanceof Error ? err.message : '') || 'That round could not be loaded.'))
    return () => {
      live = false
    }
  }, [appId, rid])

  async function download() {
    if (!round) return
    setDownloading(true)
    setDownloadError('')
    try {
      await apiDownload(`/api/applications/${appId}/interviews/${round.id}/ics`, 'interview.ics')
    } catch (err) {
      setDownloadError(readable(err instanceof Error ? err.message : '') || 'That didn’t download. Try again.')
    } finally {
      setDownloading(false)
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p role="alert" className="text-[0.9375rem] text-danger">{loadError}</p>
        {/* The round would not load, so this page has nothing else on it. Somewhere to go is
            the least it owes the person; the application is where they came from. */}
        <p className="mt-3 text-sm">
          <Link href={`/applications/${appId}`} className="btn-link">
            ← Back to the application
          </Link>
        </p>
      </main>
    )
  }
  if (!app || !round) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16" aria-busy="true">
        <p className="text-sm text-ink-3">Opening the round…</p>
      </main>
    )
  }

  const when = formatWhen(round.datetime)
  const asks = round.askHuman ?? []

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-16">
      <p className="text-sm">
        <Link href={`/applications/${appId}`} className="btn-link">
          ← {app.company} · {app.role}
        </Link>
      </p>
      <header className="mt-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">{ROUND_LABEL[round.roundType]}</h1>
          <p className="mt-1 text-[1.0625rem] text-ink-2">
            {when ? <time dateTime={round.datetime} className="tnum">{when}</time> : 'Time not stated'}
            {round.people.length > 0 && <> · with {round.people.join(', ')}</>}
          </p>
        </div>
        {when && (
          <button type="button" className="btn btn-quiet" disabled={downloading} onClick={() => void download()}>
            {downloading ? 'Preparing…' : 'Add to calendar'}
          </button>
        )}
      </header>
      {downloadError && (
        <p role="alert" className="mt-2 text-sm text-danger">{downloadError}</p>
      )}

      <section aria-labelledby="placement-heading" className="mt-10">
        <h2 id="placement-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Where this sits</h2>
        <div className="mt-3">
          <RoundPlacement
            round={round}
            rounds={rounds}
            map={app.process}
            appId={appId}
            roundsFailed={roundsFailed}
          />
        </div>
      </section>

      {asks.length > 0 && (
        <section className="mt-10 grid gap-2">
          {asks.map((ask, i) => (
            <div key={`${ask.question}-${i}`} className="min-w-0 border border-amber bg-amber-soft px-4 py-3">
              <p className="max-w-[58ch] text-[0.9375rem] leading-snug font-medium text-ink">{ask.question}</p>
              {ask.why !== '' && <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-ink-2">{ask.why}</p>}
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="brief-heading" className="mt-10">
        <h2 id="brief-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">The brief</h2>
        {round.prepBrief ? (
          <BriefView brief={round.prepBrief} />
        ) : (
          <p className="mt-3 max-w-[62ch] text-sm text-ink-3">No brief was written for this round.</p>
        )}
      </section>

      <details className="faq mt-10 text-sm">
        <summary className="btn-link inline cursor-pointer">The notice as it arrived</summary>
        <pre className="mt-3 max-w-[72ch] whitespace-pre-wrap border border-line bg-surface px-4 py-3 font-sans text-[0.875rem] leading-relaxed text-ink-2">
          {round.noticeRaw}
        </pre>
      </details>
    </main>
  )
}
