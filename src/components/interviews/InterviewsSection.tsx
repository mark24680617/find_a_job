'use client'

import { useEffect, useState } from 'react'
import { NoticeIntake } from '@/components/interviews/NoticeIntake'
import { RoundCard } from '@/components/interviews/RoundCard'
import { apiFetch } from '@/lib/apiFetch'
import type { InterviewRound } from '@/lib/types'

/**
 * The rounds logged under one application, and the place to add another.
 *
 * It renders nothing at all until there is something to say — no rounds and no open intake is
 * the state most applications are in, and an empty "Interviews" heading over an empty list is a
 * promise the product has not kept yet. The rounds come first and the intake sits under them:
 * a second round is logged against what the first one already said.
 *
 * A failed load is quiet rather than fatal. The rounds are one part of this screen and the
 * questions are the rest of it; losing the list should not take the page down with it.
 */

interface Props {
  appId: string
  /** Whether the paste-a-notice panel is open. Owned by the page — the button is in its header. */
  open: boolean
  onClose: () => void
  /** A round landed: the application's status and timeline moved server-side, so re-read it. */
  onLogged: () => void
}

export function InterviewsSection({ appId, open, onClose, onLogged }: Props) {
  const [rounds, setRounds] = useState<InterviewRound[]>([])
  // The round logged just now whose brief the model could not write. Held by id, so the note
  // sits on that card alone and an older round without a brief stays quiet about it.
  const [briefFailedFor, setBriefFailedFor] = useState('')

  useEffect(() => {
    let live = true
    apiFetch<InterviewRound[]>(`/api/applications/${appId}/interviews`)
      .then((next) => live && setRounds(next))
      // Leave the list empty; the questions below are the rest of the screen.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [appId])

  if (rounds.length === 0 && !open) return null

  return (
    <section aria-labelledby="interviews-heading" className="mt-8">
      <h2
        id="interviews-heading"
        className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-ink-2"
      >
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
              setRounds((prev) => [...prev, round])
              setBriefFailedFor(briefFailed ? round.id : '')
              onClose()
              onLogged()
            }}
          />
        )}
      </div>
    </section>
  )
}
