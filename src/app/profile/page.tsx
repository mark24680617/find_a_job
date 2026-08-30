'use client'

import { useEffect, useState } from 'react'
import { AppShell, useUnsavedChanges } from '@/components/AppShell'
import { Working } from '@/components/Working'
import { FactBank } from '@/components/profile/FactBank'
import { GapAnswers } from '@/components/profile/GapAnswers'
import { ReconcilePanel } from '@/components/profile/ReconcilePanel'
import { StandardAnswers } from '@/components/profile/StandardAnswers'
import { VoiceRules } from '@/components/profile/VoiceRules'
import { apiFetch } from '@/lib/apiFetch'
import { factFromGapAnswer, visibleGaps } from '@/lib/profileView'
import { readable } from '@/lib/readable'
import type { Changeset, ClarifyAnswer, ClarifyQuestion, Profile } from '@/lib/types'

/**
 * The profile vault: everything the agent is allowed to know about the candidate, and the one
 * screen where they can correct it.
 *
 * Three rules shape the whole page.
 *
 * 1. **Reading a document changes nothing.** "Extract facts" asks the server what the document
 *    WOULD change and gets back a proposal — adds, revisions, and the claims it decided were
 *    already known, with its reasons. That proposal is held in the browser and shown as a diff;
 *    only Accept writes, and only what the diff showed. It is still refused while there are
 *    unsaved edits, because the reconcile is computed against the *stored* profile and a
 *    revision aimed at a fact that only exists locally would land on the wrong claim.
 * 2. **Everything else is local until Save.** Edits and deletes change a working copy; the PUT
 *    replaces the whole document. Until then "Discard" puts the saved version back, which is
 *    what makes deleting a row a safe thing to try.
 * 3. **Nothing is editable while a request is in flight.** They take seconds, and accepting a
 *    changeset comes back as a whole profile that replaces the working copy, so an edit made
 *    during the wait would be silently overwritten and a Save sent during it would race the
 *    server's own write.
 *    The vault is frozen for the duration rather than merged afterwards — a `<fieldset>`
 *    disables every control under it, which is one guarantee instead of a prop on each of them.
 *
 * And every way out of the page — the nav, Sign out, closing the tab — is guarded by the shell
 * once `useUnsavedChanges` reports that there is something to lose.
 */

/** Bytes of PDF we will turn into base64 and post. Comfortably inside the model's inline limit. */
const MAX_PDF_BYTES = 6 * 1024 * 1024

const SECTION_GAP = 'mt-14'

/** What `POST /api/profile/reconcile` answers with: a reading, and what it would do with it. */
interface Review {
  extraction: unknown
  changeset: Changeset
  questions: ClarifyQuestion[]
}

/** What `POST /api/profile/apply` answers with, once the candidate has accepted the diff. */
interface ApplyResult {
  profile: Profile
  added: number
  updated: number
}

/** Which request is in flight. They freeze the same things and say different words. */
type Busy = 'reconciling' | 'saving' | null

/** What actually landed, counted rather than described — nothing else on screen says it. */
function applied(added: number, updated: number): string {
  const facts = (n: number) => `${n} ${n === 1 ? 'fact' : 'facts'}`
  if (added === 0 && updated === 0) {
    return 'Nothing needed changing — your profile already covered it.'
  }
  const what =
    added === 0
      ? `Revised ${facts(updated)}`
      : updated === 0
        ? `Added ${facts(added)}`
        : `Added ${facts(added)}, revised ${updated}`
  return `${what}. Check them — anything wrong is yours to correct.`
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

export default function ProfilePage() {
  return (
    <AppShell>
      <ProfileVault />
    </AppShell>
  )
}

function ProfileVault() {
  // `working` is what the page edits; `saved` is the last thing the server confirmed. The gap
  // between them is the dirty state, and comparing them is cheaper than tracking every edit.
  const [working, setWorking] = useState<Profile | null>(null)
  const [saved, setSaved] = useState<Profile | null>(null)
  const [loadError, setLoadError] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedAt, setSavedAt] = useState('')

  const [pdf, setPdf] = useState<{ name: string; base64: string } | null>(null)
  const [notes, setNotes] = useState('')
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const [ingestError, setIngestError] = useState('')
  const [ingestNote, setIngestNote] = useState('')

  // The proposal, held here and nowhere else until it is accepted. `extraction` is what the
  // server read out of the document; it travels back with every refinement so a second opinion
  // on the same document is not a second reading of it. `round` counts the opinions, which is
  // how the panel knows to seed a new set of cards.
  const [review, setReview] = useState<Review | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState<Busy>(null)
  const [reviewError, setReviewError] = useState('')

  // AppShell renders nothing until Firebase reports a signed-in user, so this only ever runs
  // for one — and a sign-out unmounts the page rather than leaving a stale profile on screen.
  useEffect(() => {
    let live = true
    apiFetch<Profile>('/api/profile')
      .then((profile) => {
        if (!live) return
        setWorking(profile)
        setSaved(profile)
      })
      .catch((err: unknown) => {
        if (live)
          setLoadError(
            readable(err instanceof Error ? err.message : '') ||
              'Your profile could not be loaded. Reload the page.',
          )
      })
    return () => {
      live = false
    }
  }, [])

  const dirty = working !== null && saved !== null && JSON.stringify(working) !== JSON.stringify(saved)

  // Must run before the early returns below — hooks are not conditional.
  useUnsavedChanges(dirty)

  function land(profile: Profile) {
    setWorking(profile)
    setSaved(profile)
  }

  // Answering a gap turns it into a fact and drops it from the list — a working-copy edit like
  // any other, which the Save bar then persists. A blank answer never reaches here. Identified by
  // its text rather than its position: the section renders a filtered list, so a position in it
  // is not a position in `working.gaps`.
  function answerGap(gap: string, answer: string) {
    if (!working) return
    setWorking({
      ...working,
      facts: [...working.facts, factFromGapAnswer(working.facts, gap, answer)],
      gaps: working.gaps.filter((g) => g !== gap),
    })
  }

  async function save() {
    if (!working) return
    setSaving(true)
    setSaveError('')
    try {
      land(
        await apiFetch<Profile>('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(working),
        }),
      )
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setSaveError(
        readable(err instanceof Error ? err.message : '') ||
          'Saving failed. Your edits are still here — try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function chooseFile(file: File | undefined) {
    setIngestError('')
    setIngestNote('')
    if (!file) return
    if (file.type !== 'application/pdf') {
      setIngestError('That isn’t a PDF. Export your resume as PDF, or paste the text instead.')
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      setIngestError('That PDF is over 6 MB. Try a smaller export, or paste the text instead.')
      return
    }
    try {
      setPdf({ name: file.name, base64: await readPdfAsBase64(file) })
    } catch (err) {
      setIngestError(readable(err instanceof Error ? err.message : '') || 'That file could not be read.')
    }
  }

  /** The source as the routes take it, or null when there is nothing to read. */
  function source(): { pdfBase64?: string; pastedText?: string; url?: string } | null {
    const body = {
      pdfBase64: pdf?.base64,
      pastedText: notes.trim() || undefined,
      url: url.trim() || undefined,
    }
    return body.pdfBase64 || body.pastedText || body.url ? body : null
  }

  /** Every reconcile lands the same way, whether it read a document or re-read an opinion. */
  async function reconcile(body: unknown, kind: Busy) {
    setBusy(kind)
    setIngestError('')
    setIngestNote('')
    setReviewError('')
    try {
      const next = await apiFetch<Review>('/api/profile/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setReview(next)
      setRound((n) => n + 1)
    } catch (err) {
      const message =
        readable(err instanceof Error ? err.message : '') ||
        'Reading that failed, and nothing was changed. Try again.'
      // Where the failure is shown is where the click was: the panel is not on screen yet on
      // the first read, and the intake box is off the top of it by the time it is.
      if (review) setReviewError(message)
      else setIngestError(message)
    } finally {
      setBusy(null)
    }
  }

  /** Read the document and ask what it would change. Nothing is written by this. */
  function startReview() {
    const body = source()
    if (body) void reconcile(body, 'reconciling')
  }

  /** A second opinion on the same reading: the candidate's answers, or their own words. */
  function reviewAgain(input: { answers: ClarifyAnswer[]; guidance?: string }) {
    if (!review) return
    void reconcile({ extraction: review.extraction, ...input }, 'reconciling')
  }

  /** The only write on this screen, and it applies exactly the rows the panel showed. */
  async function accept() {
    if (!review) return
    // The fact bank stays editable while the panel is open, and applying comes back as a whole
    // profile that replaces the working copy — so an edit made in that window would be thrown
    // away by the very click meant to add to it. Rule 1's precondition, checked again here
    // rather than only at the button that started the reconcile.
    if (dirty) {
      setReviewError('Save or discard your edits first — accepting replaces the whole profile.')
      return
    }
    setBusy('saving')
    setReviewError('')
    try {
      const { profile, added, updated } = await apiFetch<ApplyResult>('/api/profile/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeset: review.changeset }),
      })
      // The route wrote it, so this is server truth and the page is clean again.
      land(profile)
      setReview(null)
      setPdf(null)
      setNotes('')
      setUrl('')
      setIngestNote(applied(added, updated))
    } catch (err) {
      setReviewError(
        readable(err instanceof Error ? err.message : '') ||
          'That didn’t save, and nothing was changed. Try again.',
      )
    } finally {
      setBusy(null)
    }
  }

  /** Closing the panel is the whole of cancelling: nothing had been written to undo. */
  function cancel() {
    setReview(null)
    setReviewError('')
    setIngestNote('Nothing was changed. Your document is still in the box above.')
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p role="alert" className="max-w-[52ch] text-[0.9375rem] text-danger">
          {loadError}
        </p>
      </main>
    )
  }

  if (!working) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16" aria-busy="true">
        <p className="text-sm text-ink-3">Opening your vault…</p>
      </main>
    )
  }

  // One review at a time: starting another would throw away a proposal the person is
  // part-way through reading. Cancel is right there.
  const canReview = source() !== null && busy === null && !dirty && review === null
  // Filtered at render, never in storage: the eight standard answers below ask about work
  // authorization, notice and salary themselves, and an ingest reliably reports each missing
  // one as a gap too. `profile.gaps` keeps every word the model wrote.
  const openGaps = visibleGaps(working.gaps)

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-4">
      <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">Profile</h1>
      <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
        What the agent is allowed to say about you, and what it has to ask you first.
      </p>

      {/* `disabled` cascades to every control inside, which is what makes rule 3 a guarantee
          rather than a prop each component has to remember to honour. `min-w-0` undoes the
          `min-inline-size: min-content` a fieldset carries by default. */}
      {/* No `aria-busy`: it would tell assistive tech to hold back updates from inside it,
          and the progress below is a live region that has to be heard. `disabled` is what makes
          rule 3 a guarantee anyway. */}
      <fieldset disabled={busy !== null} className="min-w-0">
        <section aria-labelledby="intake-heading" className="mt-8 border border-line bg-surface">
          <div className="border-b border-line px-5 py-4">
            <h2 id="intake-heading" className="font-display text-lg tracking-tight text-ink">
              Add to your profile
            </h2>
            <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
              A resume PDF, pasted notes, or both. Every fact it writes down carries the fragment
              of your text it came from.
            </p>
          </div>

          <div className="grid gap-px bg-line md:grid-cols-2">
            <div
              className={`bg-surface p-5 transition-colors ${dragging ? 'bg-accent-soft' : ''}`}
              // The fieldset's `disabled` freezes every control under it, but a drop target is
              // not a control: without this the zone would still light up mid-ingest and then
              // swallow the file, since the request already in flight is what gets landed.
              onDragOver={(e) => {
                if (busy !== null) return
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                if (busy !== null) return
                e.preventDefault()
                setDragging(false)
                void chooseFile(e.dataTransfer.files[0])
              }}
            >
              <h3 className="text-sm font-medium text-ink-2">Resume PDF</h3>
              {pdf ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="max-w-[28ch] truncate text-[0.9375rem] text-ink">{pdf.name}</span>
                  <button type="button" className="btn-link text-sm" onClick={() => setPdf(null)}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="btn btn-quiet cursor-pointer">
                    Choose a PDF
                    <input
                      type="file"
                      accept="application/pdf"
                      className="sr-only"
                      onChange={(e) => void chooseFile(e.target.files?.[0])}
                    />
                  </label>
                  <span className="text-sm text-ink-3">or drop one here</span>
                </div>
              )}
            </div>

            <div className="bg-surface p-5">
              <label htmlFor="pasted-notes" className="text-sm font-medium text-ink-2">
                Pasted notes
                <span className="chip ml-2.5 align-middle font-normal">Optional</span>
              </label>
              <textarea
                id="pasted-notes"
                rows={6}
                className="field field-boxed mt-3 px-3 py-2 text-[0.9375rem] leading-relaxed"
                placeholder="Anything a resume leaves out: what a project actually involved, a number you never wrote down, a job you left off."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {/* Full width under the two: a third source, and a single line of input — beside
                the resume drop zone it would read as another document to supply. */}
            <div className="bg-surface p-5 md:col-span-2">
              <label htmlFor="profile-url" className="text-sm font-medium text-ink-2">
                Portfolio or website URL
                <span className="chip ml-2.5 align-middle font-normal">Optional</span>
              </label>
              <input
                id="profile-url"
                type="url"
                inputMode="url"
                aria-describedby="profile-url-hint"
                className="field field-boxed mt-3 px-3 py-2 text-[0.9375rem]"
                placeholder="https://yoursite.com/about"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p id="profile-url-hint" className="mt-2 max-w-[68ch] text-sm text-ink-3">
                Read as though you had pasted the page. A LinkedIn profile won’t work — LinkedIn
                serves nothing to anything but a browser, so paste your About and Experience text
                into the notes instead.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4">
            <button type="button" className="btn btn-primary" disabled={!canReview} onClick={startReview}>
              {busy === 'reconciling' && !review ? 'Reading…' : 'Extract facts'}
            </button>
            {/* The first read is narrated here rather than in the panel, because the panel is
                not on screen yet — and a `role="status"` that arrives already carrying its
                message is not announced. Every later wait happens inside the panel, which by
                then has been mounted and resting for as long as the person has been reading. */}
            <Working
              busy={busy === 'reconciling' && !review}
              className="min-w-0 flex-1"
              stages={[
                {
                  at: 0,
                  text: pdf
                    ? 'Reading your resume…'
                    : url.trim() !== ''
                      ? 'Fetching that page…'
                      : 'Reading your notes…',
                },
                { at: 4000, text: 'Comparing with what I already know…' },
                { at: 10_000, text: 'Almost there — working out what would change…' },
              ]}
              note="Usually takes 10–20 seconds."
            >
              <p className="max-w-[52ch] text-sm text-ink-3">
                {dirty
                  ? 'Save your edits first — this is compared against the saved profile.'
                  : review
                    ? 'Below is what it would change. Nothing is saved until you accept it.'
                    : 'Nothing is saved by this. You see what it would change first.'}
              </p>
            </Working>
          </div>

          {(ingestError || ingestNote) && (
            <p
              role="status"
              aria-live="polite"
              className={`border-t border-line px-5 py-3 text-sm ${
                ingestError ? 'text-danger' : 'text-accent'
              }`}
            >
              {ingestError || ingestNote}
            </p>
          )}
        </section>

        {review && (
          <ReconcilePanel
            round={round}
            changeset={review.changeset}
            questions={review.questions}
            // The SAVED bank, not the working copy: the changeset was computed against what the
            // server holds, so that is what a revision is revising.
            facts={saved?.facts ?? working.facts}
            busy={busy}
            error={reviewError}
            onAccept={() => void accept()}
            onCancel={cancel}
            onReconcile={reviewAgain}
          />
        )}

        <div className={SECTION_GAP}>
          <FactBank
            facts={working.facts}
            standardAnswers={working.standardAnswers}
            onChange={(facts) => setWorking({ ...working, facts })}
          />
        </div>

        {/* Standard answers first: they are the eight questions every application asks, they
            have typed controls, and the open gaps below are whatever is left over after them. */}
        <div className={SECTION_GAP}>
          <StandardAnswers
            answers={working.standardAnswers}
            onChange={(standardAnswers) => setWorking({ ...working, standardAnswers })}
          />
        </div>

        {openGaps.length > 0 && (
          <div className={SECTION_GAP}>
            <GapAnswers gaps={openGaps} onAnswer={answerGap} />
          </div>
        )}

        <div className={SECTION_GAP}>
          <VoiceRules
            rules={working.voiceRules}
            onChange={(voiceRules) => setWorking({ ...working, voiceRules })}
          />
        </div>

        {/* Sticky rather than floating: it belongs to the document, and it only exists while
            there is something to do with it. */}
        <div className="sticky bottom-0 mt-14 -mx-6 border-t border-line-strong bg-surface px-6 py-3">
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <p
              role="status"
              aria-live="polite"
              className={`mr-auto text-sm ${saveError ? 'text-danger' : 'text-ink-2'}`}
            >
              {saveError ||
                (dirty
                  ? 'Unsaved changes'
                  : savedAt
                    ? `Saved at ${savedAt}`
                    : 'Everything here is saved')}
            </p>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={!dirty || saving || busy !== null}
              onClick={() => {
                setSaveError('')
                if (saved) setWorking(saved)
              }}
            >
              Discard changes
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!dirty || saving || busy !== null}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </fieldset>
    </main>
  )
}
