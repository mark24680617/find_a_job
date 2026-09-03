'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { AskRecruiter } from '@/components/process/AskRecruiter'
import { GuideList } from '@/components/process/GuideList'
import { SourceList } from '@/components/process/SourceList'
import { StageLedger } from '@/components/process/StageLedger'
import { apiFetch } from '@/lib/apiFetch'
import { dateOnly } from '@/lib/dates'
import { readable } from '@/lib/readable'
import type { Application, InterviewRound, ProcessMap } from '@/lib/types'

/**
 * What to expect: how this company runs its loop, drawn on demand from what its posting and
 * the people who went through it say. Three states — not yet researched, researching, and the
 * map — and one rule: nothing on it is unattributed.
 *
 * The logged rounds come in as a prop rather than being read here. The page owns that list
 * because the interviews section below draws the same rounds as cards: held separately, one
 * copy would move when a round was logged and the other would go on showing the loop unpinned.
 */

const STAGES = [
  { at: 0, text: 'Reading the posting…' },
  { at: 4000, text: 'Searching for how they interview…' },
  { at: 20000, text: 'Reading what people who went through it wrote…' },
  { at: 45000, text: 'Drawing the loop…' },
]
const NOTE = 'Usually takes 30–90 seconds.'

interface Props {
  app: Application
  /** The rounds logged against this application, owned by the page. Pinned onto the ledger. */
  rounds: InterviewRound[]
  onResearched: (map: ProcessMap) => void
}

export function ProcessSection({ app, rounds, onResearched }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const map = app.process

  async function research() {
    setBusy(true)
    setError('')
    try {
      const next = await apiFetch<ProcessMap>(`/api/applications/${app.id}/process`, { method: 'POST' })
      onResearched(next)
    } catch (err) {
      setError(readable(err instanceof Error ? err.message : '') || 'The research didn’t finish. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="process-heading" className="mt-8">
      <h2 id="process-heading" className="font-display text-lg tracking-tight text-ink">
        What to expect
      </h2>

      {!map && !busy && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="max-w-[58ch] text-sm leading-relaxed text-ink-2">
            How this company runs its interviews, from its own posting and from people who have been
            through it.
          </p>
          <button type="button" className="btn btn-quiet" onClick={() => void research()}>
            Research the process
          </button>
          <p className="text-sm text-ink-3">
            Takes about a minute. It reads the posting, searches the web, and reads the best few
            write-ups.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/*
        The wait sits above the map rather than in place of it. `Working` swaps its children
        out while busy and wraps whatever it holds in a live region, so a map handed to it as
        `children` would both blank the ninety seconds of reading somebody was part-way
        through and, when the run landed, announce all seven stages and every quote under
        them. The region carries the three status lines and nothing else; the old map stays
        where it is, still true until the new one replaces it.
      */}
      <Working busy={busy} className="mt-3 empty:mt-0" stages={STAGES} note={NOTE} />

      {map && (
        <div className="mt-3 grid gap-10">
          <div className="text-sm text-ink-3">
            {!map.grounded && (
              <p className="mb-1 max-w-[62ch] text-ink-2">
                The web could not be reached — this is drawn from the posting and what is usual for
                the role.
              </p>
            )}
            <p>
              Researched {dateOnly(map.researchedAt)} from {map.sources.length}{' '}
              {map.sources.length === 1 ? 'source' : 'sources'}
              {map.timeline && <> · {map.timeline}</>}
              {' · '}
              <button type="button" className="btn-link" onClick={() => void research()}>
                Research again
              </button>
            </p>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">The loop</h3>
            <div className="mt-3">
              <StageLedger map={map} rounds={rounds} appId={app.id} />
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Take-home assignment</h3>
            {map.takeHome.present === 'unknown' && (
              <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
                Nobody says whether there is one — ask.
              </p>
            )}
            {/*
              A "no" is shown, quietly, with whatever says so under it. Hidden — which is what
              this block used to do — it is the one verdict on the page a reader cannot check:
              they see no take-home section and cannot tell a well-sourced "no" from a wrong one.
            */}
            {map.takeHome.present === 'no' && (
              <div className="mt-2 max-w-[62ch]">
                <p className="text-[0.9375rem] leading-relaxed text-ink-2">
                  {map.takeHome.description || 'No take-home reported.'}
                </p>
                <div className="mt-2">
                  <SourceList sources={map.sources.filter((s) => map.takeHome.sourceIds.includes(s.id))} />
                </div>
              </div>
            )}
            {map.takeHome.present === 'yes' && (
              <div className="mt-2 max-w-[62ch]">
                <p className="text-[0.9375rem] leading-relaxed text-ink">{map.takeHome.description}</p>
                {map.takeHome.timeBudget && <p className="mt-1 text-sm text-ink-3">Time budget: {map.takeHome.timeBudget}</p>}
                {map.takeHome.tips.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-[0.9375rem] leading-relaxed text-ink-2">
                    {map.takeHome.tips.map((t, i) => (
                      <li key={`${t}-${i}`} className="flex gap-2">
                        <span aria-hidden="true" className="text-ink-3">–</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2">
                  <SourceList sources={map.sources.filter((s) => map.takeHome.sourceIds.includes(s.id))} />
                </div>
              </div>
            )}
          </div>

          {map.guides.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                What people who went through it say
              </h3>
              <div className="mt-3">
                <GuideList map={map} />
              </div>
            </div>
          )}

          <AskRecruiter items={map.askRecruiter} />

          <div className="text-sm text-ink-3">
            {map.caveats.length > 0 && (
              <ul className="grid max-w-[62ch] gap-1">
                {map.caveats.map((c, i) => (
                  <li key={`${c}-${i}`}>{c}</li>
                ))}
              </ul>
            )}
            <details className="faq mt-3">
              <summary className="btn-link inline cursor-pointer">All {map.sources.length} sources</summary>
              <div className="mt-2">
                <SourceList sources={map.sources} />
              </div>
            </details>
          </div>
        </div>
      )}
    </section>
  )
}
