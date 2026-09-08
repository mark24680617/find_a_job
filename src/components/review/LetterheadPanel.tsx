'use client'

import { useEffect, useState } from 'react'
import { headerLines } from '@/lib/letter/layout'
import { LETTERHEAD_FIELD_MAX, readLetterhead } from '@/lib/letter/letterhead'
import { readable } from '@/lib/readable'
import type { Letterhead } from '@/lib/types'

/**
 * What goes above the letter: who it is from, and when they know it, who it is to.
 *
 * A ruled block between the pane's header and the draft, never a bordered card inside a bordered
 * pane and never amber — amber means *only you know this* throughout this product, and a phone
 * number is not that. The preview at the top is drawn with `headerLines`, the same function the
 * renderer paginates, so what is on screen and what prints cannot drift; it follows the fields
 * as they are typed, and nothing can be drafted or exported while they differ from what is
 * stored, so the preview is never showing a header the PDF would not carry.
 *
 * Blanks are lines omitted, never lines guessed. A letterhead with nothing but a name prints
 * nothing but a name, and a letter with no name given ends at "Sincerely,".
 *
 * The fill beside the save is how most of those blanks get filled: the candidate's own facts and
 * the posting say five of the seven between them, and retyping a phone number per application was
 * the cheaper half of a trade that did not have to be paid at all. It writes into blanks only, so
 * the link is never the thing that loses what somebody typed.
 */

interface Props {
  letter: Letterhead
  company: string
  /** Today, as the browser's local date — the date the letter would carry if exported now. */
  today: string
  busy: boolean
  /**
   * A fill started somewhere else — the page runs one the moment the letter is created, and the
   * panel is already on screen while it is out. Absent means nobody else is filling.
   */
  filling?: boolean
  onSave: (letter: Letterhead) => Promise<void>
  /** Fill the blanks from the facts and the posting; resolves with the fields it filled. */
  onFill: () => Promise<string[]>
  onDirtyChange: (dirty: boolean) => void
}

const FIELDS: { key: keyof Letterhead; label: string; placeholder?: string; autoComplete?: string }[] = [
  { key: 'name', label: 'Your name', autoComplete: 'name' },
  { key: 'email', label: 'Email', autoComplete: 'email' },
  { key: 'phone', label: 'Phone', autoComplete: 'tel' },
  { key: 'location', label: 'Location', placeholder: 'City, State' },
  { key: 'recipient', label: 'Recipient', placeholder: 'Their full name, if you know it' },
  { key: 'recipientTitle', label: 'Their title' },
]

/**
 * How the fill's own sentence names each field: the labels above, read mid-sentence. The address
 * is the one the list does not carry, because it is a textarea rather than an input.
 */
const FILL_LABELS: Record<string, string> = {
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.label.toLowerCase()])),
  companyAddress: 'company address',
}

/**
 * `Filled in phone, location and company address.` — the fields one call filled, in the order the
 * route returns them, which is the order they are drawn in. No serial comma: this is a sentence,
 * not a list. An empty result says the other thing, because there is nothing to name and the two
 * ways of getting there — nothing was blank, nothing could be sourced — are one outcome to read.
 */
export function filledSentence(fields: string[]): string {
  if (fields.length === 0) return 'Nothing more to fill in — your facts and the posting don’t say.'
  const named = fields.map((f) => FILL_LABELS[f] ?? f)
  const last = named[named.length - 1]
  return `Filled in ${named.length === 1 ? last : `${named.slice(0, -1).join(', ')} and ${last}`}.`
}

/**
 * What the save would write, and whether that differs from what is stored.
 *
 * Both halves come from the same normalised value, because the save sends a normalised one: if
 * "unsaved" were measured against the raw fields instead, a letterhead whose only edit is a space
 * around an already-saved value would be unsaved for good — the PATCH would store the letterhead
 * that is already there, so the prop would never change, the fields would never be re-seeded, and
 * every control that waits on a clean letterhead would stay disabled with nothing on screen to
 * say which space to go and delete.
 */
export function pendingLetterhead(
  fields: Letterhead,
  stored: Letterhead,
): { next: Letterhead; dirty: boolean } {
  const next = readLetterhead(fields)
  const dirty = (Object.keys(stored) as (keyof Letterhead)[]).some((k) => next[k] !== stored[k])
  return { next, dirty }
}

export function LetterheadPanel({
  letter,
  company,
  today,
  busy,
  filling = false,
  onSave,
  onFill,
  onDirtyChange,
}: Props) {
  const [fields, setFields] = useState(letter)
  // Re-seed when the stored letterhead changes — after a save, or when the question does. The
  // comparison is by value rather than by identity: the pane reads the letterhead back through
  // `readLetterhead` on every render, so the object handed down here is a new one each time and
  // an identity check would throw away what is being typed.
  const key = JSON.stringify(letter)
  const [seededFrom, setSeededFrom] = useState(key)
  if (seededFrom !== key) {
    setSeededFrom(key)
    setFields(letter)
  }

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A fill this panel started, as against one the page started; the button says the same thing
  // either way, because from here they are the same request landing in the same fields.
  const [running, setRunning] = useState(false)
  const [fillNote, setFillNote] = useState('')
  const isFilling = filling || running

  // Seven typed fields are unsaved work like the box below them, and the page guards them the
  // same way. Reported up rather than held here, because what it disables — every control that
  // starts a draft — is the pane's.
  const { next, dirty } = pendingLetterhead(fields, letter)
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  // The preview is drawn from what would be written, not from what is in the inputs, so it shows
  // what would actually print rather than the paste that landed in a field.
  const head = headerLines(next, company, today)

  async function save() {
    setSaving(true)
    setError('')
    try {
      await onSave(next)
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') ||
          'That didn’t save. Your letterhead is still here — try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  /**
   * Ask for the blanks. The route writes the record and the pane hands the new question down, so
   * the fields re-seed from what was stored rather than from what came back — the same path a
   * save takes, and the reason nothing here has to merge anything itself.
   */
  async function fill() {
    setRunning(true)
    setError('')
    setFillNote('')
    try {
      setFillNote(filledSentence(await onFill()))
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') ||
          'That didn’t fill anything in. Your letterhead is still here — try again.',
      )
    } finally {
      setRunning(false)
    }
  }

  const set = (k: keyof Letterhead, value: string) => setFields((prev) => ({ ...prev, [k]: value }))

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="max-w-[62ch] text-[0.9375rem] leading-relaxed">
        {head.name ? (
          <p className="font-display text-ink">{head.name}</p>
        ) : (
          <p className="text-ink-3">Your name — add it below.</p>
        )}
        {head.contact && <p className="text-ink-2">{head.contact}</p>}
        <p className="mt-3 text-ink-2">{head.date}</p>
        {head.recipient.map((line, i) => (
          <p key={i} className={`text-ink-2 ${i === 0 ? 'mt-3' : ''}`}>
            {line}
          </p>
        ))}
      </div>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-ink-3">
        The salutation and the signature are in the letter itself; the letterhead is what goes
        above it.
      </p>

      {/* Closed while a fill is out as well as while a save is: what comes back re-seeds every
          field, so anything typed into one in the meantime would go without being asked about. */}
      <fieldset disabled={busy || saving || isFilling} className="mt-4 min-w-0">
        <legend className="sr-only">Letterhead</legend>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {FIELDS.map(({ key: k, label, placeholder, autoComplete }) => (
            <label key={k} className="grid gap-1.5">
              <span className="text-sm font-medium text-ink-2">{label}</span>
              <input
                type="text"
                autoComplete={autoComplete}
                placeholder={placeholder}
                maxLength={LETTERHEAD_FIELD_MAX}
                className="field field-boxed h-10 px-3"
                value={fields[k]}
                onChange={(e) => set(k, e.target.value)}
              />
            </label>
          ))}
          {/* An address is several lines, and the layout prints them as it is given them, so
              the field that holds one has to be able to hold the line breaks. */}
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-ink-2">Company address</span>
            <textarea
              rows={3}
              placeholder="Optional — one line per row"
              maxLength={LETTERHEAD_FIELD_MAX}
              className="field field-boxed px-3 py-2 text-[0.9375rem] leading-relaxed"
              value={fields.companyAddress}
              onChange={(e) => set('companyAddress', e.target.value)}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className="btn btn-quiet" onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save letterhead'}
          </button>
          {/* Held back while the fields are unsaved, and the line beside says which: the fill
              writes the record, and the record is what re-seeds these inputs, so running one over
              typing that has not been saved would take the typing with it. */}
          <button
            type="button"
            className="btn-link text-sm"
            disabled={busy || saving || isFilling || dirty}
            onClick={() => void fill()}
          >
            {isFilling ? 'Filling in…' : 'Fill in from my profile and the posting'}
          </button>
          <p className="max-w-[52ch] text-sm text-ink-3">
            {dirty
              ? 'Save or clear your edits first.'
              : 'Saved with the letter. The draft addresses and signs it from here.'}
          </p>
        </div>
      </fieldset>
      {/* In the DOM before it has anything to say, so a screen reader announces the sentence when
          it arrives rather than missing an element that appeared already carrying one. */}
      <p role="status" aria-live="polite" className="mt-2 max-w-[62ch] text-sm text-ink-3 empty:mt-0">
        {fillNote}
      </p>
      {error && (
        <p role="alert" className="mt-2 max-w-[62ch] text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
