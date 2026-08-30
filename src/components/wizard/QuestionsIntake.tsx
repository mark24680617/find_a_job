'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { Application } from '@/lib/types'

/**
 * Where a form's questions come in: the questions pasted as text, screenshots of the live form,
 * or both. The parse reads them and puts them on the record.
 *
 * Parsing REPLACES the whole question list — the newest intake is the description of the form,
 * and a list half from one screenshot and half from another matches no form that exists. So on
 * a re-parse this says exactly what is lost before it happens, and the button names the count
 * it will replace. That is the confirmation: a specific sentence, not a generic dialog.
 */

// Kept in step with the server's `IMAGE_MIMES`. Held here rather than imported so a client
// component never reaches into the AI/server module for one constant.
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

type Shot = { name: string; base64: string; mime: (typeof IMAGE_MIMES)[number] }

const isImageMime = (mime: string): mime is Shot['mime'] =>
  (IMAGE_MIMES as readonly string[]).includes(mime)

/** Strips the `data:image/png;base64,` prefix the FileReader adds. */
function readImageAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.readAsDataURL(file)
  })
}

interface Props {
  app: Application
  onParsed: (app: Application) => void
  /** Present only when re-parsing an existing form, to back out without replacing anything. */
  onCancel?: () => void
}

export function QuestionsIntake({ app, onParsed, onCancel }: Props) {
  const [text, setText] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const existing = app.questions.length
  const drafted = app.questions.filter((q) => q.status === 'drafted').length
  const finalized = app.questions.filter((q) => q.status === 'final').length
  const reparsing = existing > 0

  const canParse = (text.trim() !== '' || shots.length > 0) && !busy

  async function addFiles(files: FileList | null) {
    if (!files) return
    setError('')
    const added: Shot[] = []
    for (const file of Array.from(files)) {
      if (!isImageMime(file.type)) {
        setError('Screenshots only — PNG, JPEG or WebP.')
        continue
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError('That image is over 6 MB. Try a smaller screenshot.')
        continue
      }
      try {
        added.push({ name: file.name, base64: await readImageAsBase64(file), mime: file.type })
      } catch (err) {
        setError(readable(err instanceof Error ? err.message : '') || 'That image could not be read.')
      }
    }
    if (added.length > 0) setShots((prev) => [...prev, ...added])
  }

  async function parse() {
    if (!canParse) return
    setBusy(true)
    setError('')
    try {
      const updated = await apiFetch<Application>(
        `/api/applications/${app.id}/questions/parse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text.trim() || undefined,
            images: shots.map(({ base64, mime }) => ({ base64, mime })),
          }),
        },
      )
      onParsed(updated)
    } catch (err) {
      setError(
        readable(err instanceof Error ? err.message : '') ||
          'That couldn’t be read, and nothing was changed. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="intake-heading" className="mt-8 border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 id="intake-heading" className="font-display text-lg tracking-tight text-ink">
          {reparsing ? 'Re-parse the form' : 'The form’s questions'}
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
          Paste the questions, or drop screenshots of the form — or both. They become the list
          you answer, one at a time.
        </p>
      </div>

      {reparsing && (
        <div className="border-b border-line-strong bg-surface px-5 py-4">
          <p className="max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink">
            Re-parsing replaces all {existing} question{existing === 1 ? '' : 's'} and discards
            any drafts ({drafted} drafted, {finalized} finalized). What you’ve written on the
            current questions can’t be recovered.
          </p>
        </div>
      )}

      {/* No `aria-busy`: it would hold back the progress region below, which has to be
          heard. `disabled` already stops a second parse being started. */}
      <fieldset disabled={busy} className="min-w-0">
        <div className="grid gap-px bg-line md:grid-cols-2">
          <div
            className={`bg-surface p-5 transition-colors ${dragging ? 'bg-accent-soft' : ''}`}
            // A drop target is not a control, so the fieldset's `disabled` does not reach it.
            // Without this the zone still lights up while the parse is running and then
            // swallows the file, since the request already in flight is what lands.
            onDragOver={(e) => {
              if (busy) return
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              if (busy) return
              e.preventDefault()
              setDragging(false)
              void addFiles(e.dataTransfer.files)
            }}
          >
            <h3 className="text-sm font-medium text-ink-2">Screenshots</h3>
            {shots.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {shots.map((shot, i) => (
                  <li key={`${shot.name}-${i}`} className="flex items-center gap-x-3">
                    <span className="min-w-0 flex-1 truncate text-[0.9375rem] text-ink">
                      {shot.name}
                    </span>
                    <button
                      type="button"
                      className="btn-link shrink-0 text-sm"
                      onClick={() => setShots((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
                <li>
                  <label className="btn-link mt-1 inline-block cursor-pointer text-sm">
                    Add another
                    <input
                      type="file"
                      accept={IMAGE_MIMES.join(',')}
                      multiple
                      className="sr-only"
                      onChange={(e) => void addFiles(e.target.files)}
                    />
                  </label>
                </li>
              </ul>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="btn btn-quiet cursor-pointer">
                  Choose images
                  <input
                    type="file"
                    accept={IMAGE_MIMES.join(',')}
                    multiple
                    className="sr-only"
                    onChange={(e) => void addFiles(e.target.files)}
                  />
                </label>
                <span className="text-sm text-ink-3">or drop them here</span>
              </div>
            )}
          </div>

          <div className="bg-surface p-5">
            <label htmlFor="pasted-questions" className="text-sm font-medium text-ink-2">
              Pasted questions
            </label>
            <textarea
              id="pasted-questions"
              rows={6}
              className="field field-boxed mt-3 px-3 py-2 text-[0.9375rem] leading-relaxed"
              placeholder="Paste the form’s questions — one per line is fine, and any stated word or character limits."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line px-5 py-4">
          <button
            type="button"
            className={reparsing ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={!canParse}
            onClick={() => void parse()}
          >
            {busy
              ? 'Reading…'
              : reparsing
                ? `Replace ${existing} question${existing === 1 ? '' : 's'}`
                : 'Read the questions'}
          </button>
          {onCancel && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          )}
          <Working
            busy={busy}
            className="min-w-0 flex-1"
            stages={[
              { at: 0, text: 'Reading the form…' },
              { at: 4000, text: 'Writing down each question and the limit it states…' },
            ]}
            note="Usually takes 5–15 seconds."
          >
            <p className="max-w-[46ch] text-sm text-ink-3">
              Takes a few seconds — it reads the form, it doesn’t answer it yet.
            </p>
          </Working>
        </div>

        {error && (
          <p role="alert" className="border-t border-line px-5 py-3 text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>
    </section>
  )
}
