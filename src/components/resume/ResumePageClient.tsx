'use client'

import { useEffect, useState } from 'react'
import { DiagnoseSection } from '@/components/resume/DiagnoseSection'
import { GapsSection } from '@/components/resume/GapsSection'
import {
  RewriteSection,
  withAskIds,
  type RewriteProposal,
  type RouteRewrite,
} from '@/components/resume/RewriteSection'
import type { ErrorAt, ToolError } from '@/components/resume/ToolError'
import { UploadCard } from '@/components/resume/UploadCard'
import { ApiError, apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import { readPdfAsBase64 } from '@/lib/readPdf' // R51 — the profile page's helper, one copy
import { tier0Terms } from '@/lib/resume/gaps'
import type { Application, Profile, StoredResume } from '@/lib/types'

/**
 * The resume page: one stored document and, as the stages land, three tools over it — each with
 * its own trigger, each running only when pressed.
 *
 * Two rules, both the profile vault's.
 *
 * 1. **Nothing here is unsaved.** Every control posts and the server answers with the whole
 *    document, so there is no working copy to lose and no `useUnsavedChanges` to report. The
 *    only thing a visit can leave behind is a request in flight.
 * 2. **Nothing is touchable while one is.** A `<fieldset disabled>` freezes every control under
 *    it for the seconds a tool takes — one guarantee instead of a prop each section has to
 *    remember. No `aria-busy` above it: that would tell assistive tech to hold back the very
 *    updates the `Working` regions inside exist to announce.
 */

/** The profile vault's own section rhythm (`src/app/profile/page.tsx:53`). */
export const SECTION_GAP = 'mt-14'

/**
 * The one resume this version stores — `RESUME_CURRENT_ID` in `src/lib/db.ts`. Spelled here
 * rather than imported: `@/lib/db` is the Admin SDK and cannot be reached from the browser.
 */
export const RESUME_ID = 'current'

/** A 404 is the answer for a user who has not uploaded one yet, and is not a failure. */
async function loadResume(): Promise<StoredResume | null> {
  try {
    return await apiFetch<StoredResume>(`/api/profile/resumes/${RESUME_ID}`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

export function ResumePageClient() {
  const [resume, setResume] = useState<StoredResume | null>(null)
  // A rewrite proposal is held here and nowhere else until a line of it is accepted (rule 1).
  const [proposal, setProposal] = useState<{ reviewedFrom: string; rewrites: RewriteProposal[] } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // How many of this person's own applications Tier 0 would read — the ones whose parse carried
  // a role fact or a requirement, counted by the same tier0Terms the route runs (R54), not the
  // size of the collection. The page reads it once, so the sentence under the heading is the
  // real number and not a stand-in for one.
  const [postings, setPostings] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  // Which control's request failed, and the sentence: drawn beside that control (page-5).
  const [error, setError] = useState<ToolError>(null)

  // AppShell renders nothing until Firebase reports a signed-in user, so this only ever runs
  // for one, and a sign-out unmounts the page rather than leaving a stale document on screen.
  useEffect(() => {
    let live = true
    Promise.all([loadResume(), apiFetch<Profile>('/api/profile'), apiFetch<Application[]>('/api/applications')])
      .then(([stored, prof, apps]) => {
        if (!live) return
        setResume(stored)
        setProfile(prof)
        setPostings(tier0Terms(apps).postingsUsed)
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (live)
          setLoadError(
            readable(err instanceof Error ? err.message : '') ||
              'This page could not be loaded. Reload it.',
          )
      })
    return () => {
      live = false
    }
  }, [])

  /**
   * Every tool lands the same way: one request, the whole document back, or a sentence — drawn
   * beside the control `at` names, not above the page (final review, page-5).
   */
  async function run<T>(at: ErrorAt, request: () => Promise<T>, land: (value: T) => void, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      land(await request())
    } catch (err) {
      setError({ at, text: readable(err instanceof Error ? err.message : '') || fallback })
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File) {
    const pdfBase64 = await readPdfAsBase64(file).catch(() => '')
    if (pdfBase64 === '') {
      setError({ at: 'upload', text: 'That file could not be read.' })
      return
    }
    await run(
      'upload',
      () =>
        apiFetch<StoredResume>('/api/profile/resumes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdfBase64, filename: file.name }),
        }),
      (next) => {
        setResume(next)
        setProposal(null)
      },
      'That upload didn’t finish, and nothing was stored. Try again.',
    )
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete ${resume?.filename ?? 'this resume'}?\n\n` +
          'The checks, gaps and rewrites stored with it are deleted too. This cannot be undone.',
      )
    )
      return
    await run(
      'upload',
      () => apiFetch<void>(`/api/profile/resumes/${RESUME_ID}`, { method: 'DELETE' }),
      () => {
        setResume(null)
        setProposal(null)
      },
      'That didn’t delete. Your resume is still here — try again.',
    )
  }

  async function diagnose() {
    await run(
      'diagnose',
      () => apiFetch<StoredResume>(`/api/profile/resumes/${RESUME_ID}/diagnose`, { method: 'POST' }),
      setResume,
      'That check didn’t finish, and nothing was stored. Try again.',
    )
  }

  async function compare(roleFamily: string, onetSoc: string) {
    await run(
      'gaps',
      () =>
        apiFetch<StoredResume>(`/api/profile/resumes/${RESUME_ID}/gaps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleFamily, onetSoc }),
        }),
      setResume,
      'That comparison didn’t finish, and nothing was stored. Try again.',
    )
  }

  async function rewrite(bulletIds: string[]) {
    await run(
      'rewrite',
      async () => {
        const res = await apiFetch<{ reviewedFrom: string; proposal: { rewrites: RouteRewrite[] } }>(
          `/api/profile/resumes/${RESUME_ID}/rewrite`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bulletIds }),
          },
        )
        // (amended 2026-09-24, R31) Each ask's stable id is a SHA-1, which the browser computes
        // asynchronously — so it is attached here, once, as the proposal arrives.
        return { reviewedFrom: res.reviewedFrom, rewrites: await withAskIds(res.proposal.rewrites) }
      },
      setProposal,
      'That rewrite didn’t finish, and nothing was stored. Try again.',
    )
  }

  async function accept(rewrite_: RewriteProposal) {
    if (!proposal) return
    await run(
      `accept-${rewrite_.bulletId}`,
      () =>
        apiFetch<StoredResume>(`/api/profile/resumes/${RESUME_ID}/rewrite/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reviewedFrom: proposal.reviewedFrom,
            bulletId: rewrite_.bulletId,
            text: rewrite_.text,
            citations: rewrite_.citations,
          }),
        }),
      (next) => {
        setResume(next)
        // The accepted line is on the document now; leaving it in the proposal would offer the
        // same accept a second time.
        setProposal((prev) =>
          prev === null
            ? null
            : { ...prev, rewrites: prev.rewrites.filter((r) => r.bulletId !== rewrite_.bulletId) },
        )
      },
      'That didn’t save, and nothing was changed. Try again.',
    )
  }

  /**
   * One request per answer, and each answers with the whole document — the route appends one
   * `AnsweredAsk` (§4). Sent in series rather than in parallel: two appends of the same array
   * racing each other is a lost answer, and these are answers only this person could give.
   *
   * Each answer carries the card's stable `askId` (amended 2026-09-24, R31). A 409 means that id
   * is already stored — a second tab, or a retry after a lost response — so the answer is saved
   * and the loop carries on with the rest rather than failing the batch. Only a 409: the route's
   * count cap is a 422, where nothing was stored, so it is thrown on and shown like any other
   * error (amended 2026-09-24, R55).
   */
  async function answerAsks(
    at: 'diagnose-asks' | 'gaps-asks' | 'rewrite-asks',
    answers: { askId: string; question: string; answer: string }[],
  ) {
    await run(
      at,
      async () => {
        let latest: StoredResume | null = null
        for (const answer of answers) {
          try {
            latest = await apiFetch<StoredResume>(`/api/profile/resumes/${RESUME_ID}/asks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(answer),
            })
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) continue
            throw error
          }
        }
        return latest
      },
      (next) => {
        if (next) setResume(next)
      },
      'That answer didn’t save. Try again.',
    )
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

  if (!loaded) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16" aria-busy="true">
        <p className="text-sm text-ink-3">Opening your resume…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-10 pb-16">
      <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">Resume</h1>
      <p className="mt-2 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
        Upload your resume to check it, see what it’s missing, and rewrite the lines that fall short.
      </p>

      {/* `min-w-0` undoes the `min-inline-size: min-content` a fieldset carries by default. */}
      <fieldset disabled={busy} className="min-w-0">
        <UploadCard
          resume={resume}
          // A count, not a source. Nothing in this repo records where a profile came from, and
          // the card's second sentence now says only what the page can see: facts on file, and
          // no document under them.
          profileFacts={profile?.facts.length ?? 0}
          busy={busy}
          error={error?.at === 'upload' ? error.text : ''}
          onUpload={upload}
          onDelete={remove}
        />
        {resume && (
          <>
            <div className={SECTION_GAP}>
              <DiagnoseSection
                resume={resume}
                busy={busy}
                error={error}
                onRun={diagnose}
                onAnswerAsk={(answers) => answerAsks('diagnose-asks', answers)}
              />
            </div>
            <div className={SECTION_GAP}>
              <GapsSection
                resume={resume}
                postingsAvailable={postings}
                busy={busy}
                error={error}
                onRun={compare}
                onAnswerAsk={(answers) => answerAsks('gaps-asks', answers)}
              />
            </div>
            <div className={SECTION_GAP}>
              <RewriteSection
                // A Replace re-allocates every bullet id, so the ticks, the open citation and the
                // copied mark of the last upload start over rather than riding along (page-1).
                key={resume.addedAt}
                resume={resume}
                proposal={proposal}
                facts={profile?.facts ?? []}
                busy={busy}
                error={error}
                onRun={rewrite}
                onAccept={accept}
                onAnswerAsk={(answers) => answerAsks('rewrite-asks', answers)}
              />
            </div>
          </>
        )}
      </fieldset>
    </main>
  )
}
