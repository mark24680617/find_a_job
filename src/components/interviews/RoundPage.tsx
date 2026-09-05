'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Working } from '@/components/Working'
import { BriefView } from '@/components/interviews/BriefView'
import { MockSection } from '@/components/interviews/MockSection'
import { ApiError, apiDownload, apiFetch } from '@/lib/apiFetch'
import { placeRound } from '@/lib/practice'
import { mapRoundToStage, nextStage, stagePosition } from '@/lib/processMap'
import { readable } from '@/lib/readable'
import { roleFamily } from '@/lib/research/roleFamily'
import { formatWhen, ROUND_LABEL } from '@/lib/rounds'
import type { Application, Fact, InterviewRound, ProcessMap, Profile } from '@/lib/types'

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

/*
 * Writing the brief takes as long as any other reading the product does, so it says what it is
 * doing while it happens — and, like the research above it, the wait sits above the record
 * rather than in place of it. The brief on screen was true a moment ago and stays on screen
 * until a better one replaces it.
 */
const BRIEF_STAGES = [
  { at: 0, text: 'Reading the stage and what people were asked…' },
  { at: 5000, text: 'Choosing which of your facts answer what…' },
]
const BRIEF_NOTE = 'Usually takes 10–20 seconds.'

interface BriefSectionProps {
  appId: string
  round: InterviewRound
  map: ProcessMap | undefined
  /** The route answers with the round as stored; the page replaces its copy with that one. */
  onRound: (round: InterviewRound) => void
}

/**
 * The brief, and the one button that writes it again.
 *
 * A round logged before the research has a brief that never saw the map — it knows the round
 * type and the posting and nothing about how this company actually interviews. That is worth
 * saying out loud rather than leaving somebody to wonder, so a brief older than the map carries
 * a line saying so, and the button beside it offers exactly what rewriting would add: the
 * research, when there is research to add, and a plain rewrite when there is not.
 *
 * Rewriting replaces the brief whole, which is the sort of thing a person should be told before
 * they click rather than after. A failure changes nothing: the route keeps the stored brief, and
 * so does this — the error line appears above a brief that is still the one it was. The 422 that
 * says so is read off the body (`briefFailed`), not off the message, and gets our sentence,
 * because "the one you have is still here" is a fact about the record only we can vouch for.
 *
 * Exported for the static test.
 */
export function BriefSection({ appId, round, map, onRound }: BriefSectionProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const brief = round.prepBrief
  const label = !brief
    ? 'Write the brief'
    : map
      ? 'Rewrite the brief with the research'
      : 'Rewrite the brief'
  // Both timestamps are ISO in UTC, so string order is time order. A brief with no basis at all
  // was written before the map existed — that is what its absence records. A round with no brief
  // has nothing that could predate anything, and saying so over an empty section would be a
  // claim about a document nobody wrote.
  const predatesResearch =
    brief !== undefined &&
    map !== undefined &&
    (!brief.basis || brief.basis.researchedAt < map.researchedAt)

  async function write() {
    setBusy(true)
    setError('')
    try {
      const next = await apiFetch<InterviewRound>(
        `/api/applications/${appId}/interviews/${round.id}/brief`,
        { method: 'POST' },
      )
      onRound(next)
    } catch (err) {
      // The route's one deliberate refusal, recognised by the body and never by the message:
      // the wording is the server's to change, and the flow's own message is a schema complaint
      // written for us rather than a sentence for a person. What somebody needs to know here is
      // that the brief under this line is still theirs, and only we can say that. Every other
      // failure keeps the server's sentence, which is written for them.
      const briefFailed =
        err instanceof ApiError &&
        err.status === 422 &&
        (err.body as { briefFailed?: boolean } | null)?.briefFailed === true
      setError(
        briefFailed
          ? 'The brief couldn’t be written — the one you have is still here. Try again.'
          : readable(err instanceof Error ? err.message : '') ||
            'The brief couldn’t be written. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="brief-heading" className="mt-10">
      <h2 id="brief-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
        The brief
      </h2>

      {predatesResearch && (
        <p className="mt-3 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
          Written before the research.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <button type="button" className="btn-link" disabled={busy} onClick={() => void write()}>
          {label}
        </button>
        {brief && <span className="text-ink-3">Replaces the brief you have now.</span>}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Mounted whether or not anything is happening — a status region that arrives already
          carrying its message is not announced. Empty at rest, so it costs no space. */}
      <Working busy={busy} className="mt-3 empty:mt-0" stages={BRIEF_STAGES} note={BRIEF_NOTE} />

      {brief ? (
        <BriefView brief={brief} sources={map?.sources} />
      ) : (
        <p className="mt-3 max-w-[62ch] text-sm text-ink-3">No brief was written for this round.</p>
      )}
    </section>
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
  // The fact bank, read best-effort beside the rest, and its failure carried rather than
  // swallowed for the same reason the rounds' is: the mock's debrief checks what was said
  // against these facts, and a bank that failed to arrive looks exactly like an empty one.
  // Telling somebody a fact they still hold is missing would be the worst thing this page does.
  const [facts, setFacts] = useState<Fact[]>([])
  const [profileFailed, setProfileFailed] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([
      apiFetch<Application>(`/api/applications/${appId}`),
      apiFetch<InterviewRound>(`/api/applications/${appId}/interviews/${rid}`),
      apiFetch<InterviewRound[]>(`/api/applications/${appId}/interviews`).catch(() => null),
      apiFetch<Profile>('/api/profile').catch(() => null),
    ])
      .then(([a, r, rs, profile]) => {
        if (!live) return
        setApp(a)
        setRound(r)
        setRounds(rs ?? [])
        setRoundsFailed(rs === null)
        setFacts(profile?.facts ?? [])
        setProfileFailed(profile === null)
      })
      .catch((err: unknown) => live && setLoadError(readable(err instanceof Error ? err.message : '') || 'That round could not be loaded.'))
    return () => {
      live = false
    }
  }, [appId, rid])

  /**
   * Read the fact bank again, after a sentence from the debrief has been added to it. The next
   * claim is then reconciled against the bank as it now stands rather than as it was when this
   * page opened, so a second claim that repeats the first is seen as the duplicate it is.
   *
   * A failed re-read keeps the facts already in hand and raises the flag: the debrief stops
   * offering to add anything until a reload. Comparing against a bank we could not read would
   * tell somebody a fact they still hold has gone.
   */
  async function reloadProfile() {
    try {
      const profile = await apiFetch<Profile>('/api/profile')
      setFacts(profile.facts)
      setProfileFailed(false)
    } catch {
      setProfileFailed(true)
    }
  }

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
  // The same two guards the placement paragraph above applies, for the same reasons: this round
  // has to be in the list to be found among the others, and a list that failed to arrive is no
  // answer at all rather than a short one. Placement only decides the resting copy and the mode
  // before a session exists — the route works the stage out again, from its own list, at `start`
  // — but a mock offered for the wrong stage is still a wrong thing to say.
  const known = rounds.some((r) => r.id === round.id) ? rounds : [...rounds, round]
  const placement = app.process && !roundsFailed ? placeRound(round, known, app.process) : null

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

      <BriefSection appId={appId} round={round} map={app.process} onRound={setRound} />

      <section aria-labelledby="practice-heading" className="mt-10">
        <h2 id="practice-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Practice</h2>
        <div className="mt-3">
          <MockSection
            appId={appId}
            round={round}
            placement={placement}
            family={roleFamily(app.role)}
            sources={app.process?.sources ?? []}
            facts={facts}
            profileFailed={profileFailed}
            company={app.company}
            onRound={setRound}
            onFactsChanged={reloadProfile}
          />
        </div>
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
