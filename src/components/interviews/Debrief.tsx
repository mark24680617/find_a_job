'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ClaimToFact, focusTargetOnClose } from '@/components/interviews/ClaimToFact'
import { apiFetch } from '@/lib/apiFetch'
import { dateOnly } from '@/lib/dates'
import { ROUND_LABEL } from '@/lib/rounds'
import type { Fact, InterviewRound, MockTurn, ResearchSource } from '@/lib/types'

/**
 * What the mock was worth: what landed, where the answer stayed general, and — the part nobody
 * else can settle — every sentence the candidate said about themselves that their fact bank
 * does not support.
 *
 * Amber means one thing in this product: only you know this. So it is on those sentences and
 * on nothing else here. An unsupported sentence is not a lie and is not called one; it is a
 * claim we hold no record of, and the person who said it is the only one who can say whether
 * it is true. Saying so is what the add link is: their word, then the same reconcile every
 * other fact goes through.
 *
 * Two cases bend the amber. When the bank was empty at the debrief every sentence about
 * themselves is unsupported, and per-item amber would be one sentence repeated down the page —
 * so it is said once, at the top, and the items read plain. When this page could not read the
 * profile, adding is not offered at all: a reconcile against a bank we failed to load would
 * propose facts they already hold, and could read a deletion into the silence.
 */

interface Props {
  appId: string
  /** `round.mock.debrief` is present — the practice section mounts this only when it is. */
  round: InterviewRound
  /** The map's sources, for the `reported by` link on an interviewer turn. */
  sources: ResearchSource[]
  facts: Fact[]
  profileFailed: boolean
  /** The employer, for the evidence line on a claim that reaches the bank. */
  company: string
  /** The mapped stage's name, when the round is on the loop; the round's label otherwise. */
  stageName?: string
  onRound: (round: InterviewRound) => void
  onFactsChanged: () => Promise<void>
}

/** Which unsupported item has the panel open: where it is, and the sentence it carries. */
interface OpenClaim {
  key: string
  said: string
}

/**
 * Where a claim was said, for the evidence line the fact carries in the bank for as long as it
 * is held — spec §6, word for word, so the line does not merely repeat the claim. Exported and
 * pure because it is built only on a click: the suite has no DOM, and this sentence is the one
 * thing on this path that outlives the round.
 */
export function claimSnippet(what: string, company: string, date: string, said: string): string {
  return `Said in a mock ${what} for ${company}, ${date}: “${said}”`
}

export function Debrief({
  appId,
  round,
  sources,
  facts,
  profileFailed,
  company,
  stageName,
  onRound,
  onFactsChanged,
}: Props) {
  const [open, setOpen] = useState<OpenClaim | null>(null)
  /**
   * The same thing as `open`, readable from a request that started under a different claim. An
   * Accept takes a second or so and the add links above stay live throughout it, so by the time
   * one lands the panel on screen may belong to somebody else's sentence.
   */
  const openNow = useRef<OpenClaim | null>(null)
  const [unrecorded, setUnrecorded] = useState<string[]>([])
  /** Set when the panel is closing, to the id focus goes back to. Read once, by the effect. */
  const returnTo = useRef<string | null>(null)

  // Focus goes back where the click was, after the DOM has caught up with what the click did:
  // once a claim has landed its link is gone, and the item itself takes the focus instead. Which
  // of the two that is, is decided by the handler that closes the panel — it is the one thing
  // that knows whether anything was written — and `focusTargetOnClose` turns that into the id.
  // So the effect only follows the instruction; it runs after the render that took the link away.
  // A ref rather than state: this is one-shot, and putting it in state would mean a second render
  // to clear it and a `setState` in an effect body, which the lint rejects.
  useEffect(() => {
    const id = returnTo.current
    if (id === null) return
    returnTo.current = null
    document.getElementById(id)?.focus()
  })

  const mock = round.mock
  const debrief = mock?.debrief
  if (!mock || !debrief) return null

  const session = mock.startedAt
  const emptyBank = debrief.factsChecked === 0
  // What the mock was a mock of. The stage's own name when the round is on the loop, because
  // that is what the candidate practised; the round's label when it is not.
  const what = stageName ?? ROUND_LABEL[round.roundType]

  /** Open the panel, or close it. The ref moves with the state so the two stay one thing. */
  function show(claim: OpenClaim | null) {
    openNow.current = claim
    setOpen(claim)
  }

  /** Record on the round that this claim reached the bank, then close and hand focus back. */
  async function record(claim: OpenClaim) {
    try {
      const next = await apiFetch<InterviewRound>(
        `/api/applications/${appId}/interviews/${round.id}/mock`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'added', said: claim.said, session }),
        },
      )
      onRound(next)
    } catch {
      // The apply succeeded, so the claim IS in the bank; only our note of it is missing.
      // Clicking again would reconcile the sentence against a bank that now holds it and
      // show a skip, so the item says what happened and stops offering the link.
      setUnrecorded((s) => (s.includes(claim.said) ? s : [...s, claim.said]))
    }
    try {
      // The bank changed either way, so the page re-reads it either way.
      await onFactsChanged()
    } catch {
      // A re-read that rejects is the page's copy of the facts going one reload stale, and
      // nothing more — the claim is in the bank. What must not happen is this function giving
      // up here, leaving the panel on screen with every control disabled and no way out.
    }
    // Only this claim's panel closes. The add links stay live while an Accept is in flight, so
    // a second claim's panel can already be on screen by the time this lands, and closing it —
    // or sending focus back to the first claim's item — would take away what was just asked for.
    if (openNow.current?.key !== claim.key) return
    // The claim reached the bank on both paths — recorded on the round, or recorded only here —
    // so on both paths the link is gone and the item is what focus can return to.
    returnTo.current = focusTargetOnClose(claim.key, true)
    show(null)
  }

  return (
    <div className="mt-6 grid min-w-0 gap-8">
      {/* The conversation is over. It is kept — they may want to read what they wrote — but
          folded away, because the feedback is what they came back for. */}
      <details className="faq text-sm">
        <summary className="btn-link inline cursor-pointer">The conversation</summary>
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {round.chat.map((turn, i) => (
            <li key={i} className="min-w-0 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                {turn.role === 'model' ? 'Interviewer' : 'You'}
                <ReportedBy turn={turn} sources={sources} />
              </p>
              {turn.role === 'user' && mock.mode === 'coding' ? (
                // The live ledger's element and the live ledger's guard: `whitespace-pre-wrap`
                // wraps at a space and not inside a long unbroken token, so a URL or a base64
                // literal in their code widens the page unless the block scrolls itself. Same
                // conversation, so the same measure — quieter, because this half is archived.
                <pre className="mt-1.5 max-w-[74ch] overflow-x-auto whitespace-pre-wrap font-mono text-[0.875rem] leading-relaxed text-ink-2">
                  {turn.text}
                </pre>
              ) : (
                <p className="mt-1.5 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-2">
                  {turn.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>

      {/* Where focus lands when the debrief arrives, which is why it can take it. */}
      <p
        id="debrief-overall"
        tabIndex={-1}
        className="max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink"
      >
        {debrief.overall}
      </p>

      {emptyBank && (
        <p className="max-w-[62ch] border border-amber bg-amber-soft px-4 py-3 text-[0.9375rem] leading-relaxed text-ink">
          Your fact bank is empty, so nothing you said here could be checked against it.{' '}
          <Link href="/profile" className="btn-link">
            Add your facts
          </Link>
        </p>
      )}

      {debrief.answers.map((answer, ai) => (
        <section key={ai} className="min-w-0">
          <h3 className="max-w-[64ch] text-[0.9375rem] leading-snug font-medium text-ink">
            {answer.question}
          </h3>
          <Compact title="What landed" items={answer.landed} />
          <Compact title="What was vague" items={answer.vague} />
          {answer.unsupported.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                Only you can say whether this is true
              </h4>
              <ul className="mt-2 grid gap-3">
                {answer.unsupported.map((item, ui) => {
                  const key = `${ai}-${ui}`
                  // Plain once the claim has landed, and plain throughout when the bank was
                  // empty: amber that says the same thing about every sentence stops saying
                  // anything at all.
                  const plain = item.added === true || emptyBank
                  return (
                    <li
                      key={key}
                      id={`mock-claim-${key}`}
                      tabIndex={-1}
                      className={
                        plain
                          ? 'max-w-[62ch] border-l-2 border-line pl-4'
                          : 'max-w-[62ch] border border-amber bg-amber-soft px-4 py-3'
                      }
                    >
                      <p
                        id={`mock-said-${key}`}
                        className="font-display text-[0.9375rem] leading-relaxed text-ink"
                      >
                        “{item.said}”
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-2">{item.why}</p>
                      {/* "In", not "Added": the marker says the sentence is covered by the bank
                          now, and two paths set it — a claim that was applied, and one the
                          reconcile found already held, where nothing was written at all. */}
                      {item.added === true ? (
                        <p className="mt-2 text-sm text-ink-3">In your facts.</p>
                      ) : unrecorded.includes(item.said) ? (
                        <p className="mt-2 text-sm text-ink-3">
                          In your facts — this page could not record it. Reload.
                        </p>
                      ) : profileFailed ? (
                        <p className="mt-2 text-sm text-ink-3">
                          Your facts couldn’t be read — reload to add this.
                        </p>
                      ) : (
                        <button
                          type="button"
                          id={`mock-add-${key}`}
                          // Every add button on the screen reads the same, so the one that
                          // tells them apart is the sentence each is about: listed out of
                          // context they would otherwise be one name repeated down the page.
                          aria-describedby={`mock-said-${key}`}
                          className="btn-link mt-2 text-sm"
                          // One panel at a time: opening a second replaces the first, because
                          // two proposals about the same bank cannot both still be true once
                          // either is accepted.
                          onClick={() => show({ key, said: item.said })}
                        >
                          This is true — add it to my facts
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>
      ))}

      {/* Only in coding mode — the flow drops this block outside it, so its presence is the test.
          And only when the reading found something: `Compact` returns null per list, which is one
          level too low to keep a coding mock with nothing to say from drawing a bare heading. */}
      {debrief.code && (debrief.code.strengths.length > 0 || debrief.code.gaps.length > 0) && (
        <section className="min-w-0">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Read, not run</h3>
          <Compact title="Strengths" items={debrief.code.strengths} />
          <Compact title="Gaps" items={debrief.code.gaps} />
        </section>
      )}

      {debrief.rehearse.length > 0 && (
        <section className="min-w-0">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Rehearse</h3>
          {/* The brief's quoted style, and for the brief's reason: these are the candidate's own
              claims handed back, not lines written for them to recite. */}
          <ul className="mt-2 grid gap-2.5">
            {debrief.rehearse.map((line, i) => (
              <li
                key={i}
                className="max-w-[62ch] border-l-2 border-line-strong pl-4 font-display text-[0.9375rem] leading-relaxed text-ink"
              >
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Below the answer blocks rather than inside the item: the panel is a bordered surface,
          and the amber item is another, and one inside the other is not a shape this product
          has anywhere. */}
      {open && (
        <ClaimToFact
          // Keyed by the item, so a second claim gets a fresh panel: at a fixed position among
          // static siblings React would update this instance in place, leaving the first claim's
          // review, busy state and focus flag behind for the second one to be accepted against.
          key={open.key}
          said={open.said}
          snippet={claimSnippet(what, company, dateOnly(session), open.said)}
          facts={facts}
          onApplied={() => record(open)}
          onClose={() => {
            // Cancel wrote nothing, so the link is still there to go back to.
            returnTo.current = focusTargetOnClose(open.key, false)
            show(null)
          }}
        />
      )}
    </div>
  )
}

/** `· reported by {host}`, when the turn asked a question a guide reported and we still hold it. */
function ReportedBy({ turn, sources }: { turn: MockTurn; sources: ResearchSource[] }) {
  if (turn.role !== 'model' || turn.sourceId === undefined) return null
  const source = sources.find((s) => s.id === turn.sourceId)
  if (!source) return null
  return (
    <>
      {' '}
      {/* The separator is punctuation, not information — the link says the whole thing on its
          own, and a screen reader should not read a dot. The same three lines as the brief and
          the live ledger, because it is the same claim being made in the same words. */}
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
  )
}

/** One short list under a heading. A list with nothing in it is not a heading with nothing under it. */
function Compact({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-3">
      <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">{title}</h4>
      <ul className="mt-1.5 grid gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex max-w-[64ch] gap-2 text-[0.9375rem] leading-relaxed text-ink-2">
            <span aria-hidden="true" className="text-ink-3">
              –
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
