'use client'

import { useState } from 'react'
import { NoticeIntake } from '@/components/interviews/NoticeIntake'
import { RoundCard } from '@/components/interviews/RoundCard'
import type { InterviewRound } from '@/lib/types'

/**
 * The rounds logged under one application, and the place to add another.
 *
 * It renders nothing at all until there is something to say — no rounds and no open intake is
 * the state most applications are in, and an empty "Interviews" heading over an empty list is a
 * promise the product has not kept yet. The rounds come first and the intake sits under them:
 * a second round is logged against what the first one already said.
 *
 * The list itself belongs to the page rather than to this section: the process map above draws
 * the same rounds pinned to the stages they map to, and two components each holding their own
 * copy meant logging a round moved one and left the other showing yesterday's answer.
 */

interface Props {
  appId: string
  rounds: InterviewRound[]
  /** Whether the paste-a-notice panel is open. Owned by the page — the button is in its header. */
  open: boolean
  onClose: () => void
  /**
   * A round landed. The page adds it to the list so the card is on screen before any request
   * comes back, and re-reads the record, whose status and timeline moved server-side.
   */
  onLogged: (round: InterviewRound) => void
}

export function InterviewsSection({ appId, rounds, open, onClose, onLogged }: Props) {
  // The round logged just now whose brief the model could not write. Held by id, so the note
  // sits on that card alone and an older round without a brief stays quiet about it.
  const [briefFailedFor, setBriefFailedFor] = useState('')

  if (rounds.length === 0 && !open) return null

  return (
    <section aria-labelledby="interviews-heading" className="mt-8">
      {/* Peer of "What to expect" above it, and set like it: the two sections are siblings on
          this screen, so neither may outrank the other. Their sub-labels are the eyebrows. */}
      <h2 id="interviews-heading" className="font-display text-lg tracking-tight text-ink">
        Interviews
      </h2>

      <div className="mt-2 grid min-w-0 gap-4">
        {rounds.map((round) => (
          <RoundCard
            key={round.id}
            appId={appId}
            round={round}
            briefFailed={round.id === briefFailedFor}
          />
        ))}

        {open && (
          <NoticeIntake
            appId={appId}
            onCancel={onClose}
            onLogged={(round, briefFailed) => {
              setBriefFailedFor(briefFailed ? round.id : '')
              onClose()
              onLogged(round)
            }}
          />
        )}
      </div>
    </section>
  )
}
