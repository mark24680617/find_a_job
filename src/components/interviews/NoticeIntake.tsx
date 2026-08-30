'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { InterviewRound } from '@/lib/types'

/**
 * Where an interview enters the record: the scheduling email, pasted whole.
 *
 * Nothing is asked for beyond the notice itself — no round-type picker, no date field. The
 * whole point is that the notice already says all of it, and a form that asks a person to
 * retype what the email in front of them says is a form that has learned nothing. What the
 * notice does NOT say comes back as amber cards on the round rather than as a guess.
 */

/**
 * The two model calls behind this — the notice read, then the brief written for it. The
 * timings are measured, not guessed: the pair came back in about seven seconds against the
 * live model, so the second line lands while the first call is still out and the third around
 * the time the brief starts.
 */
const STAGES = [
  { at: 0, text: 'Reading the notice…' },
  { at: 2_500, text: 'Working out the round, the time and who is on it…' },
  { at: 5_000, text: 'Writing the brief for this round…' },
] as const

interface Props {
  appId: string
  onLogged: (round: InterviewRound, briefFailed: boolean) => void
  onCancel: () => void
}

export function NoticeIntake({ appId, onLogged, onCancel }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function log() {
    if (text.trim() === '' || busy) return
    setBusy(true)
    setError('')
    try {
      const { round, briefFailed } = await apiFetch<{
        round: InterviewRound
        briefFailed?: boolean
      }>(`/api/applications/${appId}/interviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeText: text }),
      })
      onLogged(round, briefFailed === true)
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') ||
          'That couldn’t be read, and nothing was saved. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h3 className="font-display text-lg tracking-tight text-ink">
          Log an interview
        </h3>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
          Paste the notice — the email works as-is. It reads which round this is, when, and who
          is on it, then writes a brief for that round against this posting.
        </p>
      </div>

      {/* No `aria-busy`: it would hold back the progress region below, which has to be heard.
          `disabled` already stops a second notice being sent. */}
      <fieldset disabled={busy} className="min-w-0">
        <div className="px-5 pt-5">
          <label htmlFor="interview-notice" className="sr-only">
            The interview notice
          </label>
          <textarea
            id="interview-notice"
            rows={6}
            className="field field-boxed px-3 py-2 text-[0.9375rem] leading-relaxed"
            placeholder="Paste the interview notice — the email works as-is."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
          <button
            type="button"
            className="btn btn-primary"
            disabled={text.trim() === '' || busy}
            onClick={() => void log()}
          >
            {busy ? 'Reading…' : 'Read the notice'}
          </button>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <Working
            busy={busy}
            className="min-w-0 flex-1"
            stages={STAGES}
            note="Usually takes 5–15 seconds — two readings, the notice and the brief."
          >
            <p className="max-w-[46ch] text-sm text-ink-3">
              It won’t guess a date the notice doesn’t state.
            </p>
          </Working>
        </div>

        {error && (
          <p role="alert" className="border-t border-line px-5 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>
    </div>
  )
}
