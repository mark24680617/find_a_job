'use client'

import { type FormEvent, useState } from 'react'
import type { Question } from '@/lib/types'

/**
 * A form asks something the parse missed, and you need one more row without re-parsing — which
 * would throw away every draft you already have. This is that row: type the question, optionally
 * cap its length, and it lands in the list defaulted like any parsed long-text question — not
 * required, no positioning yet, nothing drafted — ready to set up and draft like the rest.
 */

/**
 * Build the blank question from the form's fields. Pure, so the append it feeds is testable
 * without a DOM: the text is required, a limit is kept only when it's a positive number, and
 * everything else takes the long-text default.
 */
export function newQuestion(text: string, limit?: number, unit?: 'words' | 'chars'): Question {
  // A length cap is a whole number of words/chars — round a fractional input rather than storing
  // "≤12.5 words" and feeding fractional counter math.
  const rounded = limit !== undefined && Number.isFinite(limit) ? Math.round(limit) : undefined
  const hasLimit = rounded !== undefined && rounded > 0
  return {
    q: text,
    constraints: {
      type: 'long-text',
      required: false,
      ...(hasLimit ? { limit: rounded, unit: unit ?? 'words' } : {}),
    },
    askHuman: [],
    status: 'pending',
  }
}

interface Props {
  /** Append the composed question; resolves once it is saved, rejects with a message on failure. */
  onAdd: (q: Question) => Promise<void>
}

export function AddQuestion({ onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [limit, setLimit] = useState('')
  const [unit, setUnit] = useState<'words' | 'chars'>('words')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function close() {
    setText('')
    setLimit('')
    setUnit('words')
    setError('')
    setOpen(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (trimmed === '' || busy) return
    const n = Number(limit.trim())
    const parsedLimit = limit.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
    setBusy(true)
    setError('')
    try {
      await onAdd(newQuestion(trimmed, parsedLimit, unit))
      close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="border-t border-line px-4 py-3">
        <button
          type="button"
          className="btn-link text-sm"
          onClick={() => setOpen(true)}
        >
          Add a question
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 border-t border-line px-4 py-4">
      <div className="grid gap-1.5">
        <label
          htmlFor="add-q-text"
          className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
        >
          New question
        </label>
        <textarea
          id="add-q-text"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A question the form asks that isn’t listed."
          className="field field-boxed px-3 py-2 text-[0.9375rem] leading-relaxed"
        />
      </div>

      <div className="grid gap-1.5">
        <label
          htmlFor="add-q-limit"
          className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
        >
          Limit <span className="normal-case tracking-normal text-ink-3">(optional)</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            id="add-q-limit"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="—"
            className="field field-boxed tnum w-20 px-2 py-1.5 text-[0.9375rem]"
          />
          <label htmlFor="add-q-unit" className="sr-only">
            Limit unit
          </label>
          <select
            id="add-q-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'words' | 'chars')}
            className="field field-boxed px-2 py-1.5 text-[0.9375rem]"
          >
            <option value="words">words</option>
            <option value="chars">chars</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="submit" className="btn btn-primary" disabled={busy || text.trim() === ''}>
          {busy ? 'Adding…' : 'Add question'}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={close}>
          Cancel
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
