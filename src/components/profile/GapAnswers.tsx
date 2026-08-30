'use client'

import { useState } from 'react'

/**
 * The gaps the ingest flagged — what an application may ask for that the facts don't yet cover —
 * each with a box to answer it. These are amber territory: only the candidate knows them, so the
 * agent never guesses; it either has the answer as a fact or it asks.
 *
 * Answering is local, like every other edit on this page. `onAnswer` hands the answer up; the page
 * turns it into a fact (source: the question, tagged `from-you`) and drops the gap from the list.
 * The dirty state and the Save bar persist it. An answer left blank is never submitted, so the gap
 * simply stays — which is the whole section's posture, and why the heading wears "Optional" rather
 * than spending a sentence saying so.
 *
 * The gap's *text* identifies it, not its position: the page filters this list before rendering it
 * (the eight standard answers ask their own questions), so an index here would not be an index
 * into what is stored.
 */

interface Props {
  gaps: string[]
  onAnswer: (gap: string, answer: string) => void
}

export function GapAnswers({ gaps, onAnswer }: Props) {
  // Drafts are keyed by the gap's text, not its index: answering removes a gap and shifts every
  // index below it, and an index-keyed draft would then attach to the wrong row.
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  if (gaps.length === 0) return null

  const answer = (gap: string) => {
    const draft = drafts[gap]?.trim()
    if (!draft) return
    onAnswer(gap, draft)
    setDrafts((d) => {
      const next = { ...d }
      delete next[gap]
      return next
    })
  }

  return (
    <section aria-labelledby="gaps-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="gaps-heading" className="font-display text-xl tracking-tight text-ink">
          What an application may ask
          <span className="chip ml-3 align-middle font-sans">Optional</span>
        </h2>
        <p className="tnum text-sm text-ink-3">{gaps.length} open</p>
      </div>

      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        Things these facts don’t cover yet.{' '}
        <span className="font-medium text-amber">Only you know these</span> — answer one and it is
        saved as a fact.
      </p>

      <ul className="mt-5 border-t border-line-strong">
        {gaps.map((gap, index) => {
          const draft = drafts[gap] ?? ''
          const inputId = `gap-answer-${index}`
          return (
            <li key={`${gap}-${index}`} className="border-b border-line py-4">
              <p className="max-w-[76ch] text-[0.9375rem] leading-relaxed text-ink">{gap}</p>
              <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor={inputId} className="sr-only">
                    Your answer to: {gap}
                  </label>
                  <textarea
                    id={inputId}
                    rows={2}
                    className="field field-boxed px-3 py-2 text-[0.9375rem] leading-relaxed"
                    placeholder="Your answer — only you know this"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [gap]: e.target.value }))}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary shrink-0"
                  disabled={draft.trim() === ''}
                  onClick={() => answer(gap)}
                >
                  Answer
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
