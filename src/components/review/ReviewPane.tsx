'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch } from '@/lib/apiFetch'
import { countUnits } from '@/lib/countText'
import { readable } from '@/lib/readable'
import type { Application, Citation, ClarifyAnswer, Fact, Question } from '@/lib/types'
import { AskHumanQueue } from '@/components/review/AskHumanQueue'
import {
  ClarifyCards,
  seedCard,
  seedSelections,
  toClarifyAnswer,
  type CardState,
} from '@/components/review/ClarifyCards'
import { CitationText } from '@/components/review/CitationText'
import { Working } from '@/components/Working'

/**
 * One question, and everything the human does with it: read the drafted answer and the facts
 * under it, tell the agent what only they know, and edit the answer they will actually submit.
 *
 * The final answer is the one piece of local, unsaved state on the screen. It is seeded from
 * the draft (or from an already-saved final), and it re-seeds whenever a new draft arrives —
 * asking for a fresh draft is an explicit act, so it is allowed to replace what's in the box.
 * Every other change the human makes to the box is theirs until they save it, and the page is
 * told there is unsaved work so leaving is guarded.
 *
 * The parent remounts this per question (keyed on the index and the length of the list), so
 * none of this state leaks from one question to the next.
 */

interface Props {
  app: Application
  index: number
  factsById: Map<string, Fact>
  /** Replace one question after a draft or a finalize that answered with just the question. */
  onQuestionChange: (index: number, question: Question) => void
  /** Replace the whole record after a finalize that answered with the updated application. */
  onAppChange: (app: Application) => void
  /**
   * Re-read the profile, resolving when the new facts are on the page. A story told here
   * becomes facts in the fact bank mid-draft, and the page's copy of it is one request out of
   * date the moment that happens — a citation onto a fact it has never seen renders as "no
   * longer in your profile", so the draft waits for this before it goes on screen.
   */
  onFactsChanged: () => void | Promise<void>
  /** Tell the page whether this question holds unsaved work — the answer box or the story. */
  onDirtyChange: (dirty: boolean) => void
  /** Drop this question from the form. Resolves once it is gone, rejects with a message. */
  onDelete: () => Promise<void>
}

/** The limit this answer must hit, computed without dragging the server-only flow into the client. */
function statedLimit(q: Question): { limit: number; unit: 'words' | 'chars' } | null {
  const { limit, unit } = q.constraints
  return limit !== undefined && unit !== undefined ? { limit, unit } : null
}

const message = (err: unknown): string => (err instanceof Error ? err.message : '')

/**
 * What the draft endpoint answers with: the question it wrote, and what the story it was
 * given did to the profile. `storyLearned` is false when nothing was told, when the same
 * telling was posted back unchanged, and when the extraction itself failed — so the note
 * below only ever claims a save that actually happened.
 */
interface DraftResponse {
  question: Question
  newFacts: number
  storyLearned: boolean
}

// The two waits on this screen. Both are a model reading something, so both take the shape
// every wait in the product takes; the lines are what the flow is actually doing.
const DRAFT_STAGES = [
  { at: 0, text: 'Writing the answer…' },
  { at: 5000, text: 'Checking every claim against your facts…' },
]
const DRAFT_NOTE = 'Usually takes 10–20 seconds.'

const CLARIFY_STAGES = [
  { at: 0, text: 'Reading the role…' },
  { at: 4000, text: 'Working out what only you can decide…' },
]
const CLARIFY_NOTE = 'Usually takes 5–15 seconds.'

export function ReviewPane({
  app,
  index,
  factsById,
  onQuestionChange,
  onAppChange,
  onFactsChanged,
  onDirtyChange,
  onDelete,
}: Props) {
  const question = app.questions[index]
  // What a save compares against: the saved final if there is one, else the draft it was seeded
  // from. When the box matches this, there is nothing unsaved to lose.
  const baseline = question.final ?? question.draft?.text ?? ''

  const [finalText, setFinalText] = useState(baseline)
  // Re-seed the box when a new draft (or a saved final) arrives — but not while the person types,
  // which never moves the baseline. Adjusting state during render (rather than in an effect) is
  // React's supported way to reset state from a changing input, and it avoids a flash of the old
  // text. Asking for a fresh draft is deliberate, so it is allowed to replace what's in the box.
  const [seededFrom, setSeededFrom] = useState(baseline)
  if (seededFrom !== baseline) {
    setSeededFrom(baseline)
    setFinalText(baseline)
  }

  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNote, setSaveNote] = useState('')
  const [active, setActive] = useState<Citation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Kept apart from `saveError`: the clipboard failing has nothing to do with the answer being
  // stored, and one line doing both jobs would tell the person their work was lost when it isn't.
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The positioning round. `question.clarify` is the persisted set of questions the agent is
  // asking this time; `selections` is the human's unsaved answer to it, seeded from each
  // question's recommendation (or from the stored answers, on a reload). The setup panel is
  // open while those cards are the thing on screen — before a first draft, or reopened to adjust.
  const clarifyQuestions = question.clarify ?? []
  const [setupOpen, setSetupOpen] = useState(clarifyQuestions.length > 0 && !question.draft)
  const [selections, setSelections] = useState<Record<string, CardState>>(() =>
    seedSelections(clarifyQuestions, question.clarifyAnswers ?? []),
  )
  const [clarifying, setClarifying] = useState(false)
  const [clarifyError, setClarifyError] = useState('')
  const [clarifyNote, setClarifyNote] = useState('')

  // The candidate's own telling. It is persisted on the question, so it survives a re-draft,
  // switching question and coming back tomorrow; the box opens already open when there is one
  // to read. Not guarded as unsaved work like the answer below: it is sent with every draft
  // from here on, and the draft is what saves it.
  const [story, setStory] = useState(question.story ?? '')
  const [storyOpen, setStoryOpen] = useState((question.story ?? '').trim() !== '')
  const [storyNote, setStoryNote] = useState('')

  const sourceRef = useRef<HTMLDivElement>(null)

  const dirty = finalText !== baseline
  // A story typed but not yet drafted with lives only in this component, and the pane is
  // remounted per question — so switching question or closing the tab would take it with no
  // warning at all. It is unsaved work like the answer box, and guarded the same way. Kept
  // separate from `dirty` because the two are lost to different things: the answer box is
  // what a new draft overwrites, and the story is what a new draft SAVES.
  const storyDirty = story !== (question.story ?? '')
  useEffect(() => {
    onDirtyChange(dirty || storyDirty)
    return () => onDirtyChange(false)
  }, [dirty, storyDirty, onDirtyChange])

  // Bring the fact into view when a citation is selected — on a narrow screen the source panel
  // sits below the answer, out of sight until scrolled to.
  useEffect(() => {
    if (active) sourceRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  // The pane is remounted per question, so a "Copied" that has not timed out yet would otherwise
  // set state on a component that is gone.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )

  async function draft(
    humanAnswers: { question: string; answer: string }[],
    clarifyAnswers?: ClarifyAnswer[],
  ): Promise<boolean> {
    // A new draft moves the baseline, and the box below re-seeds from it (see `seededFrom`) —
    // so unsaved edits in it would be replaced without anybody saying so. Only while there is
    // no saved final: once there is, the baseline is that final and a new draft leaves the box
    // alone. Every route to a draft comes through here, so this is the one place that asks.
    if (
      dirty &&
      question.final === undefined &&
      !window.confirm('Drafting again replaces your unsaved edits to the answer below. Continue?')
    ) {
      return false
    }
    setDrafting(true)
    setDraftError('')
    setStoryNote('')
    try {
      const res = await apiFetch<DraftResponse>(
        `/api/applications/${app.id}/questions/${index}/draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // clarifyAnswers is omitted for a plain draft, which leaves any stored positioning
          // untouched; it is sent only when the human has just settled the cards. The story
          // always goes: sending it back unchanged is how it stays on the question, and the
          // server is what decides it has already been learned.
          body: JSON.stringify({ humanAnswers, story, ...(clarifyAnswers ? { clarifyAnswers } : {}) }),
        },
      )
      setActive(null)
      if (res.storyLearned) {
        // BEFORE the draft goes on screen, not after. Its citations point at facts the page
        // has never seen, and one that does not resolve renders as "no longer in your
        // profile" — a story-backed answer flashing "source not found" is the opposite of
        // what this whole mechanism is for.
        await onFactsChanged()
        // Ten facts or none, the person told it something and deserves to be told what
        // happened to it. Silence here reads as "that did nothing".
        const facts = res.newFacts === 1 ? '1 new fact' : `${res.newFacts} new facts`
        setStoryNote(
          res.newFacts > 0
            ? `Saved to your profile — ${facts}.`
            : 'Story saved — nothing new to learn from it.',
        )
      }
      onQuestionChange(index, res.question)
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDraftError('The form was re-parsed — set up and draft again.')
      } else {
        // A 422 carries the flow's own account of why it refused its output (over the limit, a
        // span that isn't in the answer, a fact that isn't in the profile). Shown verbatim.
        setDraftError(readable(message(err)) || 'The draft could not be written. Try again.')
      }
      return false
    } finally {
      setDrafting(false)
    }
  }

  async function saveFinal() {
    setSaving(true)
    setSaveError('')
    setSaveNote('')
    try {
      const res = await apiFetch<unknown>(
        `/api/applications/${app.id}/questions/${index}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ final: finalText }),
        },
      )
      // Tolerant of the shape Task 13 lands on: the whole record, just the question, or neither.
      if (res && typeof res === 'object' && 'questions' in res) {
        onAppChange(res as Application)
      } else if (res && typeof res === 'object' && 'q' in res) {
        onQuestionChange(index, res as Question)
      } else {
        onQuestionChange(index, { ...question, final: finalText, status: 'final' })
      }
      setSaveNote('Saved as your final answer.')
    } catch (err) {
      const notWired =
        err instanceof ApiError &&
        err.status === 404 &&
        !(typeof err.body === 'object' && err.body !== null && 'draftFailed' in err.body)
      if (notWired) {
        setSaveError('Saving isn’t wired yet — this lands in the next step.')
      } else {
        setSaveError(readable(message(err)) || 'Saving failed. Your text is still here — try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * Put whatever is in the box on the clipboard. Not the saved final — what is on screen is what
   * the person is about to paste into the form, and the form does not care whether it was saved.
   * The label carries the confirmation for two seconds; clicking again restarts that.
   */
  async function copyFinal() {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(finalText)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // No permission, or not a secure context. There is nothing to retry for them, so the line
      // says what they can do instead.
      setCopied(false)
      setCopyError('Couldn’t copy — select the text and copy it yourself.')
    }
  }

  /**
   * Drop the question from the form. Nothing here is recoverable — the draft, the story and
   * whatever is in the answer box all go — so the confirm names them instead of asking a
   * generic "are you sure". That one sentence covers the unsaved answer too, which is why
   * there is no second prompt on top of it.
   */
  async function remove() {
    if (!window.confirm('Delete this question? Its draft and your answer go with it.')) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDelete()
      // `deleting` is deliberately left set on success: the list is one shorter, so this pane
      // is being remounted, and clearing it would put the button back for that one frame.
    } catch (err) {
      setDeleteError(readable(message(err)) || 'That didn’t delete. Try again.')
      setDeleting(false)
    }
  }

  const setCard = (id: string, next: CardState) =>
    setSelections((prev) => ({ ...prev, [id]: next }))

  // Ask the agent to read the role and propose the positioning calls. A fresh round supersedes
  // any earlier one and clears its stored answers (Task 22), so the cards are always seeded
  // afresh here. Zero questions means the agent is confident — nothing to set up, so it drafts.
  async function clarify() {
    setClarifying(true)
    setClarifyError('')
    setClarifyNote('')
    try {
      const updated = await apiFetch<Question>(
        `/api/applications/${app.id}/questions/${index}/clarify`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      onQuestionChange(index, updated)
      const qs = updated.clarify ?? []
      if (qs.length === 0) {
        setSetupOpen(false)
        setClarifyNote('Nothing to set up for this one — drafting directly.')
      } else {
        setSelections(seedSelections(qs, updated.clarifyAnswers ?? []))
        setSetupOpen(true)
      }
      // Clear the reading state before drafting, so the draft's own progress shows through.
      setClarifying(false)
      if (qs.length === 0) await draft([])
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setClarifyError('The form was re-parsed — set up and draft again.')
      } else {
        setClarifyError(readable(message(err)) || 'Setting up this answer didn’t work. Try again.')
      }
      setClarifying(false)
    }
  }

  // Draft against the settled cards. Their selections are unsaved until now; the panel stays
  // open if the draft fails, so nothing the human chose is lost to a transient error.
  async function draftWithSelections() {
    const answers = clarifyQuestions.map((q) => toClarifyAnswer(q, selections[q.id] ?? seedCard(q)))
    if (await draft([], answers)) setSetupOpen(false)
  }

  // Reopen the current round to tweak a choice and re-draft — no new questions, nothing discarded.
  function adjustSetup() {
    setSelections(seedSelections(clarifyQuestions, question.clarifyAnswers ?? []))
    setSetupOpen(true)
  }

  // A fresh round discards the positioning answers already given (Task 22), so it is confirmed.
  // It sits inside the reopened panel rather than beside the draft: reaching it means reading
  // the questions already asked first, which is what makes "ask me different ones" a judgement
  // about them rather than the nearest link to the answer you don't like.
  function reclarify() {
    if (
      window.confirm(
        'This asks a fresh round and discards your current positioning answers — continue?',
      )
    ) {
      void clarify()
    }
  }

  // The cards are the thing on screen, in place of the draft and the controls under it.
  const panelOpen = setupOpen && clarifyQuestions.length > 0

  // Which job the amber box is doing. Before a draft it is the optional telling that would make
  // a thin answer real; after one it is the only way to say what the answer got wrong, so it
  // carries the adjustment and stops presenting itself as an extra. Not while the panel is
  // reopened over a draft: the Adjust button that opens this box is not rendered then, so the
  // box goes back to being the invitation — and to re-drafting from the cards, not past them.
  const adjusting = question.draft !== undefined && !panelOpen

  const stated = statedLimit(question)
  const unit = stated?.unit ?? question.constraints.unit ?? 'words'
  const count = countUnits(finalText, unit)
  const over = stated ? count > stated.limit : false
  const openAsks = question.askHuman.length > 0
  const activeFact = active ? factsById.get(active.factId) : undefined

  return (
    <section aria-labelledby="answer-heading" className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Question</p>
          <h2 id="answer-heading" className="mt-1.5 max-w-[62ch] font-display text-[1.375rem] leading-snug tracking-tight text-ink">
            {question.q}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            {stated ? (
              <span className="tnum">
                Limit {stated.limit} {stated.unit}
              </span>
            ) : (
              <span>No stated limit</span>
            )}
            <span aria-hidden="true">·</span>
            <span>{question.constraints.required ? 'Required' : 'Optional'}</span>
          </p>
        </div>
        {/* Against the question it removes, not down among the answer's own controls: it acts
            on the whole row, and danger red is what this product spends on destruction. */}
        <button
          type="button"
          className="btn btn-danger"
          disabled={deleting}
          onClick={() => void remove()}
        >
          {deleting ? 'Deleting…' : 'Delete question'}
        </button>
      </header>
      {deleteError && (
        <p role="alert" className="mt-2 max-w-[62ch] text-sm text-danger">
          {deleteError}
        </p>
      )}

      {/* Draft on the left, the fact behind a selected phrase on the right where there's room;
          stacked on anything narrower, the fact appearing just under the answer. */}
      <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-start xl:gap-8">
        <div className="min-w-0">
          {panelOpen ? (
            // The positioning round is what's on screen: the cards, then draft-with-these.
            <section aria-labelledby="setup-heading" className="min-w-0">
              <h3
                id="setup-heading"
                className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
              >
                Set up this answer
              </h3>
              <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-2">
                A few positioning calls only you can make. The recommended pick is already
                selected — change what you’d put differently, then draft.
              </p>
              <div className="mt-4">
                <ClarifyCards
                  questions={clarifyQuestions}
                  selections={selections}
                  onChange={setCard}
                  busy={drafting || clarifying}
                />
              </div>
              {/* A fresh round can now be asked for from in here, so everything in the panel
                  is disabled while one is being read — these cards and the draft they would
                  feed are exactly what it is about to replace. */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={drafting || clarifying}
                  onClick={() => void draftWithSelections()}
                >
                  {drafting ? 'Drafting…' : 'Draft with these'}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={drafting || clarifying}
                  onClick={() => setSetupOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-link text-sm"
                  disabled={drafting || clarifying}
                  onClick={reclarify}
                >
                  Ask different questions
                </button>
              </div>
            </section>
          ) : question.draft ? (
            <>
              <CitationText
                text={question.draft.text}
                citations={question.draft.citations}
                factsById={factsById}
                active={active}
                onSelect={setActive}
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                {/* The loud action on a finished draft is saying what it got wrong, not asking
                    for the same thing again — a re-draft with nothing new to go on writes
                    another version of the same answer. Hidden while the box is open, because
                    the box is where it went. */}
                {!storyOpen && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={drafting || clarifying}
                    onClick={() => setStoryOpen(true)}
                  >
                    Adjust
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={drafting || clarifying}
                  onClick={() => void draft([])}
                >
                  {drafting ? 'Drafting…' : 'Re-draft'}
                </button>
                <p className="max-w-[52ch] text-sm text-ink-3">
                  {question.draft.citations.length > 0
                    ? 'Underlined phrases are cited — select one to see the fact behind it.'
                    : 'Nothing in this draft needed a citation.'}
                </p>
              </div>

              {/* Positioning re-entry: reopen the round already answered, or set up for the
                  first time on a draft that skipped it. Asking a different round is a discard,
                  so it lives inside the panel where those answers are on screen. */}
              {clarifyQuestions.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="text-ink-3">This answer was set up with your positioning.</span>
                  <button
                    type="button"
                    className="btn-link"
                    disabled={drafting || clarifying}
                    onClick={adjustSetup}
                  >
                    Ask me again
                  </button>
                </div>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn-link text-sm"
                    disabled={drafting || clarifying}
                    onClick={() => void clarify()}
                  >
                    {clarifying ? 'Reading the role…' : 'Set up this answer'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="border border-dashed border-line px-5 py-8">
              <p className="max-w-[56ch] text-[0.9375rem] leading-relaxed text-ink-2">
                No draft yet. Setting up reads what the role screens for and asks the positioning
                calls only you can make — then the draft leads with your angle, every claim cited
                to a fact. Or draft straight from your profile.
              </p>
              {/* While the role is being read the choices are gone but the explanation stays:
                  what replaces them is the progress below, not an empty box. */}
              {!clarifying && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                {clarifyQuestions.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={drafting}
                    onClick={adjustSetup}
                  >
                    Resume setup
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={drafting}
                    onClick={() => void clarify()}
                  >
                    Set up this answer
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={drafting}
                  onClick={() => void draft([])}
                >
                  {drafting ? 'Drafting…' : 'Draft without setup'}
                </button>
              </div>
              )}
            </div>
          )}

          {/* Amber, because it means what amber means everywhere here: only you know this. It
              sits under whichever of the three states is on screen — setup, a draft, or the
              empty box — because the moment a person realises the draft is missing the real
              story is different every time. Collapsed until asked for; open already when
              there is a telling stored. Once there is a draft the collapsed invitation is not
              rendered at all — the Adjust button above is what opens it — so the wrapper drops
              its margin rather than leaving a gap where a link used to be. */}
          <div className={storyOpen || !adjusting ? 'mt-5' : ''}>
            {storyOpen ? (
              <div className="min-w-0 border border-amber bg-amber-soft px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <label
                    htmlFor="story"
                    className="max-w-[58ch] text-[0.9375rem] font-medium leading-snug text-ink"
                  >
                    {adjusting ? 'Adjust this answer' : 'The story behind this answer'}
                  </label>
                  {/* No fill here — the box is already amber-soft, so a filled chip on it is
                      a chip nobody can see. And nothing to mark once there is a draft: fixing
                      it is the work, not an option alongside it. */}
                  {!adjusting && (
                    <span className="shrink-0 text-xs font-medium tracking-wide text-amber">
                      Optional
                    </span>
                  )}
                </div>
                <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-ink-2">
                  {adjusting
                    ? 'Say what’s off — what to change, and what actually happened. It goes into the next draft, and into your profile — so the next question that needs it already has it.'
                    : 'Your resume says what you did. This is where you say what happened. It goes into the next draft, and into your profile — so the next question that needs it already has it.'}
                </p>
                <textarea
                  id="story"
                  rows={7}
                  disabled={drafting || clarifying}
                  className="field field-boxed mt-3 px-3 py-2 text-[0.9375rem] leading-relaxed"
                  placeholder={
                    adjusting
                      ? 'Rough is fine — what to change, what happened, what came of it. I’ll write it properly and remember it.'
                      : 'Rough is fine — what happened, what you did, what came of it. I’ll write it properly and remember it.'
                  }
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {adjusting ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={drafting || clarifying || story.trim() === ''}
                        onClick={() => void draft([])}
                      >
                        Re-draft with this
                      </button>
                      {/* Puts the text back to what is stored, not just out of sight: the
                          unsaved-work guard watches this box, and it should not go on warning
                          about a telling the person has just taken back. */}
                      <button
                        type="button"
                        className="btn btn-quiet"
                        disabled={drafting || clarifying}
                        onClick={() => {
                          setStoryOpen(false)
                          setStory(question.story ?? '')
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-link text-sm"
                        disabled={drafting || clarifying}
                        onClick={() => setStoryOpen(false)}
                      >
                        Hide
                      </button>
                      <p className="text-sm text-ink-2">It goes in with your next draft.</p>
                    </>
                  )}
                </div>
              </div>
            ) : adjusting ? null : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  className="btn-link text-sm"
                  disabled={drafting || clarifying}
                  onClick={() => setStoryOpen(true)}
                >
                  Tell the story behind this answer
                </button>
                <span className="bg-amber-soft px-2 py-0.5 text-xs font-medium tracking-wide text-amber">
                  Optional
                </span>
              </div>
            )}
            {/* Mounted whether or not there is anything to say, like `Working`: a live region
                that arrives already carrying its message is not announced by several screen
                readers, and "saved to your profile" is the one thing here worth hearing. */}
            <p className="mt-2 text-sm text-accent empty:mt-0" role="status" aria-live="polite">
              {storyNote}
            </p>
          </div>

          {/* One live region for the whole column, mounted with the pane rather than with the
              wait it reports — see `Working`. The two waits share it, which is only honest
              because nothing can start a draft while the role is being read: every control that
              would is disabled on `clarifying` or hidden by it, and the zero-question handoff
              clears `clarifying` in the same render that sets `drafting`. */}
          <Working
            busy={drafting || clarifying}
            className="mt-4 empty:mt-0"
            stages={clarifying ? CLARIFY_STAGES : DRAFT_STAGES}
            note={clarifying ? CLARIFY_NOTE : DRAFT_NOTE}
          />

          {clarifyNote && (
            <p className="mt-3 text-sm text-ink-3" aria-live="polite">
              {clarifyNote}
            </p>
          )}
          {clarifyError && (
            <p role="alert" className="mt-4 max-w-[62ch] text-sm text-danger">
              {clarifyError}
            </p>
          )}
          {draftError && (
            <p role="alert" className="mt-4 max-w-[62ch] text-sm text-danger">
              {draftError}
            </p>
          )}
        </div>

        <aside
          ref={sourceRef}
          aria-live="polite"
          className="mt-6 min-w-0 border border-line bg-surface px-4 py-4 xl:sticky xl:top-6 xl:mt-0"
        >
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Source</p>
          {active && activeFact ? (
            <div className="mt-2">
              <p className="tnum text-xs text-accent">{active.factId}</p>
              <p className="mt-1 font-display text-[0.9375rem] leading-relaxed text-ink">
                {activeFact.claim}
              </p>
              {activeFact.sourceSnippet && (
                <p className="mt-2 border-t border-line pt-2 text-sm leading-relaxed text-ink-2">
                  “{activeFact.sourceSnippet}”
                </p>
              )}
            </div>
          ) : active ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              That fact is no longer in your profile.
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-ink-3">
              Select an underlined phrase to see the fact it’s drawn from.
            </p>
          )}
        </aside>
      </div>

      {openAsks && (
        <AskHumanQueue
          // Remount on each new draft so the inputs re-seed from the stored answers.
          key={question.draft?.text ?? 'no-draft'}
          asks={question.askHuman}
          busy={drafting || clarifying}
          onSubmit={(answers) => void draft(answers)}
        />
      )}

      <section aria-labelledby="final-heading" className="mt-10 border-t border-line-strong pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <div>
            <h3 id="final-heading" className="font-display text-lg tracking-tight text-ink">
              Your answer
            </h3>
            <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-ink-2">
              This is what you’ll paste into the form. Edit it freely — nothing here is sent
              anywhere until you save it.
            </p>
          </div>
          {/* Not a live region: a count that speaks on every keystroke buries the page under
              itself. Crossing the limit is the only state change worth saying out loud, and
              the status line under the box says it. */}
          <p className={`tnum text-sm ${over ? 'text-danger' : 'text-ink-3'}`}>
            {stated ? `${count}/${stated.limit} ${stated.unit}` : `${count} ${unit}`}
          </p>
        </div>

        <label htmlFor="final-answer" className="sr-only">
          Your answer
        </label>
        <textarea
          id="final-answer"
          rows={8}
          className="field field-boxed mt-3 px-3 py-2 text-[0.9375rem] leading-relaxed"
          placeholder="Draft an answer above, or write your own here."
          value={finalText}
          onChange={(e) => {
            setFinalText(e.target.value)
            // "Saved as your final answer." stops being true at the first keystroke, and while
            // it stands it hides the line under it — including the over-limit warning, which is
            // now the only place crossing the limit is said out loud.
            if (saveNote) setSaveNote('')
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || finalText.trim() === ''}
            onClick={() => void saveFinal()}
          >
            {saving ? 'Saving…' : 'Save final'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={finalText.trim() === ''}
            onClick={() => void copyFinal()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {copyError && (
            <p role="alert" className="max-w-[52ch] text-sm text-danger">
              {copyError}
            </p>
          )}
          <p
            role="status"
            aria-live="polite"
            className={`text-sm ${saveError ? 'text-danger' : saveNote ? 'text-accent' : 'text-ink-3'}`}
          >
            {saveError ||
              saveNote ||
              (over
                ? 'Over the limit — trim it before you paste it in.'
                : dirty
                  ? 'Unsaved edits'
                  : 'Nothing unsaved')}
          </p>
        </div>
      </section>
    </section>
  )
}
