'use client'

import { useRouter } from 'next/navigation'
import { use, useCallback, useEffect, useState } from 'react'
import { AppShell, useUnsavedChanges } from '@/components/AppShell'
import { InterviewsSection } from '@/components/interviews/InterviewsSection'
import { ProcessSection } from '@/components/process/ProcessSection'
import { QuestionList } from '@/components/review/QuestionList'
import { ReviewPane } from '@/components/review/ReviewPane'
import { QuestionsIntake } from '@/components/wizard/QuestionsIntake'
import { apiFetch } from '@/lib/apiFetch'
import { readable } from '@/lib/readable'
import type { Application, Fact, InterviewRound, Profile, Question } from '@/lib/types'

/**
 * The application workspace: the screen where a form gets answered.
 *
 * A form with no questions yet opens the intake. Once it has questions it becomes two columns —
 * the list of questions on the left, the selected question's answer on the right — and stays
 * that way. Re-parsing is possible from here but never quiet: it replaces the whole list, so it
 * is put behind an intake that says what will be lost.
 *
 * The one piece of unsaved state on the page is the answer being edited. The selected question's
 * pane reports whether its box holds edits; the page guards both leaving the page (through the
 * shell) and switching to another question against losing them.
 */

export default function ApplicationPage({ params }: PageProps<'/applications/[id]'>) {
  const { id } = use(params)
  return (
    <AppShell>
      <ApplicationWorkspace id={id} />
    </AppShell>
  )
}

function ApplicationWorkspace({ id }: { id: string }) {
  const router = useRouter()
  const [app, setApp] = useState<Application | null>(null)
  // Facts indexed by id so a citation can show the claim and source behind it. A failed profile
  // load degrades citations to "source not found" rather than blocking the whole screen.
  const [factsById, setFactsById] = useState<Map<string, Fact>>(new Map())
  // The rounds logged against this application, held once for the whole screen: the process
  // map pins them onto its ledger and the interviews section draws them as cards. A copy in
  // each would drift the moment one was logged.
  const [rounds, setRounds] = useState<InterviewRound[]>([])
  const [loadError, setLoadError] = useState('')

  const [selected, setSelected] = useState(0)
  const [selectedDirty, setSelectedDirty] = useState(false)
  const [reparsing, setReparsing] = useState(false)
  const [adding, setAdding] = useState(false)

  const [marking, setMarking] = useState(false)
  const [markError, setMarkError] = useState('')
  const [logging, setLogging] = useState(false)

  /**
   * Re-read the fact bank. Best-effort: citations still render without it, just without their
   * sources. Called on load, and again whenever a story told on the review pane has just been
   * learned into the profile — those facts are what the new draft's citations point at, and
   * until this runs the map here has never seen them. Returns its promise, so the pane can
   * wait for the new facts before putting the draft that cites them on screen.
   */
  const loadFacts = useCallback(
    () =>
      apiFetch<Profile>('/api/profile')
        .then((profile) => setFactsById(new Map(profile.facts.map((f) => [f.id, f]))))
        // Leave the map as it is; a citation with no fact behind it says so on screen.
        .catch(() => {}),
    [],
  )

  /**
   * Re-read the logged rounds. Best-effort like the facts: the questions below are the rest of
   * the screen, and a list that failed to load should not take the page down with it.
   */
  const loadRounds = useCallback(
    () =>
      apiFetch<InterviewRound[]>(`/api/applications/${id}/interviews`)
        .then(setRounds)
        .catch(() => {}),
    [id],
  )

  useEffect(() => {
    let live = true
    apiFetch<Application>(`/api/applications/${id}`)
      .then((next) => live && setApp(next))
      .catch(
        (err: unknown) =>
          live &&
          setLoadError(
            readable(err instanceof Error ? err.message : '') ||
              'That application could not be loaded.',
          ),
      )
    void loadFacts()
    void loadRounds()
    return () => {
      live = false
    }
  }, [id, loadFacts, loadRounds])

  /**
   * Re-read the record after a round is logged: the POST moved its status and timeline. The
   * rounds are re-read with it, so the list the screen goes on drawing is the server's and not
   * whatever the optimistic append left behind.
   */
  const reloadApp = useCallback(() => {
    apiFetch<Application>(`/api/applications/${id}`)
      .then(setApp)
      // The round is already on screen; a stale header is not worth an error over it.
      .catch(() => {})
    void loadRounds()
  }, [id, loadRounds])

  useUnsavedChanges(selectedDirty)

  const applyQuestion = useCallback((index: number, question: Question) => {
    setApp((prev) =>
      prev ? { ...prev, questions: prev.questions.map((q, i) => (i === index ? question : q)) } : prev,
    )
  }, [])

  /** Move to another question, guarding unsaved work on the one being left. */
  function select(next: number) {
    if (
      next !== selected &&
      selectedDirty &&
      !window.confirm('Switch questions? Your unsaved edits will be lost.')
    ) {
      return
    }
    setSelected(next)
  }

  /**
   * Add the questions the parse missed, through the same intake the form started with — it
   * reads pasted text and screenshots, and appends what it finds. It takes over the whole
   * screen, so it unmounts the pane and its unsaved answer along with it: guarded like a
   * question switch, for the same reason and with the same specific sentence.
   */
  function startAdding() {
    if (selectedDirty && !window.confirm('Add questions? Your unsaved edits will be lost.')) return
    setAdding(true)
  }

  /**
   * Drop one question the form does not actually ask. The whole remaining array is sent, so
   * every other question's draft and final survive the PATCH — the same last-writer-wins the
   * mark-applied path accepts on a single-user MVP. Throws a readable message on failure so
   * the pane can surface it; the pane has already asked before calling this.
   */
  async function deleteQuestion(index: number) {
    if (!app) return
    try {
      const updated = await apiFetch<Application>(`/api/applications/${app.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: app.questions.filter((_, i) => i !== index) }),
      })
      setApp(updated)
      // Deleting the last one leaves `selected` past the end of a shorter list. `current`
      // clamps for the render, but `select` compares against `selected` — so the row already
      // on screen would read as a switch and warn about edits nothing is about to lose.
      setSelected((s) => Math.min(s, Math.max(0, updated.questions.length - 1)))
    } catch (err) {
      throw new Error(
        readable(err instanceof Error ? err.message : '') || 'That didn’t delete. Try again.',
      )
    }
  }

  /**
   * Mark it applied and go back to the board. The record has nothing left to do on this
   * screen once it is submitted, and what a person wants next is to see where it now sits —
   * so the success leaves the page. The router does not consult the shell's unsaved-changes
   * guard, so the one piece of unsaved work here is asked about first, before the write.
   */
  async function markApplied() {
    if (!app) return
    if (
      selectedDirty &&
      !window.confirm('Mark applied and go back? Your unsaved edits will be lost.')
    ) {
      return
    }
    setMarking(true)
    setMarkError('')
    try {
      const updated = await apiFetch<Application>(`/api/applications/${app.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'applied',
          timeline: [...app.timeline, { event: 'applied', at: new Date().toISOString() }],
        }),
      })
      setApp(updated)
      // `marking` is deliberately left set: the page is leaving, and clearing it would put
      // "Mark applied" back on the button for the frame before the navigation lands.
      router.push('/')
    } catch (err) {
      setMarkError(readable(err instanceof Error ? err.message : '') || 'That didn’t save. Try again.')
      setMarking(false)
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p role="alert" className="text-[0.9375rem] text-danger">
          {loadError}
        </p>
      </main>
    )
  }

  if (!app) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16" aria-busy="true">
        <p className="text-sm text-ink-3">Opening the record…</p>
      </main>
    )
  }

  const questions = app.questions
  const hasQuestions = questions.length > 0
  const answered = questions.filter((q) => q.status === 'final').length
  // Anything past draft has been sent. Logging an interview moves the record to
  // 'interviewing', and a header that then offered "Mark applied" again would be offering to
  // move it backwards on a record that is plainly further along than that.
  const applied = app.status !== 'draft'
  // Keep the selection in range if a re-parse shortened the list.
  const current = Math.min(selected, Math.max(0, questions.length - 1))

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-10 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-display text-[2rem] leading-tight tracking-tight text-ink">
              {app.company}
            </h1>
            <span className="chip uppercase tracking-[0.12em]">
              {app.status}
            </span>
          </div>
          <p className="mt-1 text-[1.0625rem] text-ink-2">{app.role}</p>
          {hasQuestions && (
            <p className="tnum mt-2 text-sm text-ink-3">
              {answered} of {questions.length} answered
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={logging}
              onClick={() => setLogging(true)}
            >
              Log an interview
            </button>
            {applied ? (
              <span className="text-sm font-medium text-accent">Marked applied</span>
            ) : (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={marking}
                onClick={() => void markApplied()}
              >
                {marking ? 'Marking…' : 'Mark applied'}
              </button>
            )}
          </div>
          {markError && (
            <p role="alert" className="max-w-[24ch] text-right text-sm text-danger">
              {markError}
            </p>
          )}
        </div>
      </header>

      <ProcessSection
        app={app}
        rounds={rounds}
        onResearched={(process) => setApp((prev) => (prev ? { ...prev, process } : prev))}
      />

      <InterviewsSection
        appId={app.id}
        rounds={rounds}
        sources={app.process?.sources}
        open={logging}
        onClose={() => setLogging(false)}
        onLogged={(round) => {
          // On screen before anything comes back — as a card below and as a pin on the ledger
          // above. `reloadApp` then re-reads both the record and the list behind it.
          setRounds((prev) => [...prev, round])
          reloadApp()
        }}
      />

      {!hasQuestions || reparsing || adding ? (
        <QuestionsIntake
          app={app}
          append={adding}
          onParsed={(next) => {
            // An append lands on the first question it just added — that is what the person
            // came here to write. Read before the state moves, since `app` is the pre-parse
            // record; `current` clamps, so a parse that added nothing stays in range.
            const landOn = adding ? app.questions.length : 0
            setApp(next)
            setAdding(false)
            setReparsing(false)
            setSelected(landOn)
          }}
          onCancel={
            reparsing ? () => setReparsing(false) : adding ? () => setAdding(false) : undefined
          }
        />
      ) : (
        <>
          <div className="mt-8 flex items-center justify-end">
            <button
              type="button"
              className="btn-link text-sm"
              onClick={() => setReparsing(true)}
            >
              Re-parse form
            </button>
          </div>

          <div className="mt-3 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-8">
            <QuestionList
              questions={questions}
              selected={current}
              onSelect={select}
              onAddQuestion={startAdding}
            />
            {/* Keyed on the length as well as the index: after deleting question k, the one
                that was at k+1 sits at k, and an index-only key would hand a different
                question the old pane's state — its story box, its open setup panel, its
                selected citation. A re-parse and an append move the length too, and both
                want the same fresh pane. */}
            <ReviewPane
              key={`${current}:${questions.length}`}
              app={app}
              index={current}
              factsById={factsById}
              onQuestionChange={applyQuestion}
              onAppChange={setApp}
              onFactsChanged={loadFacts}
              onDirtyChange={setSelectedDirty}
              onDelete={() => deleteQuestion(current)}
            />
          </div>
        </>
      )}
    </main>
  )
}
