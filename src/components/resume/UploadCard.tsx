'use client'

import { useState } from 'react'
import { DISCLOSURE, NO_RESUME, PROFILE_NOT_A_DOCUMENT, STALE } from '@/components/resume/copy'
import { MAX_RESUME_BYTES } from '@/lib/resume/bounds'
import type { StoredResume } from '@/lib/types'

/**
 * The document itself: what is stored, what the profile's own facts look like against it, and
 * the two ways to change it — replace, or delete.
 *
 * The card says where the document is handed over, rather than in a settings page nobody opens,
 * that it is private to the account and can be deleted at any time (§8, as amended 2026-10-07).
 * It is shown whether or not anything is stored.
 *
 * The 6 MB check here is the browser's half of the server's two: `MAX_RESUME_BYTES` is imported
 * rather than re-typed, so there is exactly one number. It is not a guard — the route checks
 * `content-length` before the body is in memory and the decoded bytes after — it is the
 * difference between a refusal in a tenth of a second and one after a 6 MB upload.
 */

interface Props {
  resume: StoredResume | null
  /**
   * How many facts the profile holds. Non-zero, with nothing stored, adds
   * `PROFILE_NOT_A_DOCUMENT` under the empty state. A count rather than a source, because a
   * source is the one thing nothing here records.
   */
  profileFacts: number
  busy: boolean
  /**
   * The page's sentence for an upload or a delete that failed (final review, page-5). Drawn in
   * the card's one alert line, so the card has one place a refusal appears, not two.
   */
  error?: string
  onUpload: (file: File) => Promise<void>
  onDelete: () => Promise<void>
}

/** Why this file will not be posted, or '' when it will. Pure, so the rule is testable. */
export function fileProblem(file: { type: string; size: number }): string {
  if (file.type !== 'application/pdf') {
    return 'That isn’t a PDF. Export your resume as PDF and upload that.'
  }
  if (file.size > MAX_RESUME_BYTES) return 'That PDF is over 6 MB. Try a smaller export.'
  return ''
}

/**
 * The chosen file, with the input emptied behind it (final review, ledger-1). Chromium and Safari
 * fire `change` only when the new choice's path differs from the one the input holds, and this
 * input stays mounted across uploads, so without the reset "Replace it" with a re-export saved
 * over the same path — the upload → Diagnose → edit → replace loop — or a retry after a failure,
 * would send nothing and say nothing. The File taken first stays readable after the clear.
 */
export function takeFile(input: { files: ArrayLike<File> | null; value: string }): File | undefined {
  const file = input.files?.[0]
  input.value = ''
  return file
}

/** Kilobytes, rounded, with the separator the rest of the app uses for counts. */
function sizeText(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString()} KB`
}

/**
 * §5.4's one line. A document every fact can be found in says so rather than counting to
 * nothing: `34 of 34 … 0 could not` is arithmetic nobody needs read back to them.
 */
function snippetLine(located: number, total: number): string {
  return located === total
    ? `All ${total} of your facts can be found in this resume.`
    : `${located} of ${total} of your facts can be found in this resume. ${total - located} could not.`
}

export function UploadCard({ resume, profileFacts, busy, error = '', onUpload, onDelete }: Props) {
  const [problem, setProblem] = useState('')
  const [dragging, setDragging] = useState(false)
  const snippet = resume?.snippetCheck
  // The browser's refusal is the newer of the two: choosing a file clears it, and a post clears
  // the page's.
  const shown = problem !== '' ? problem : error

  function choose(file: File | undefined) {
    setProblem('')
    if (!file) return
    const why = fileProblem(file)
    if (why) {
      setProblem(why)
      return
    }
    void onUpload(file)
  }

  return (
    <section aria-labelledby="resume-intake-heading" className="mt-8 border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 id="resume-intake-heading" className="font-display text-lg tracking-tight text-ink">
          The document
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-ink-2">
          PDF only.
        </p>
      </div>

      <div
        className={`p-5 transition-colors ${dragging ? 'bg-accent-soft' : ''}`}
        // A drop target is not a control, so the page's `<fieldset disabled>` does not reach
        // it: without this it would light up mid-upload and swallow the file.
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
          choose(e.dataTransfer.files[0])
        }}
      >
        {resume ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="max-w-[40ch] truncate text-[0.9375rem] text-ink">{resume.filename}</span>
            <span className="tnum text-sm text-ink-3">{sizeText(resume.bytes)}</span>
          </div>
        ) : (
          <p className="max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink">{NO_RESUME}</p>
        )}

        {!resume && profileFacts > 0 && (
          <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-ink-2">
            {PROFILE_NOT_A_DOCUMENT}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="btn btn-quiet cursor-pointer">
            {resume ? 'Replace it' : 'Choose a PDF'}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => choose(takeFile(e.target))}
            />
          </label>
          <span className="text-sm text-ink-3">or drop one here</span>
          {resume && (
            <button type="button" className="btn-link text-sm" onClick={() => void onDelete()}>
              Delete this resume
            </button>
          )}
        </div>

        {shown !== '' && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {shown}
          </p>
        )}
      </div>

      {snippet && snippet.total > 0 && (
        <div className="border-t border-line px-5 py-4">
          <p className="max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink">
            {snippetLine(snippet.located, snippet.total)}
          </p>
          {snippet.reviewedFrom !== resume?.addedAt && (
            <p className="mt-1 text-sm text-ink-3">{STALE}</p>
          )}
          {snippet.missing.length > 0 && (
            <ul className="mt-3 max-w-[70ch] border-t border-line">
              {snippet.missing.map((miss, i) => (
                <li
                  key={`${miss}-${i}`}
                  className="border-b border-line py-2 font-display text-sm leading-relaxed text-ink-2"
                >
                  “{miss}”
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-3">
            Reported, not corrected. A fact may have come from something you told the agent
            rather than from this document.
          </p>
        </div>
      )}

      <p className="border-t border-line px-5 py-3 text-sm leading-relaxed text-ink-3">
        {DISCLOSURE}
      </p>
    </section>
  )
}
