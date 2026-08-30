'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { ApiError, apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { Application } from '@/lib/types'

/**
 * Step one: where the posting comes from.
 *
 * One box, not a mode switch. Somebody who has a job posting open has one of two things on
 * their clipboard — the address, or the text — and being asked which it is before pasting is
 * a question the page can answer itself: anything starting `http` is a link, everything else
 * is the posting.
 *
 * The fetch fails often and on purpose (LinkedIn serves nothing to a non-browser client,
 * some boards challenge unknown clients), so the recovery is the important path, not an
 * error state. When the server refuses with a 422 it says why in a sentence written for the
 * person reading it; that sentence is shown verbatim, the link stays where they left it, and
 * a paste box opens underneath. The next submit sends both — the route takes the paste as the
 * job description and keeps the link as the source, so nothing about the record is lost by
 * having had to paste.
 */

interface Props {
  onCreated: (app: Application) => void
}

const HAS_SCHEME = /^https?:\/\//i
// A link somebody didn't finish typing: no spaces anywhere and a dot in it. Nobody pastes a
// job description with no whitespace in it, and a posting URL always carries a host.
const BARE_HOST = /^\S+\.\S+$/

/** What the single box holds. A bare host is a link with its scheme left off, not a posting. */
export function readSource(typed: string): { url: string; jdText: string; addedScheme: boolean } {
  if (HAS_SCHEME.test(typed)) return { url: typed, jdText: '', addedScheme: false }
  if (BARE_HOST.test(typed)) return { url: `https://${typed}`, jdText: '', addedScheme: true }
  return { url: '', jdText: typed, addedScheme: false }
}

/**
 * Whether what is in the box is a LinkedIn address, decided here rather than by the server.
 * The fetch will refuse it — LinkedIn serves nothing to a non-browser client — and the way
 * round it is to open the posting and follow its "Apply on company website" link. Saying that
 * before the submit costs a hostname comparison; saying it after costs the round trip and
 * reads as a failure rather than as directions.
 */
export function isLinkedInSource(typed: string): boolean {
  const { url } = readSource(typed)
  if (url === '') return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'linkedin.com' || host.endsWith('.linkedin.com')
  } catch {
    return false
  }
}

/**
 * The one failure that isn't an error: the route could not fetch the posting itself and is
 * asking for a paste. Recognised by status and body, never by the wording of the message —
 * the wording is the server's to change. Exported because it is the hinge of the whole
 * recovery path and the only part of it a test without a browser can reach.
 */
export function pasteRequest(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const body = err.body
  if (typeof body !== 'object' || body === null) return null
  const { error, needPaste } = body as { error?: unknown; needPaste?: unknown }
  if (needPaste !== true) return null
  return typeof error === 'string' && error !== '' ? error : err.message
}

export function SourceStep({ onCreated }: Props) {
  const [source, setSource] = useState('')
  const [paste, setPaste] = useState('')
  // The server's own sentence about why it could not fetch. Non-empty is what opens the
  // paste box, so there is one piece of state behind both the message and the recovery.
  const [refusal, setRefusal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const typed = source.trim()
  const { url, jdText: fromBox, addedScheme } = readSource(typed)
  // Once the server has answered, its sentence is the one on screen — this would be a second
  // voice saying the same thing.
  const linkedIn = refusal === '' && isLinkedInSource(typed)
  // Before a refusal the single box is either the link or the posting. After one the posting
  // normally comes from the paste box — but somebody who clears the link and types the posting
  // where the link was is doing the same thing, and the box they used shouldn't decide it.
  const jdText = (refusal ? paste.trim() : '') || fromBox

  async function submit() {
    if (url === '' && jdText === '') return
    setBusy(true)
    setError('')
    try {
      onCreated(
        await apiFetch<Application>('/api/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url || undefined, jdText: jdText || undefined }),
        }),
      )
    } catch (err) {
      const reason = pasteRequest(err)
      if (reason) setRefusal(reason)
      else
        setError(
          readable(err instanceof Error ? err.message : '') ||
            'That posting could not be read, and nothing was saved. Try again.',
        )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="source-heading" className="mt-8 border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 id="source-heading" className="font-display text-lg tracking-tight text-ink">
          The posting
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
          A link to it, or the whole thing pasted in. Both end up as the same record.
        </p>
      </div>

      {/* `disabled` cascades to every control inside, so nothing can be edited or submitted
          twice while the model is reading. */}
      {/* No `aria-busy`: it would hold back the progress region below, which has to be
          heard. `disabled` already stops anything being edited or submitted twice. */}
      <fieldset disabled={busy} className="min-w-0">
        <div className="px-5 py-5">
          <label htmlFor="posting-source" className="text-sm font-medium text-ink-2">
            Link or posting text
          </label>
          <textarea
            id="posting-source"
            rows={3}
            autoFocus
            aria-describedby="posting-source-hint"
            className="field field-boxed mt-2 px-3 py-2 text-[0.9375rem] leading-relaxed"
            placeholder="https://boards.greenhouse.io/… — or paste the posting itself"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <p
            id="posting-source-hint"
            className={
              linkedIn
                ? 'mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-2'
                : 'mt-2 text-sm text-ink-3'
            }
          >
            {linkedIn
              ? 'LinkedIn won’t hand a posting over. Open it there, follow its “Apply on company website” link, and paste that address instead — it is usually Greenhouse, Ashby or Lever, which read cleanly. Or paste the posting text.'
              : typed === ''
                ? 'Greenhouse, Ashby and Lever links are read directly. Anything else, paste the text.'
                : url === ''
                  ? 'Text — read exactly as pasted.'
                  : addedScheme
                    ? 'A link, with https:// added — the posting gets fetched, then read.'
                    : 'A link — the posting gets fetched, then read.'}
          </p>
        </div>

        {refusal !== '' && (
          <div className="border-t border-line bg-amber-soft px-5 py-5">
            {/* The server's wording, unedited: it knows which host refused and why. */}
            <p role="alert" className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink">
              {refusal}
            </p>
            <label htmlFor="posting-paste" className="mt-4 block text-sm font-medium text-ink-2">
              Paste the posting text
            </label>
            <textarea
              id="posting-paste"
              rows={10}
              autoFocus
              aria-describedby="posting-paste-hint"
              className="field field-boxed mt-2 px-3 py-2 text-[0.9375rem] leading-relaxed"
              placeholder="Select the whole posting in your browser, copy it, paste it here."
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <p id="posting-paste-hint" className="mt-2 max-w-[62ch] text-sm text-ink-2">
              The link above stays on the record as the source — leave it where it is.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4">
          <button
            type="button"
            className="btn btn-primary"
            disabled={url === '' && jdText === ''}
            onClick={() => void submit()}
          >
            {busy
              ? 'Reading…'
              : refusal !== '' && jdText === ''
                ? 'Try the link again'
                : 'Read the posting'}
          </button>
          <Working
            busy={busy}
            className="min-w-0 flex-1"
            stages={[
              { at: 0, text: jdText !== '' ? 'Reading what you pasted…' : 'Reading the posting…' },
              { at: 4000, text: 'Working out the company, the role and what it screens for…' },
            ]}
            note="Usually takes 5–15 seconds."
          >
            <p className="max-w-[52ch] text-sm text-ink-3">
              Takes a few seconds — it gets read against the facts in your profile.
            </p>
          </Working>
        </div>

        {error !== '' && (
          <p role="alert" className="border-t border-line px-5 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>
    </section>
  )
}
