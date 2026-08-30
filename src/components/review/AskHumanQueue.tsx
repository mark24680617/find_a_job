'use client'

import { useState } from 'react'
import type { AskHuman } from '@/lib/types'

/**
 * What the agent could not answer from the profile, and will not guess. Each card is one thing
 * only the candidate knows — amber, because amber means exactly that everywhere in this product.
 * The human answers inline and re-drafts; the answers are sent back with the draft request and
 * survive it, so answering the agent is never wasted work.
 *
 * Answered asks stay in the queue with their answer filled in, editable: the model sometimes
 * repeats a question, and a person may want to reword what they told it. The re-draft carries
 * every non-empty answer, so a stored answer is never dropped by re-drafting.
 *
 * The parent remounts this (keyed on the draft) whenever a new draft lands, so the inputs
 * re-seed from the freshly stored answers rather than clinging to what was typed against an
 * older draft.
 */

interface Props {
  asks: AskHuman[]
  busy: boolean
  onSubmit: (answers: { question: string; answer: string }[]) => void
}

export function AskHumanQueue({ asks, busy, onSubmit }: Props) {
  const [answers, setAnswers] = useState<string[]>(() => asks.map((a) => a.answer ?? ''))

  const canSubmit = !busy && answers.some((a) => a.trim() !== '')

  function submit() {
    const filled = asks
      .map((ask, i) => ({ question: ask.question, answer: answers[i]?.trim() ?? '' }))
      .filter((a) => a.answer !== '')
    if (filled.length > 0) onSubmit(filled)
  }

  return (
    <section aria-labelledby="ask-human-heading" className="mt-10">
      <h3
        id="ask-human-heading"
        className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
      >
        The agent needs you
      </h3>
      <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        It won’t guess these. Answer what you can, then draft again — the rest of the answer is
        written around what you tell it here.
      </p>

      <fieldset disabled={busy} aria-busy={busy} className="mt-4 grid min-w-0 gap-4">
        {asks.map((ask, i) => {
          const answered = (answers[i] ?? '').trim() !== ''
          const inputId = `ask-${i}`
          return (
            <div key={`${ask.question}-${i}`} className="border border-amber bg-amber-soft px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <label htmlFor={inputId} className="max-w-[58ch] text-[0.9375rem] font-medium leading-snug text-ink">
                  {ask.question}
                </label>
                {answered && (
                  <span className="shrink-0 text-xs font-medium text-accent">answered</span>
                )}
              </div>
              {ask.why !== '' && (
                <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-ink-2">
                  Why it’s asking: {ask.why}
                </p>
              )}
              <textarea
                id={inputId}
                rows={2}
                className="field field-boxed mt-3 px-3 py-2 text-[0.9375rem] leading-relaxed"
                placeholder="Only you know this — tell it here."
                value={answers[i] ?? ''}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                }
              />
            </div>
          )
        })}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            {busy ? 'Re-drafting…' : 'Answer & re-draft'}
          </button>
          <p className="text-sm text-ink-3">
            Your answers are kept and folded into the next draft.
          </p>
        </div>
      </fieldset>
    </section>
  )
}
