'use client'

import { useEffect, useRef, useState } from 'react'
import { Working } from '@/components/Working'
import { ReconcilePanel } from '@/components/profile/ReconcilePanel'
import { apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { Changeset, ClarifyAnswer, ClarifyQuestion, Fact } from '@/lib/types'

/**
 * One sentence the candidate said in a mock, on its way into the fact bank.
 *
 * The debrief marks a sentence unsupported because the bank holds nothing that backs it — not
 * because it is untrue. Only they can settle that, and when they do the claim has to go through
 * the same gate every other fact goes through: the reconcile reads it against the bank, says
 * what it would change, and writes nothing until they accept. So this is the profile page's
 * round trip, one claim wide — the extraction is built here from their own sentence rather than
 * read out of a document, and it travels back with every second opinion so the claim is never
 * re-read.
 *
 * It renders the panel and nothing of its own once the first answer lands. The wait before that
 * is the only thing this adds: the panel cannot exist until the server has said what it would
 * change, and ten seconds of a blank space below the item is a screen that looks broken.
 */

/**
 * The two ends of the round trip focus makes around this panel, as ids rather than elements.
 *
 * Opening takes focus to the panel's heading, which arrives a long way below the link that asked
 * for it — or, when the read failed and no panel arrived, to the resting copy's own heading,
 * which sits in the same place and carries the reason. Both waits end below the fold, and a
 * keyboard left on the add link would have to pass every remaining item to reach either.
 * Closing takes focus back to that link — or, once the claim has landed and the link is gone, to
 * the item itself. All of this is pure and exported because the suite has no DOM: this is the
 * part that can be checked, and the `.focus()` calls that read it are checked by hand. They live
 * here rather than in `Debrief` so the imports stay one-way — `Debrief` already imports this
 * file, and the reverse would have the two importing each other.
 */
export function focusTargetOnOpen(arrived: boolean): string {
  return arrived ? 'reconcile-heading' : 'claim-heading'
}

/** `key` is the item's position key, `${answerIndex}-${itemIndex}`; `added` means the link is gone. */
export function focusTargetOnClose(key: string, added: boolean): string {
  return added ? `mock-claim-${key}` : `mock-add-${key}`
}

/**
 * Whether the reconcile settled this claim by deciding the bank already holds it. Every row a
 * skip, and at least one row: nothing to apply, and a reason for there being nothing.
 *
 * The skip is what makes it a decision. A changeset with no adds, no updates AND no skips is a
 * reconcile that settled nothing — it is asking clarifying questions instead, and the panel is
 * showing them. Offering to mark that claim covered would mark the item added about a sentence
 * no fact covers and nothing said covered. Pure and exported for the reason the focus targets
 * are: the panel it decides for only exists after a request, and this is the part that can be
 * checked.
 */
export function alreadyCovered(changeset: Changeset): boolean {
  return changeset.adds.length === 0 && changeset.updates.length === 0 && changeset.skips.length > 0
}

/** What `POST /api/profile/reconcile` answers with — the profile page's `Review`, one claim wide. */
interface Review {
  extraction: unknown
  changeset: Changeset
  questions: ClarifyQuestion[]
}

interface Props {
  /** The sentence, exactly as they wrote it in the mock. It becomes the claim. */
  said: string
  /** Where they said it, for the fact's evidence line. Built by the debrief, which knows. */
  snippet: string
  /** The bank as the page last read it, so a revision can show the claim it is revising. */
  facts: Fact[]
  /** Called once `/api/profile/apply` has succeeded. The caller records it and closes this. */
  onApplied: () => Promise<void>
  onClose: () => void
}

const RECONCILING = [
  { at: 0, text: 'Comparing with what I know…' },
  { at: 5000, text: 'Working out what would change…' },
] as const

/** The reconcile, both times: the first read of the claim and every second opinion on it. */
const postReconcile = (body: unknown) =>
  apiFetch<Review>('/api/profile/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export function ClaimToFact({ said, snippet, facts, onApplied, onClose }: Props) {
  const [review, setReview] = useState<Review | null>(null)
  const [round, setRound] = useState(0)
  // Mounted straight into the wait: this opens on a click and reads the claim immediately,
  // so there is no resting moment before it. The resting copy below is what a failure lands in.
  const [busy, setBusy] = useState<'reconciling' | 'saving' | null>('reconciling')
  const [error, setError] = useState('')
  /** Bumped by **Try again**, which is the same first read a second time. */
  const [attempt, setAttempt] = useState(0)
  const focused = useRef(false)

  // The claim is read once, when this opens — and again on each **Try again**. `f1` is an id
  // local to this one extraction: the reconcile matches on claims, not on ids, and nothing here
  // is written under that name.
  useEffect(() => {
    let live = true
    postReconcile({
      extraction: {
        facts: [{ id: 'f1', claim: said, sourceSnippet: snippet, tags: [] }],
        standardAnswers: {},
        gaps: [],
      },
    })
      .then((next) => {
        if (!live) return
        setReview(next)
        setRound((n) => n + 1)
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(
          readable(err instanceof Error ? err.message : '') ||
            'Reading that failed, and nothing was changed. Try again.',
        )
      })
      .finally(() => {
        if (live) setBusy(null)
      })
    return () => {
      live = false
    }
  }, [said, snippet, attempt])

  /** The first read again, after it failed. Nothing was written, so this is the same request. */
  function readAgain() {
    setError('')
    setBusy('reconciling')
    // The panel that lands is as far below the link as the first one would have been, so it
    // takes focus the way an arrival does. A second failure lands focus back on this heading,
    // one line above the button that was pressed — better than the button being taken away
    // under the keyboard when the read finally succeeds.
    focused.current = false
    setAttempt((n) => n + 1)
  }

  // Both ends of the wait are a long way below the link that asked for it, so focus goes to
  // whichever heading arrives — the panel's, or the resting copy's carrying the reason — the
  // first time the wait resolves, and only then. A second opinion replaces the cards under the
  // panel's heading, and moving focus again would interrupt somebody reading them.
  useEffect(() => {
    if (focused.current) return
    if (!review && error === '') return
    focused.current = true
    document.getElementById(focusTargetOnOpen(review !== null))?.focus()
  }, [review, error])

  /** A second opinion on the same claim: their answers, or their own words. */
  async function reviewAgain(input: { answers: ClarifyAnswer[]; guidance?: string }) {
    if (!review) return
    setBusy('reconciling')
    setError('')
    try {
      const next = await postReconcile({ extraction: review.extraction, ...input })
      setReview(next)
      setRound((n) => n + 1)
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') ||
          'Reading that failed, and nothing was changed. Try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  /** The only write here, and it applies exactly the rows the panel showed. */
  async function accept() {
    if (!review) return
    setBusy('saving')
    setError('')
    try {
      await apiFetch('/api/profile/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeset: review.changeset }),
      })
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') ||
          'That didn’t save, and nothing was changed. Try again.',
      )
      setBusy(null)
      return
    }
    // The claim is in the bank. Recording that on the round and closing this panel belong to
    // the caller: it owns the round, and the item has to read as added even if that fails.
    // The panel stays frozen — `busy` is still 'saving' — until it unmounts under us.
    await onApplied()
  }

  /**
   * The other way out, when the reconcile has decided the bank already covers this. Nothing is
   * applied — there is nothing to apply — so this is `accept()` without its write: the same
   * wait, so the button goes quiet and the panel's saving stage runs while the round is being
   * told. Cleared in `finally` rather than left frozen: on this path the caller may find a
   * second claim's panel on screen and leave this one standing.
   */
  async function markCovered() {
    setBusy('saving')
    setError('')
    try {
      await onApplied()
    } finally {
      setBusy(null)
    }
  }

  if (!review) {
    return (
      <section aria-labelledby="claim-heading" className="mt-8 border border-line bg-surface px-5 py-4">
        {/* Focusable for the same reason the panel's own heading is: this is where focus lands
            when the read fails, and the title is the first thing a reader needs. */}
        <h3 id="claim-heading" tabIndex={-1} className="font-display text-lg tracking-tight text-ink">
          What this would change
        </h3>
        <p className="mt-1.5 max-w-[62ch] font-display text-[0.9375rem] leading-relaxed text-ink-2">
          “{said}”
        </p>
        <Working busy={busy !== null} className="mt-3" stages={RECONCILING} note="Usually takes 10–20 seconds.">
          <p className="max-w-[52ch] text-sm">
            {error ? <span className="text-danger">{error}</span> : <span className="text-ink-3">Nothing is saved yet.</span>}
          </p>
        </Working>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* The copy above says "Try again", and until now nothing here did that: the only way
              back was Cancel and a second click on the add link. Offered only once there is a
              failure to retry — while the first read is still running there is nothing to redo. */}
          {error !== '' && (
            <button type="button" className="btn btn-quiet" disabled={busy !== null} onClick={readAgain}>
              Try again
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    )
  }

  return (
    <>
      <ReconcilePanel
        headingLevel="h3"
        round={round}
        changeset={review.changeset}
        questions={review.questions}
        facts={facts}
        busy={busy}
        error={error}
        onAccept={() => void accept()}
        onCancel={onClose}
        onReconcile={(input) => void reviewAgain(input)}
      />
      {alreadyCovered(review.changeset) && (
        <AlreadyCovered busy={busy !== null} onCovered={() => void markCovered()} />
      )}
    </>
  )
}

/**
 * The reconcile has answered that the bank already covers this sentence: every row is a skip, so
 * the panel's **Accept** is disabled and there is nothing to apply. The debrief flagged the
 * sentence because nothing backed it; the reconcile is a second, differently prompted judgment
 * and may disagree. Without a move here the item stays amber for good — Cancel settles nothing
 * and the next click buys the same round trip — so the way out is to say it is settled: no write
 * to the bank, only the round's note that this sentence is done, which is what lifts the amber.
 *
 * Its own component, and exported, because the panel it belongs under only exists after a
 * request: rendering this one is the only way the suite can check what it says.
 */
export function AlreadyCovered({ busy, onCovered }: { busy: boolean; onCovered: () => void }) {
  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-2">
      <p className="max-w-[62ch] text-sm leading-relaxed text-ink-2">Your facts already cover this.</p>
      <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCovered}>
        Mark it as covered
      </button>
    </div>
  )
}
