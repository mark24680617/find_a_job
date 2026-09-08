'use client'

import type { ReactNode } from 'react'

/**
 * The questions workspace, folded away once the record is past applying.
 *
 * Before then the answers are the work and this is nothing at all — a plain wrapper, so a draft
 * looks exactly as it did. Past applying they are the record of work already sent, and the loop
 * is what the screen is for, so they collapse behind one line that says what they are.
 *
 * The body is hidden with the `hidden` attribute rather than by rendering nothing: the pane
 * inside holds the one piece of unsaved work on the screen, and folding the section away must
 * not throw an answer somebody is part-way through writing.
 *
 * For the same reason both stages are drawn as one `<section>` wrapping one body div, with only
 * the heading row and the attributes differing. Returning a different element for each stage
 * would change the tag at this position the moment "Log an interview" moved the record, and
 * React unmounts a subtree whose element type changed — losing exactly the half-written answer
 * the `hidden` attribute is here to keep, and quietly, since the pane clears the page's
 * unsaved-changes guard as it goes.
 */

interface Props {
  /** Past applying: the line and the control render, and the body can be hidden. */
  collapsible: boolean
  open: boolean
  onToggle: () => void
  answered: number
  total: number
  children: ReactNode
}

export function AnswersDisclosure({ collapsible, open, onToggle, answered, total, children }: Props) {
  return (
    // Unnamed and unstyled before the record has been sent, so a draft looks exactly as it did:
    // a section with no accessible name is not a landmark, only a box.
    <section
      aria-labelledby={collapsible ? 'answers-heading' : undefined}
      className={collapsible ? 'mt-10 border-t border-line-strong pt-6' : undefined}
    >
      {collapsible && (
        <>
          {/* Peer of "What to expect" and "Interviews" and set like them: three siblings on this
              screen, none of which outranks the others. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 id="answers-heading" className="font-display text-lg tracking-tight text-ink">
              Application answers
            </h2>
            <span className="tnum text-sm text-ink-3">
              {total === 0 ? 'none recorded' : `${answered} of ${total} answered`}
            </span>
            <button
              type="button"
              className="btn-link text-sm"
              aria-expanded={open}
              aria-controls="answers-body"
              onClick={onToggle}
            >
              {open ? 'Hide' : 'Show'}
            </button>
          </div>

          {!open && (
            <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-ink-2">
              Sent with the application. Open to read or edit them.
            </p>
          )}
        </>
      )}

      <div id="answers-body" hidden={collapsible && !open}>
        {children}
      </div>
    </section>
  )
}
