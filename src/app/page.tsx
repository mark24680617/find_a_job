'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { PipelineBoard, statusChange } from '@/components/board/PipelineBoard'
import { UpcomingStrip, upcomingRounds, type UpcomingRound } from '@/components/board/UpcomingStrip'
import { apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { Application, AppStatus, InterviewRound } from '@/lib/types'

/**
 * The first screen: where everything is.
 *
 * A record that has been created and then left behind is the failure this page exists to
 * stop — before it, an application disappeared the moment you navigated away from it. So the
 * page loads the whole pipeline at once and shows the two things that decay with time: what
 * is coming up, and what has gone quiet.
 *
 * The rounds are fetched per application rather than in one query because they live in a
 * subcollection under each one; they are also the optional half of the page, so a failure to
 * read them leaves the board alone rather than taking the screen down with it.
 */

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  )
}

/** The rounds still ahead across these applications. Shared by the first load and the sample. */
async function fetchUpcoming(list: Application[]): Promise<UpcomingRound[]> {
  const perApp = await Promise.all(
    list.map((app) =>
      apiFetch<InterviewRound[]>(`/api/applications/${app.id}/interviews`)
        .then((rounds) => rounds.map((round) => ({ app, round })))
        .catch(() => []),
    ),
  )
  return upcomingRounds(perApp.flat())
}

function Dashboard() {
  const [apps, setApps] = useState<Application[] | null>(null)
  const [upcoming, setUpcoming] = useState<UpcomingRound[]>([])
  const [loadError, setLoadError] = useState('')
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState('')

  useEffect(() => {
    let live = true

    async function load() {
      const list = await apiFetch<Application[]>('/api/applications')
      if (!live) return
      setApps(list)

      const next = await fetchUpcoming(list)
      if (live) setUpcoming(next)
    }

    load().catch(
      (err: unknown) =>
        live &&
        setLoadError(
          readable(err instanceof Error ? err.message : '') ||
            'Your applications could not be loaded.',
        ),
    )

    return () => {
      live = false
    }
  }, [])

  /** Write the invented world into this account, then show it. Refused if either already exists. */
  async function loadSample() {
    setSeeding(true)
    setSeedError('')
    try {
      await apiFetch('/api/sample', { method: 'POST' })
      const list = await apiFetch<Application[]>('/api/applications')
      setApps(list)
      setUpcoming(await fetchUpcoming(list))
    } catch (err) {
      setSeedError(
        readable(err instanceof Error ? err.message : '') || 'The sample could not be loaded.',
      )
    } finally {
      setSeeding(false)
    }
  }

  /** Move one record to another column, and keep the board on what the server stored. */
  async function move(app: Application, next: AppStatus) {
    const updated = await apiFetch<Application>(`/api/applications/${app.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(statusChange(app, next)),
    })
    setApps((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? prev)
  }

  /**
   * Delete one record for good. The card asked first; this only runs once it did. The board
   * and the strip are both pruned rather than refetched — the server answers 204 with nothing
   * to reconcile, and a round belonging to a deleted application has nowhere left to point.
   */
  async function remove(app: Application) {
    await apiFetch(`/api/applications/${app.id}`, { method: 'DELETE' })
    setApps((prev) => prev?.filter((a) => a.id !== app.id) ?? prev)
    setUpcoming((prev) => prev.filter((u) => u.app.id !== app.id))
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-10 pb-16">
      <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">
        Applications
      </h1>

      {loadError && (
        <p role="alert" className="mt-6 text-[0.9375rem] text-danger">
          {loadError}
        </p>
      )}

      {!apps && !loadError && (
        <p className="mt-6 text-sm text-ink-3" aria-busy="true">
          Reading your applications…
        </p>
      )}

      {apps?.length === 0 && (
        <div className="mt-6 max-w-[54ch]">
          <p className="text-[0.9375rem] leading-relaxed text-ink-2">
            Nothing tracked yet. An application starts from the link to a posting — or from the
            text of one, when the site won’t hand it over.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/applications/new" className="btn btn-primary">
              New application
            </Link>
            {/* Quiet, and second: it fills this account with an invented candidate and one
                worked application, which is the fastest way to see what the product does and
                the wrong way to start using it. */}
            <button
              type="button"
              className="btn btn-quiet"
              disabled={seeding}
              onClick={() => void loadSample()}
            >
              {seeding ? 'Loading sample…' : 'Load sample data'}
            </button>
          </div>
          <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-3">
            The sample is a fictional candidate, a fictional posting and one interview — enough
            to see a drafted answer and its sources.
          </p>
          {seedError && (
            <p role="alert" className="mt-2.5 text-[0.8125rem] text-danger">
              {seedError}
            </p>
          )}
        </div>
      )}

      {apps && apps.length > 0 && (
        <>
          <UpcomingStrip items={upcoming} />
          <PipelineBoard apps={apps} onMove={move} onRemove={remove} />
        </>
      )}
    </main>
  )
}
