'use client'

import { useState, type ReactNode } from 'react'
import { Working } from '@/components/Working'
import {
  ClarifyCards,
  seedCard,
  seedSelections,
  toClarifyAnswer,
  type CardState,
} from '@/components/review/ClarifyCards'
import type { Changeset, ClarifyAnswer, ClarifyQuestion, Fact } from '@/lib/types'

/**
 * What reading this document would change, before any of it is true.
 *
 * The profile used to take a resume and write what it found, in one motion. Upload the same
 * one twice and the bank said everything twice; there was no moment at which a person could
 * look at what was about to happen and disagree. This panel is that moment. Everything on it
 * is a proposal held in the browser: the server has been asked what it would do and has
 * written nothing, and only Accept turns any of it into a fact.
 *
 * Three ways out, and the panel is honest about all three:
 *   - **Accept** applies exactly the rows shown — the diff is the contract.
 *   - **Cancel** closes it. Nothing happened, because nothing had happened yet.
 *   - **Describe what's wrong** sends the candidate's own words back through the reconcile.
 *     It is the escape hatch for the case the model cannot be argued into by clicking:
 *     "those are two different migrations", "leave f4 alone". Their words take precedence.
 *
 * The skips are collapsed but never absent. A claim the model decided was already known is
 * the one kind of decision that would otherwise be invisible, and an invisible decision about
 * someone's own record is exactly what this screen exists to stop.
 */

interface Props {
  /** Increments once per reconcile answer, so a new round's cards seed from that round. */
  round: number
  /**
   * Which heading this panel's title is. The profile page mounts it at the top level of the
   * page; the round page mounts it under a section of its own, where an `h2` would break the
   * outline. The level follows the page, and nothing else about the panel changes.
   */
  headingLevel?: 'h2' | 'h3'
  changeset: Changeset
  questions: ClarifyQuestion[]
  /** The bank as it stands, so a revision can show the claim it is revising. */
  facts: Fact[]
  /** Which wait is running, or null. They read differently and say different things. */
  busy: 'reconciling' | 'saving' | null
  error: string
  onAccept: () => void
  onCancel: () => void
  onReconcile: (input: { answers: ClarifyAnswer[]; guidance?: string }) => void
}

const RECONCILING = [
  { at: 0, text: 'Comparing with what I know…' },
  { at: 5000, text: 'Working out what would change…' },
] as const

const SAVING = [{ at: 0, text: 'Adding these to your profile…' }] as const

export function ReconcilePanel({
  round,
  headingLevel = 'h2',
  changeset,
  questions,
  facts,
  busy,
  error,
  onAccept,
  onCancel,
  onReconcile,
}: Props) {
  const [selections, setSelections] = useState<Record<string, CardState>>(() =>
    seedSelections(questions, []),
  )
  const [guidance, setGuidance] = useState('')
  const [guidanceOpen, setGuidanceOpen] = useState(false)
  const [skipsOpen, setSkipsOpen] = useState(false)

  // A new round is a new set of cards and a new changeset, so the selections seed again and the
  // words the candidate wrote about the LAST changeset are cleared — they have been answered by
  // the one now on screen, and leaving them in the box would send them a second time. Adjusting
  // state during render is React's supported way to reset it from a changing input, and it
  // lands before the paint rather than after a frame of the wrong cards.
  const [prevRound, setPrevRound] = useState(round)
  if (prevRound !== round) {
    setPrevRound(round)
    setSelections(seedSelections(questions, []))
    setGuidance('')
    setGuidanceOpen(false)
  }

  // A capitalised local, because JSX reads a lowercase name as an intrinsic tag and this one is
  // a variable. The level is the caller's: the profile page puts this under its h1, the round
  // page under one of its h2s. (Its `tabIndex` is explained where the heading is rendered.)
  const Heading = headingLevel

  const byId = new Map(facts.map((f) => [f.id, f]))
  const applies = changeset.adds.length + changeset.updates.length
  const answers = () => questions.map((q) => toClarifyAnswer(q, selections[q.id] ?? seedCard(q)))

  return (
    <section aria-labelledby="reconcile-heading" className="mt-8 border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        {/* Focusable because opening the panel moves focus here: it can arrive far below the
            control that asked for it, and the title is the first thing a reader needs. */}
        <Heading
          id="reconcile-heading"
          tabIndex={-1}
          className="font-display text-lg tracking-tight text-ink"
        >
          What this would change
        </Heading>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
          Nothing is saved yet. {summarize(changeset)}
        </p>
      </div>

      {/* `disabled` cascades to every control inside, so a click landing mid-request cannot
          answer a round that is already being replaced. `min-w-0` undoes the fieldset's
          default `min-inline-size: min-content`. */}
      <fieldset disabled={busy !== null} className="min-w-0">
        {questions.length > 0 && (
          <div className="border-b border-line px-5 py-4">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
              Before I change anything
            </h3>
            <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-ink-2">
              Two of these could be the same thing or two different things, and{' '}
              <span className="font-medium text-amber">only you know which</span>. The
              recommended pick is what I would do if you never answered.
            </p>
            <div className="mt-4">
              <ClarifyCards
                questions={questions}
                selections={selections}
                onChange={(id, next) => setSelections((s) => ({ ...s, [id]: next }))}
                busy={busy !== null}
              />
            </div>
          </div>
        )}

        {applies > 0 ? (
          <ul className="border-b border-line">
            {changeset.adds.map((add, i) => (
              <Row key={`add-${i}`} mark="+" what="New fact" claim={add.claim}>
                {add.sourceSnippet.trim() !== '' && (
                  <blockquote className="mt-1.5 border-l-2 border-line pl-3 font-display text-sm leading-relaxed text-ink-2">
                    {add.sourceSnippet}
                  </blockquote>
                )}
              </Row>
            ))}
            {changeset.updates.map((update) => {
              const before = byId.get(update.id)?.claim
              return (
                <Row key={`up-${update.id}`} mark="~" what="Revised" claim={update.claim} id={update.id}>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-3">
                    {before === undefined ? (
                      'That fact is no longer in your profile.'
                    ) : before.trim() === update.claim.trim() ? (
                      // A revision that only re-files the fact. Showing "was X → now X" would
                      // read as a change that is not one; what changed is which shelf it is on.
                      'Same wording — this only changes how it is filed.'
                    ) : (
                      <>
                        <span className="sr-only">Replacing: </span>
                        {before}
                      </>
                    )}
                  </p>
                </Row>
              )
            })}
          </ul>
        ) : (
          <p className="border-b border-line px-5 py-4 text-[0.9375rem] text-ink-2">
            Nothing here is new to your profile.
          </p>
        )}

        {changeset.skips.length > 0 && (
          <div className="border-b border-line px-5 py-3">
            <button
              type="button"
              aria-expanded={skipsOpen}
              aria-controls="reconcile-skips"
              className="btn-link text-sm"
              onClick={() => setSkipsOpen(!skipsOpen)}
            >
              {skipsOpen ? 'Hide' : 'Show'} what it skipped
              <span className="tnum ml-1.5 text-ink-3">— {changeset.skips.length} already known</span>
            </button>
            {skipsOpen && (
              <ul id="reconcile-skips" className="mt-3 border-t border-line">
                {changeset.skips.map((skip, i) => (
                  <li key={`skip-${i}`} className="flex min-w-0 items-start gap-3 border-b border-line py-2.5">
                    <span className="tnum w-9 shrink-0 pt-px text-sm text-ink-3">
                      {skip.id ?? '—'}
                    </span>
                    <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-ink-2">
                      {skip.reason}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {guidanceOpen && (
          <div className="border-b border-line px-5 py-4">
            <label htmlFor="reconcile-guidance" className="text-sm font-medium text-ink-2">
              What did it get wrong?
            </label>
            <textarea
              id="reconcile-guidance"
              rows={3}
              className="field field-boxed mt-2.5 px-3 py-2 text-[0.9375rem] leading-relaxed"
              placeholder="Those are two different migrations — leave f4 alone."
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
            />
            <p className="mt-2 max-w-[64ch] text-sm text-ink-3">
              Your words, not a form. They take precedence over what it worked out on its own.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          {guidanceOpen ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={guidance.trim() === ''}
              onClick={() => onReconcile({ answers: answers(), guidance: guidance.trim() })}
            >
              Try again with that
            </button>
          ) : questions.length > 0 ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onReconcile({ answers: answers() })}
              >
                Use my answers
              </button>
              <button type="button" className="btn btn-quiet" disabled={applies === 0} onClick={onAccept}>
                Accept as it stands
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" disabled={applies === 0} onClick={onAccept}>
              Accept
            </button>
          )}

          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          {!guidanceOpen && (
            <button type="button" className="btn-link text-sm" onClick={() => setGuidanceOpen(true)}>
              Describe what’s wrong
            </button>
          )}

          <Working
            busy={busy !== null}
            className="min-w-0 flex-1 basis-full sm:basis-auto"
            stages={busy === 'saving' ? SAVING : RECONCILING}
            note="Usually takes 10–20 seconds."
          >
            <p className="max-w-[52ch] text-sm text-ink-3">
              {error ? (
                <span className="text-danger">{error}</span>
              ) : (
                'Cancel changes nothing — none of this is saved.'
              )}
            </p>
          </Working>
        </div>
      </fieldset>
    </section>
  )
}

/** One diff row: its marker, the claim it is proposing, and whatever stands behind it. */
function Row({
  mark,
  what,
  claim,
  id,
  children,
}: {
  mark: string
  what: string
  claim: string
  id?: string
  children?: ReactNode
}) {
  return (
    <li className="flex min-w-0 items-start gap-3 border-b border-line px-5 py-3 last:border-b-0">
      <span className="chip mt-px shrink-0" aria-hidden="true">
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <p className="min-w-0 break-words text-[0.9375rem] leading-relaxed text-ink">
          <span className="sr-only">{what}: </span>
          {id && <span className="tnum mr-2 text-sm font-medium text-accent">{id}</span>}
          {claim}
        </p>
        {children}
      </div>
    </li>
  )
}

/** The counts, in words. Written once here so the header and nothing else has to say it. */
function summarize(changeset: Changeset): string {
  const parts = [
    count(changeset.adds.length, 'new fact', 'new facts'),
    count(changeset.updates.length, 'revised', 'revised'),
    count(changeset.skips.length, 'already known', 'already known'),
  ].filter((p) => p !== null)
  if (parts.length === 0) return 'There is nothing here your profile does not already hold.'
  return `${parts.join(', ')}.`
}

const count = (n: number, one: string, many: string): string | null =>
  n === 0 ? null : `${n} ${n === 1 ? one : many}`
