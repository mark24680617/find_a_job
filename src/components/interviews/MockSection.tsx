'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Working } from '@/components/Working'
import { Debrief } from '@/components/interviews/Debrief'
import { ApiError, apiFetch } from '@/lib/apiFetch'
import { MAX_QUESTIONS, practiceMode, type StagePlacement } from '@/lib/practice'
import { readable } from '@/lib/readable'
import type { RoleFamily } from '@/lib/research/roleFamily'
import { ROUND_LABEL } from '@/lib/rounds'
import type { Fact, InterviewRound, MockTurn, PracticeMode, ResearchSource } from '@/lib/types'

/**
 * Practice: a mock round for this stage, one question at a time.
 *
 * Three states, and the same ledger in all of them — no session yet, a conversation in progress,
 * and one that has been debriefed. Almost nothing here is decided here: the mode, the stage, the
 * questions, the closing line and the six-question cap are all the route's, and every action
 * answers with the round as stored, so the screen draws the record rather than its own idea of
 * it. What this side owns is what a person is looking at while a model thinks, what they can
 * reach when it lands, and which of their words survived when it didn't.
 *
 * That last one is the reason the failure states have names here. The route writes the
 * candidate's turn before it calls the model, so a turn the model could not write costs a reply
 * and not an answer — and the screen it leaves behind has to say that, offer another try, and go
 * on saying it after a reload, when no request has been made and there is no error to show.
 */

/**
 * The two waits. Sending is one model call reading one answer; ending is one call reading the
 * whole conversation and checking every sentence in it against the fact bank, which is why it is
 * both slower and told in three lines rather than two.
 */
const SEND_STAGES = [
  { at: 0, text: 'Reading your answer…' },
  { at: 4_000, text: 'Deciding what to ask next…' },
]
const SEND_NOTE = 'Usually takes 5–15 seconds.'
const END_STAGES = [
  { at: 0, text: 'Reading the whole conversation…' },
  { at: 6_000, text: 'Checking every claim against your facts…' },
  { at: 15_000, text: 'Writing the feedback…' },
]
const END_NOTE = 'Usually takes 15–30 seconds.'

/*
 * What each failure costs, in the only terms that matter to somebody who has just typed an
 * answer: what is still here. A start that fails writes nothing, an answer that fails keeps the
 * answer, a debrief that fails keeps the conversation.
 */
const START_FAILED = 'The interviewer couldn’t start, and nothing was saved. Try again.'
const TURN_FAILED = 'The interviewer didn’t reply. Your answer is saved — try again.'
const DEBRIEF_FAILED = 'The feedback couldn’t be written. The conversation is still here — try again.'
const RESTARTED = 'This mock was restarted in another tab.'

type Busy = 'starting' | 'sending' | 'ending' | null
type FocusTarget = 'answer' | 'end' | 'retry' | 'debrief' | null

/**
 * The round inside a 422. Both of the mock's deliberate refusals answer with the record as it now
 * stands — the candidate's turn already down for a failed turn, the session still open for a
 * failed debrief — so the screen can show what survived without a reload. Recognised by the body
 * and never by the message: the wording is the server's to change, and the flow's own message is
 * a schema complaint written for us rather than a sentence for a person.
 */
function failedRound(err: unknown): InterviewRound | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null
  const body = err.body
  if (typeof body !== 'object' || body === null) return null
  const { turnFailed, debriefFailed, round } = body as {
    turnFailed?: unknown
    debriefFailed?: unknown
    round?: unknown
  }
  if (turnFailed !== true && debriefFailed !== true) return null
  return typeof round === 'object' && round !== null ? (round as InterviewRound) : null
}

/**
 * The 409, which is the whole state: another tab restarted this mock, so the session on screen no
 * longer exists and nothing on it can be written. Everything else the open state offers would
 * write into a conversation this screen is not showing, so the row replaces all of it.
 *
 * Its own component, and exported, because the only way in is a refused request: the suite has no
 * DOM and makes none, and a state nobody can render is a state nobody can check.
 */
export function Restarted() {
  return (
    <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <p className="text-ink-2">{RESTARTED}</p>
      <button type="button" className="btn-link" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  )
}

/**
 * The conversation as a ledger: ruled rows, no cards, and the eyebrow says who spoke. A question
 * the interviewer copied out of a write-up names the host that reported it, on the same rule the
 * brief follows — an id that resolves to nothing shows nothing, because "reported by" with
 * nobody behind it is the one claim this product may not make.
 *
 * Rendered whatever state the section is in, and handed nothing before a session starts. A live
 * region that arrives in the DOM with its first line already inside it is not announced, and the
 * first question of a mock is the one being answered — so the region is here first and the
 * question is an insertion into it, the way `Working` stays mounted for the same reason.
 */
function Transcript({
  turns,
  mode,
  sources,
}: {
  turns: MockTurn[]
  mode: PracticeMode
  sources: ResearchSource[]
}) {
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  // A question's number is its position among the questions asked. The turn does not carry it,
  // and follow-ups do not count towards it — six questions is what the mock is, not six turns.
  // Counted without reassigning anything during render — `react-hooks/immutability` is an error
  // in this repo, and a running counter mutated inside `map` is exactly what it rejects.
  const isQuestion = (t: MockTurn) => t.role === 'model' && t.kind === 'question'
  const numbers = turns.map((turn, i) =>
    isQuestion(turn) ? turns.slice(0, i + 1).filter(isQuestion).length : 0,
  )

  return (
    // `role="log"`, so a reply arriving at the end is read out and the lines already read are
    // not. The region is the conversation only — the box and the buttons stay outside it. The
    // rules belong to the rows, so with no rows there is nothing to rule and nothing to see.
    <div
      role="log"
      className={turns.length > 0 ? 'grid divide-y divide-line border-y border-line' : undefined}
    >
      {turns.map((turn, i) => {
        const source =
          turn.role === 'model' && turn.sourceId ? sourceById.get(turn.sourceId) : undefined
        return (
          <div key={i} className="min-w-0 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                {turn.role === 'model' ? 'Interviewer' : 'You'}
                {source && (
                  <>
                    {' '}
                    {/* The separator is punctuation, not information — the link says the whole
                        thing on its own, and a screen reader should not read a dot. */}
                    <span aria-hidden="true">·</span>{' '}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-link text-sm font-normal normal-case tracking-normal"
                    >
                      {`reported by ${source.host}`}
                    </a>
                  </>
                )}
              </p>
              {numbers[i] > 0 && (
                <p className="tnum text-sm text-ink-3">{`Question ${numbers[i]} of ${MAX_QUESTIONS}`}</p>
              )}
            </div>
            {turn.role === 'user' && mode === 'coding' ? (
              // Code, kept exactly as it was typed — indentation included, which is half of what
              // the debrief will read it for.
              <pre className="mt-2 max-w-[74ch] overflow-x-auto whitespace-pre-wrap font-mono text-[0.875rem] leading-relaxed text-ink">
                {turn.text}
              </pre>
            ) : (
              <p className="mt-2 max-w-[62ch] whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
                {turn.text}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface Props {
  appId: string
  round: InterviewRound
  /** Where this round sits on the reported loop — the stage the mock interviews for, when it is on it. */
  placement: StagePlacement | null
  family: RoleFamily
  /** The map's sources, so a question the interviewer copied can name who reported it. */
  sources: ResearchSource[]
  facts: Fact[]
  profileFailed: boolean
  /** The employer. Nothing on a round names it, and the debrief's evidence line has to. */
  company: string
  /** Every action answers with the round as stored; the page replaces its copy with that one. */
  onRound: (round: InterviewRound) => void
  onFactsChanged: () => Promise<void>
}

export function MockSection({
  appId,
  round,
  placement,
  family,
  sources,
  facts,
  profileFailed,
  company,
  onRound,
  onFactsChanged,
}: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  // A 409 means another tab restarted this mock, so the session this screen is looking at no
  // longer exists and nothing on it can be written. The only honest way out is a reload.
  const [restarted, setRestarted] = useState(false)
  /** Set before the state update that re-renders, and read once by the effect below. */
  const focusNext = useRef<FocusTarget>(null)

  const answerRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLButtonElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)

  const mock = round.mock
  const turns = round.chat
  // Before a session there is nothing stored to read the mode off, so the client works it out the
  // way the route will — from the mapped stage when the round is on the loop, else from the
  // round's own type. Once a session exists the stored mode is the only one that counts: it is
  // what the interviewer was told, and re-deriving it here could disagree after a re-research.
  const mode: PracticeMode = mock
    ? mock.mode
    : practiceMode(placement?.stage.kind ?? round.roundType, family)
  const last = turns[turns.length - 1]
  const running = mock?.status === 'open'
  const closing = running && last?.role === 'model' && last.kind === 'closing'
  // The interviewer owes a reply: the candidate's turn is stored and the model's never arrived.
  const owed = running && last?.role === 'user'
  const answered = turns.some((t) => t.role === 'user')

  const what = placement?.stage.name ?? ROUND_LABEL[round.roundType]
  const resting =
    `A mock ${what} — the interviewer asks one question at a time, up to six, and follows up the way a real one would. End it after any answer; the feedback comes after.` +
    (mode === 'coding' ? ' Your code is read, not run.' : '')
  // One line for both: the failure a request has just reported, and the state a reply that never
  // came leaves behind — still true tomorrow, when no request has been made. Neither once this
  // mock has been restarted elsewhere: "your answer is saved" would name a conversation that no
  // longer exists, and the 409's own row is the one telling the truth about this screen.
  const line = restarted ? '' : error || (owed ? TURN_FAILED : '')

  // Focus follows the answer rather than the click: an action here replaces most of what is on
  // screen, and leaving the keyboard on a button that has just been taken away strands it at the
  // top of the document.
  //
  // A ref rather than state, and no dependency list. The instruction is one-shot — set just
  // before the state update that re-renders, read and cleared by the first effect after it — and
  // an effect that cleared it with `setState` would both cost a second render and be exactly the
  // synchronous set-in-effect the lint forbids. Nothing moves on the first render: the ref is
  // null until a response lands.
  useEffect(() => {
    const target = focusNext.current
    if (target === null) return
    focusNext.current = null
    const el =
      target === 'answer'
        ? answerRef.current
        : target === 'end'
          ? endRef.current
          : target === 'retry'
            ? retryRef.current
            : // The debrief's own opening paragraph, by id. It belongs to `Debrief`, which gives
              // it `tabIndex={-1}` for exactly this, and the reading starts there rather than at
              // a container above it. A ref would have to be threaded through a component that
              // has no other reason to take one.
              document.getElementById('debrief-overall')
    el?.focus()
  })

  /** Where the keyboard goes, read off the record the route answered with. */
  function focusFor(next: InterviewRound): FocusTarget {
    if (!next.mock) return null
    if (next.mock.status === 'debriefed') return 'debrief'
    const tail = next.chat[next.chat.length - 1]
    if (tail?.role === 'user') return 'retry'
    if (tail?.kind === 'closing') return 'end'
    return 'answer'
  }

  async function post(
    body: { action: 'start' | 'answer' | 'end'; text?: string },
    wait: Exclude<Busy, null>,
    whenItFails: string,
  ) {
    setBusy(wait)
    setError('')
    try {
      const next = await apiFetch<InterviewRound>(
        `/api/applications/${appId}/interviews/${round.id}/mock`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The token is the session this screen is looking at. The route refuses an action
          // carrying anybody else's, which is how a tab left open since yesterday finds out
          // rather than writing into a conversation it is not showing.
          body: JSON.stringify({ ...body, session: round.mock?.startedAt }),
        },
      )
      // Set before the state that re-renders, so the effect above runs after the render that put
      // the element it is reaching for on screen.
      focusNext.current = focusFor(next)
      onRound(next)
      setText('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRestarted(true)
        return
      }
      const stored = failedRound(err)
      if (stored) {
        // The refusal came with the record as it now stands. Taking it means the screen shows
        // what survived instead of what it last drew.
        focusNext.current = focusFor(stored)
        onRound(stored)
      }
      // A recognised refusal gets our sentence, because what a person needs to know is which of
      // their words are still here and only we can say that. Everything else gets the server's
      // own, which is written for them — the 400s here explain exactly what was refused.
      setError(stored ? whenItFails : readable(err instanceof Error ? err.message : '') || whenItFails)
    } finally {
      setBusy(null)
    }
  }

  const start = () => post({ action: 'start' }, 'starting', START_FAILED)
  const send = () => post({ action: 'answer', text }, 'sending', TURN_FAILED)
  // The retry sends no text at all: the candidate's turn is already stored, and sending it again
  // would put it in the transcript twice.
  const retry = () => post({ action: 'answer' }, 'sending', TURN_FAILED)
  const end = () => post({ action: 'end' }, 'ending', DEBRIEF_FAILED)

  /**
   * Tab in a code box types two spaces rather than leaving the field — the one editor habit a
   * plain textarea breaks, and the mock asks for working code. Shift+Tab is left alone, so the
   * keyboard still has a way out of the box.
   */
  function insertTwoSpaces(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const box = e.currentTarget
    const { selectionStart, selectionEnd, value } = box
    const at = selectionStart + 2
    setText(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`)
    // The box is controlled, so React writes the value back on the next render and takes the
    // caret to the end with it. Putting it back after that render keeps typing where it was.
    requestAnimationFrame(() => box.setSelectionRange(at, at))
  }

  return (
    // The children below are a fixed row of slots — each state block is either its element or
    // `false` — so the status region and the error line keep the same DOM nodes as the section
    // moves between states. A `role="status"` that is mounted only when it has something to say
    // is not announced by several screen readers.
    <div className="min-w-0">
      {/* First among the slots, and mounted in every state — see `Transcript`. It holds the
          conversation only while one is running: the debrief keeps its own copy, folded away. */}
      <Transcript turns={running ? turns : []} mode={mode} sources={sources} />

      {!mock && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <p className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">{resting}</p>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy !== null}
            onClick={() => void start()}
          >
            {busy === 'starting' ? 'Starting…' : 'Start a mock round'}
          </button>
        </div>
      )}

      {running && (
        <div className="min-w-0">
          {restarted ? (
            <Restarted />
          ) : (
            <>
              {!closing && !owed && (
                <div className="mt-5">
                  {/* The eyebrow above the last turn says whose turn it is; a visible label here
                      would say it a second time. */}
                  <label htmlFor="mock-answer" className="sr-only">
                    Your answer
                  </label>
                  <textarea
                    id="mock-answer"
                    ref={answerRef}
                    rows={mode === 'coding' ? 14 : 7}
                    className={`field field-boxed px-3 py-2 leading-relaxed ${
                      mode === 'coding' ? 'font-mono text-[0.875rem]' : 'text-[0.9375rem]'
                    }`}
                    placeholder={
                      mode === 'coding'
                        ? 'Your code, and the assumptions you made.'
                        : 'Your answer.'
                    }
                    // Spellcheck underlines every identifier in a code box, which reads as forty
                    // mistakes in something that has none.
                    spellCheck={mode === 'coding' ? false : undefined}
                    disabled={busy !== null}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={mode === 'coding' ? insertTwoSpaces : undefined}
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {!closing && !owed && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={text.trim() === '' || busy !== null}
                    onClick={() => void send()}
                  >
                    {busy === 'sending' ? 'Sending…' : 'Send answer'}
                  </button>
                )}
                {owed && (
                  <button
                    ref={retryRef}
                    type="button"
                    className="btn btn-quiet"
                    disabled={busy !== null}
                    onClick={() => void retry()}
                  >
                    {busy === 'sending' ? 'Sending…' : 'Try again'}
                  </button>
                )}
                {/* Nothing to give feedback on until something has been said. */}
                {answered && (
                  <button
                    ref={endRef}
                    type="button"
                    className="btn btn-quiet"
                    disabled={busy !== null}
                    onClick={() => void end()}
                  >
                    {busy === 'ending' ? 'Ending…' : 'End and get feedback'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {mock?.status === 'debriefed' && (
        <Debrief
          appId={appId}
          round={round}
          sources={sources}
          facts={facts}
          profileFailed={profileFailed}
          company={company}
          stageName={placement?.stage.name}
          onRound={onRound}
          onFactsChanged={onFactsChanged}
        />
      )}

      {line !== '' && (
        <p role="alert" className="mt-3 max-w-[62ch] text-sm text-danger">
          {line}
        </p>
      )}

      {/* Mounted whatever is happening, and empty at rest so it costs no space. The stages swap
          with the wait, which restarts the region's clock — exactly what a different wait wants. */}
      <Working
        busy={busy === 'sending' || busy === 'ending'}
        className="mt-3 empty:mt-0"
        stages={busy === 'ending' ? END_STAGES : SEND_STAGES}
        note={busy === 'ending' ? END_NOTE : SEND_NOTE}
      />

      {/* Start over is a `start`, which needs no token and is allowed at any time. It stays
          offered while the mock is closing or stalled: those are the two states somebody is most
          likely to want out of. */}
      {running && !restarted && (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <button
            type="button"
            className="btn-link"
            disabled={busy !== null}
            onClick={() => void start()}
          >
            {busy === 'starting' ? 'Starting…' : 'Start over'}
          </button>
          <span className="text-ink-3">Discards this conversation.</span>
        </div>
      )}

      {mock?.status === 'debriefed' && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy !== null}
            onClick={() => void start()}
          >
            {busy === 'starting' ? 'Starting…' : 'Start over'}
          </button>
          <span className="text-sm text-ink-3">Discards this conversation and its feedback.</span>
        </div>
      )}
    </div>
  )
}
