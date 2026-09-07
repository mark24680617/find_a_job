'use client'

import { useEffect, useRef, useState } from 'react'
import { Working } from '@/components/Working'
import { ApiError, apiFetch } from '@/lib/apiFetch'
// `SectionLock` comes from the same pure module as the caps. The lock is the page's — one lock
// across two sections — but the page, this section and the plan section all have to name its
// type, and a union declared in any of the three would put the other two in a ring around it.
import { MAX_BRIEF_CHARS, MAX_PDF_BYTES, type BriefInUse, type SectionLock } from '@/lib/assignment'
import { readable } from '@/lib/readable'
import { hostOf } from '@/lib/research/sources'
import type { InterviewRound } from '@/lib/types'

/**
 * The assignment: which text is the brief right now, and the one way to change it. Its own
 * `<section>` and its own eyebrow, the way `BriefSection` is — the page mounts it bare.
 *
 * A take-home usually arrives as the email itself, so the notice stands as the brief until the
 * candidate hands over the real one. Which of the two is in use is not decided here —
 * `briefInUse` decides it, in one place, and the page passes the answer down — but it is *said*
 * here, in characters, because a twenty-thousand-character cut makes a different document out of
 * the same paste and nobody should have to discover that from the plan.
 *
 * Below the line, one panel with three ways in: the text pasted, a PDF the model transcribes, or
 * a public link read through the guarded fetcher. Room for exactly one at a time — the route
 * takes one and the panel offers no way to send two, so a brief never arrives from two places
 * and there is nothing to reconcile afterwards.
 *
 * Replacing the brief throws the plan away: the route deletes it in the same write, because a
 * plan drawn from a text that is no longer the brief is a plan quoting a document nobody has.
 * That is the sort of thing to say before the click rather than after it, so the panel says it.
 */

/**
 * The wait. A pasted brief or a link is one write and at most one fetch, so the first line
 * usually covers the whole of it; a PDF is a model call on top of that, and its line exists only
 * on that path — telling somebody a PDF is being transcribed while their pasted text is being
 * stored would be a lie about what is happening.
 */
const READ_STAGES = [{ at: 0, text: 'Reading the brief…' }] as const
const PDF_STAGES = [
  { at: 0, text: 'Reading the brief…' },
  { at: 3_000, text: 'Transcribing the PDF…' },
] as const
const READ_NOTE = 'Usually takes 5–20 seconds.'

/**
 * One limit, one sentence, whichever check caught it. The file input refuses an oversized PDF
 * before a byte leaves the browser and shows this; a file that slips past — a base64 padding
 * that pushes it over, a file swapped after it was chosen — is refused by the route with a 413,
 * and the panel shows this same sentence rather than the route's. The route's own wording
 * (`that PDF is over 6 MB — paste the brief’s text instead`) is never displayed: it is a fact
 * about a request, this is the one about the file, and the reader has already read it once here.
 */
const OVER_SIZE = 'That PDF is over 6 MB. Try a smaller export, or paste the brief’s text instead.'
const NOT_A_PDF = 'That isn’t a PDF. Choose a PDF, or paste the brief’s text instead.'
const READ_FAILED = 'The brief couldn’t be read, and nothing was saved. Try again.'
const LOCKED = 'Wait for the plan to finish before changing the brief.'

/** What the line calls the brief in use. The link's case is markup, so it is not in here. */
const NAMES: Record<BriefInUse['source'], string> = {
  notice: 'The notice is the brief',
  pasted: 'Pasted',
  pdf: 'PDF, transcribed',
  // Only reached when the stored address will not parse — a link that cannot name its host is
  // not a link worth offering, so the line says what it is and stops there.
  url: 'Link',
}

/**
 * The copy is English and the spec pins its grouping — "cut at 20,000 characters" — so the
 * grouping is English too. A machine set to another locale must not rewrite the sentence.
 */
function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** Strips the `data:application/pdf;base64,` prefix the FileReader adds. */
function readPdfAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

interface PanelProps {
  appId: string
  roundId: string
  /** Whether there is a plan for this replacement to throw away. */
  planExists: boolean
  /**
   * The page's lock, read as well as written. The panel outlives the click that opened it, so a
   * plan started underneath one already open would otherwise find every way in still live — and
   * a read landing mid-run would clear, in its `finally`, a lock the plan is still holding.
   */
  lock: SectionLock
  setLock: (lock: SectionLock) => void
  /** The route answers with the round as stored; the section takes that copy. */
  onRead: (round: InterviewRound) => void
  onCancel: () => void
}

/**
 * The panel, in the notice intake's shape: the ways in, then one action row carrying both
 * buttons and the wait.
 *
 * Its own component, and exported, because a suite with no DOM cannot click the link that opens
 * it — and what it says at rest is exactly the part worth checking: which limit a file has, and
 * that a plan is about to go.
 */
export function BriefPanel({
  appId,
  roundId,
  planExists,
  lock,
  setLock,
  onRead,
  onCancel,
}: PanelProps) {
  const [pasted, setPasted] = useState('')
  const [pdf, setPdf] = useState<{ name: string; base64: string } | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pasteRef = useRef<HTMLTextAreaElement>(null)

  // Opening the panel puts the keyboard in it. The link that asked for it sits above three fields
  // and an action row, and it has just stopped being the thing to press. Mount only: the panel is
  // unmounted when it closes, so there is no second arrival to move focus for.
  useEffect(() => {
    pasteRef.current?.focus()
  }, [])

  /** How many of the three the route would be handed. It takes exactly one. */
  const filled = [pasted.trim() !== '', pdf !== null, url.trim() !== ''].filter(Boolean).length

  /**
   * The two refusals worth making before a byte leaves the browser: a file that is not a PDF,
   * which the model would transcribe into nothing, and one over the limit, which the route would
   * refuse after the whole upload had been sent.
   */
  async function chooseFile(file: File | undefined) {
    setError('')
    if (!file) return
    if (file.type !== 'application/pdf') {
      setError(NOT_A_PDF)
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(OVER_SIZE)
      return
    }
    try {
      setPdf({ name: file.name, base64: await readPdfAsBase64(file) })
    } catch (err) {
      setError(readable(err instanceof Error ? err.message : '') || 'That file could not be read.')
    }
  }

  async function read() {
    // The disabled fieldset below is what a person meets; this is the same refusal in code, for
    // the plan that starts between the render and the click.
    if (filled !== 1 || busy || lock === 'planning') return
    setBusy(true)
    setError('')
    // The plan cannot be drawn while this is out: it would be drawn from a text that is about to
    // stop being the brief. The lock is the page's, and the plan section reads it.
    setLock('reading')
    try {
      // Exactly one key on the body, whichever way in was used — the route refuses two, and
      // sending an empty second one would be sending two.
      const body =
        pdf !== null
          ? { pdfBase64: pdf.base64 }
          : pasted.trim() !== ''
            ? { pastedText: pasted }
            : { url: url.trim() }
      const next = await apiFetch<InterviewRound>(
        `/api/applications/${appId}/interviews/${roundId}/assignment`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      onRead(next)
    } catch (err) {
      // The 413 is recognised by its status and its own wording is dropped on the floor: the
      // file input already said the one thing that matters about the limit, and saying it a
      // second way would read as a second problem. So both checks — the one here and the one on
      // the route — put the same sentence on screen. Every other refusal from this route is a
      // reason written for a person — too short to plan from, that link is a PDF, a redirect
      // loop — and is shown as it came, because only the server knows which of them happened.
      if (err instanceof ApiError && err.status === 413) setError(OVER_SIZE)
      else setError(readable(err instanceof Error ? err.message : '') || READ_FAILED)
    } finally {
      setBusy(false)
      setLock(null)
    }
  }

  return (
    <div className="mt-4 border border-line bg-surface">
      {/* No `aria-busy`: it would hold back the progress region below, which has to be heard.
          `disabled` already stops a second brief being sent, and freezes all three ways in at
          once rather than one prop at a time — and it is the same freeze for the same reason
          while a plan is being drawn from the text this panel is about to replace. */}
      <fieldset disabled={busy || lock === 'planning'} className="min-w-0">
        <div className="grid gap-5 px-5 py-5">
          <div className="min-w-0">
            <label htmlFor="assignment-text" className="text-sm font-medium text-ink-2">
              Paste the brief
            </label>
            <textarea
              id="assignment-text"
              ref={pasteRef}
              rows={8}
              className="field field-boxed mt-2 px-3 py-2 text-[0.9375rem] leading-relaxed"
              placeholder="The assignment, as it was sent."
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
          </div>

          <div className="min-w-0">
            {/* Not a `<label>`: the control under it is itself a label wrapping the file input,
                and a label for a label points at nothing. */}
            <p className="text-sm font-medium text-ink-2">Or a PDF — up to 6 MB</p>
            {pdf ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="max-w-[28ch] truncate text-[0.9375rem] text-ink">{pdf.name}</span>
                <button type="button" className="btn-link text-sm" onClick={() => setPdf(null)}>
                  Remove
                </button>
              </div>
            ) : (
              <label className="btn btn-quiet mt-2 cursor-pointer">
                Choose a PDF
                <input
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={(e) => void chooseFile(e.target.files?.[0])}
                />
              </label>
            )}
          </div>

          <div className="min-w-0">
            <label htmlFor="assignment-url" className="text-sm font-medium text-ink-2">
              Or a public link — Google Docs and GitHub links are read as text
            </label>
            <input
              id="assignment-url"
              type="url"
              className="field field-boxed mt-2 px-3 py-2 text-[0.9375rem]"
              placeholder="https://"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
          <button
            type="button"
            className="btn btn-primary"
            disabled={filled !== 1 || busy}
            onClick={() => void read()}
          >
            {busy ? 'Reading…' : 'Read the brief'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          {/* The same sentence the link outside says, for the panel that was already open when
              the plan started: a greyed row with no reason beside it is a dead end. */}
          {lock === 'planning' && <span className="text-sm text-ink-3">{LOCKED}</span>}
          {/* Mounted whether or not anything is happening — a status region that arrives already
              carrying its message is not announced. What it holds at rest is the one warning this
              panel owes: the plan goes with the brief it was drawn from. */}
          <Working
            busy={busy}
            className="min-w-0 flex-1"
            stages={pdf !== null ? PDF_STAGES : READ_STAGES}
            note={READ_NOTE}
          >
            {planExists && <p className="text-sm text-ink-3">Replaces the plan you have now.</p>}
          </Working>
        </div>

        {error !== '' && (
          <p role="alert" className="border-t border-line px-5 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>
    </div>
  )
}

interface Props {
  appId: string
  round: InterviewRound
  /** Which text the plan will be drawn from — `briefInUse`'s answer, decided once by the page. */
  brief: BriefInUse
  /** Whether there is a plan for a replacement to throw away. */
  planExists: boolean
  lock: SectionLock
  setLock: (lock: SectionLock) => void
  /** The route answers with the round as stored; the page replaces its copy with that one. */
  onRound: (round: InterviewRound) => void
}

export function AssignmentSection({
  appId,
  round,
  brief,
  planExists,
  lock,
  setLock,
  onRound,
}: Props) {
  const [open, setOpen] = useState(false)
  /** Set just before the state update that closes the panel, and read once by the effect below. */
  const focusLine = useRef(false)
  const lineRef = useRef<HTMLParagraphElement>(null)

  // The panel that was holding the keyboard has gone, so focus lands on the line that changed —
  // which is the answer to what the read did, in one sentence. A ref rather than state, and no
  // dependency list: the instruction is one-shot, set just before the state update that
  // re-renders and cleared by the first effect after it, and an effect that cleared it with
  // `setState` would be the synchronous set-in-effect the lint forbids. Nothing moves on the
  // first render — the ref is false until a read lands.
  useEffect(() => {
    if (!focusLine.current) return
    focusLine.current = false
    lineRef.current?.focus()
  })

  const stored = round.assignment
  const url = stored?.url ?? ''
  // Linked only for a brief that came from a link, and only when the address still parses: a host
  // we cannot read is not a host we may print. `hostOf` rather than `new URL(...).hostname` so
  // this names a host the way `SourceList` and the research already name one — lowercased, `www.`
  // dropped — and so the empty string for an unparseable address is one behaviour, not two.
  const host = brief.source === 'url' ? hostOf(url) : ''
  const size =
    `${count(brief.text.length)} characters` +
    (brief.cut ? ` · cut at ${count(MAX_BRIEF_CHARS)} characters` : '')

  return (
    <section aria-labelledby="assignment-heading" className="mt-10">
      <h2 id="assignment-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
        The assignment
      </h2>

      <p
        ref={lineRef}
        tabIndex={-1}
        className="tnum mt-3 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2"
      >
        {host === '' ? (
          `${NAMES[brief.source]} · ${size}`
        ) : (
          <>
            <a href={url} target="_blank" rel="noreferrer" className="btn-link">
              {host}
            </a>
            {` · ${size}`}
          </>
        )}
      </p>

      {/* Only for a brief that was added. When the notice is standing in it is already at the
          foot of the page under its own disclosure, and a second copy would be the same document
          twice on one screen. */}
      {stored && (
        <details className="faq mt-3 text-sm">
          <summary className="btn-link inline cursor-pointer">The brief as read</summary>
          <pre className="mt-3 max-w-[72ch] whitespace-pre-wrap border border-line bg-surface px-4 py-3 font-sans text-[0.875rem] leading-relaxed text-ink-2">
            {brief.text}
          </pre>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <button
          type="button"
          className="btn-link"
          disabled={open || lock === 'planning'}
          onClick={() => setOpen(true)}
        >
          {stored ? 'Replace the brief' : 'Add the brief'}
        </button>
        {/* A plan already reading this text is the one reason the way in is shut, so the reason
            stands beside it rather than being left to be worked out from a greyed link. */}
        {lock === 'planning' && <span className="text-ink-3">{LOCKED}</span>}
      </div>

      {open && (
        <BriefPanel
          appId={appId}
          roundId={round.id}
          planExists={planExists}
          lock={lock}
          setLock={setLock}
          onRead={(next) => {
            focusLine.current = true
            setOpen(false)
            onRound(next)
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </section>
  )
}
