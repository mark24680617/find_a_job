'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { AskHumanQueue } from '@/components/review/AskHumanQueue'
import { STALE } from '@/components/resume/copy'
import { EvidenceTable, HIDDEN_ROWS } from '@/components/resume/EvidenceTable'
import { ErrorLine, type ToolError } from '@/components/resume/ToolError'
import { DIAGNOSE_SECONDS, secondsNote } from '@/components/resume/timings'
import { hiddenLineIndices, runChecks } from '@/lib/resume/checks'
import { CHECK_LANGUAGE, LANGUAGE_GATE_SENTENCE, type CheckId } from '@/lib/resume/checkSources'
import { findGaps } from '@/lib/resume/dates'
import type { AskHuman, StoredResume } from '@/lib/types'

/**
 * Diagnose: the deterministic checks and the per-line judgements, with the findings written up
 * only for what failed. Three states — never run, running, and a review — and a fourth that is
 * the reason the page can be trusted at all: a review of a document that has since been
 * replaced says so and offers itself again.
 */

const STAGES = [
  { at: 0, text: 'Running the checks…' },
  { at: 4_000, text: 'Judging each line…' },
  { at: 12_000, text: 'Writing up what needs attention…' },
]

/**
 * A Diagnose card's stable id (amended 2026-09-24, R31; superseded for this id, fix round 1): its
 * check, and a hash of its question. The same card answered twice — a second tab, a retry — is
 * the same id, which is what lets the asks route refuse the duplicate with a 409; a new question
 * under the same check (a re-upload, or a re-run that rewords) is a new id, so it is still asked.
 * FNV-1a, synchronous, because the id is derived during render from stored findings.
 */
export function diagnoseAskId(checkId: string, question: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < question.length; i++) {
    hash = Math.imul(hash ^ question.charCodeAt(i), 0x01000193) >>> 0
  }
  return `diagnose-${checkId}-${hash.toString(16).padStart(8, '0')}`
}

/**
 * What each check row is about, recomputed from the document (F1, final review acceptance-5): the
 * stored rows carry no lines, and `runChecks` is pure, so a fresh review's rows get their own line
 * texts here, as its gaps do below. The two hidden-text rows draw their own hidden lines, because
 * the reader here is the document's owner and §8 restricts model inputs, not the owner's view;
 * every other row leaves hidden lines out, since each already appears under one of those two. The
 * unread dates are D4's, by the raw text the resume printed.
 */
function checkEvidence(resume: StoredResume): { linesById: Partial<Record<CheckId, string[]>>; unreadDates: string[] } {
  const hidden = new Set(hiddenLineIndices(resume))
  const linesById: Partial<Record<CheckId, string[]>> = {}
  for (const check of runChecks(resume)) {
    linesById[check.checkId as CheckId] = check.lines
      .filter((i) => HIDDEN_ROWS.has(check.checkId) || !hidden.has(i))
      .map((i) => resume.lines[i]?.text ?? '')
      .filter((t) => t !== '')
  }
  // A whole range that arrived on the from side, or a lone start date, has an empty toRaw, and
  // the from side is then the text that names it.
  const unreadDates = resume.entries.flatMap((e) =>
    e.from !== null && e.to !== null
      ? []
      : e.toRaw.trim() === ''
        ? [e.fromRaw]
        : [...(e.from === null ? [e.fromRaw] : []), ...(e.to === null ? [e.toRaw] : [])],
  ).filter((raw) => raw.trim() !== '')
  return { linesById, unreadDates: [...new Set(unreadDates)] }
}

interface Props {
  resume: StoredResume
  busy: boolean
  /** A failed request's sentence; drawn here only when it came from this section (page-5). */
  error?: ToolError
  onRun: () => Promise<void>
  /** Where an answered `askHuman` goes: `POST …/asks` (§4). The page owns the request. R31's shape. */
  onAnswerAsk: (answers: { askId: string; question: string; answer: string }[]) => Promise<void>
}

export function DiagnoseSection({ resume, busy, error = null, onRun, onAnswerAsk }: Props) {
  const diagnose = resume.diagnose
  const stale = diagnose !== undefined && diagnose.reviewedFrom !== resume.addedAt
  // R26: the gate is read off the document, so it is said before any run and no trigger is offered.
  const gated = resume.language !== CHECK_LANGUAGE
  // The page's `busy` is one flag for every tool on it; this section's regions speak only for a
  // request this section sent, so pressing Compare never draws the checks' stages here.
  const [pending, setPending] = useState<'check' | 'answers' | null>(null)
  async function track(kind: 'check' | 'answers', request: Promise<void>) {
    setPending(kind)
    try {
      await request
    } finally {
      setPending(null)
    }
  }

  // R31: one card per unanswered ask, each with its stable id. A card whose id is already in
  // `resume.asks` is answered and stays out; a question asked twice is one card, so the queue's
  // question → id map below is exact.
  const answered = new Set((resume.asks ?? []).map((a) => a.askId))
  const cards: { askId: string; ask: AskHuman }[] = []
  for (const finding of diagnose?.findings ?? []) {
    if (finding.askHuman === null) continue
    const askId = diagnoseAskId(finding.checkId, finding.askHuman.question)
    if (answered.has(askId) || cards.some((c) => c.ask.question === finding.askHuman?.question)) continue
    cards.push({ askId, ask: finding.askHuman })
  }
  const idByQuestion = new Map(cards.map((c) => [c.ask.question, c.askId]))

  return (
    <section aria-labelledby="diagnose-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="diagnose-heading" className="font-display text-xl tracking-tight text-ink">
          What the checks find
        </h2>
        {!gated && (
          <button type="button" className="btn btn-quiet" onClick={() => void track('check', onRun())}>
            {diagnose ? 'Check it again' : 'Run the checks'}
          </button>
        )}
      </div>

      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        Rules an applicant tracking system is documented to apply, and four questions about each
        line. Every row names who documents it.
      </p>

      {gated && <p className="mt-2 text-sm text-ink-2">{LANGUAGE_GATE_SENTENCE}</p>}

      {stale && <p className="mt-2 text-sm text-ink-3">{STALE}</p>}

      {/*
        The wait sits above the review rather than in place of it: a review handed to `Working`
        as `children` would blank what somebody is reading and then announce the whole table
        when the run landed. The region carries the status lines and nothing else.
      */}
      <Working
        busy={busy && pending === 'check'}
        className="mt-3 empty:mt-0"
        stages={STAGES}
        note={secondsNote(DIAGNOSE_SECONDS)}
      >
        {/* At rest the same measured note sits under the trigger, so the wait is known before
            the press; with no trigger to press, there is no wait to describe. */}
        {!gated && <p className="text-sm text-ink-3">{secondsNote(DIAGNOSE_SECONDS)}</p>}
      </Working>
      <ErrorLine error={error} at="diagnose" className="mt-2" />

      {diagnose && (
        <>
          <EvidenceTable
            checks={diagnose.checks}
            judgements={diagnose.judgements}
            // A stale review judged an earlier upload's lines, and bullet ids are re-allocated
            // per upload: its rows show their bulletId, never the new line under an old verdict
            // (amended 2026-09-24, ledger B7).
            bullets={stale ? [] : resume.bullets}
            findings={diagnose.findings}
            judge={diagnose.judge}
            language={resume.language}
            // D4's periods, from the entries of the document this review read: pure, so computed
            // here rather than stored; a stale review read other entries, so it states none
            // (final review, page-3).
            gaps={stale ? null : findGaps(resume.entries)}
            // Each row's own lines, from the document this review read; a stale review read
            // another, so its rows show none (F1).
            {...(stale ? {} : checkEvidence(resume))}
          />

          {diagnose.findings.length > 0 && (
            <ul className="mt-8 max-w-[76ch] border-t border-line">
              {diagnose.findings.map((finding, i) => (
                <li key={`${finding.checkId}-${i}`} className="border-b border-line py-4">
                  {/* A hidden-text row's model saw only the withheld sentence, so its quote can only
                      point at a visible line, which is the wrong one. */}
                  {!HIDDEN_ROWS.has(finding.checkId) && (
                    <p className="font-display text-[1.0625rem] leading-relaxed text-ink">
                      “{finding.quote}”
                    </p>
                  )}
                  <p className="mt-2 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-2">
                    {finding.explanation}
                  </p>
                  <p className="mt-1.5 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink">
                    {finding.fix}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {cards.length > 0 && (
            <AskHumanQueue
              // Remounted when the set of open cards changes, so its inputs re-seed rather than
              // shifting onto the card after one that was just answered.
              key={cards.map((c) => c.askId).join('|')}
              asks={cards.map((c) => c.ask)}
              busy={busy && pending === 'answers'}
              headingId="diagnose-ask-heading"
              action="save"
              onSubmit={(answers) =>
                void track('answers', onAnswerAsk(
                  answers.flatMap((a) => {
                    const askId = idByQuestion.get(a.question)
                    return askId === undefined ? [] : [{ askId, ...a }]
                  }),
                ))
              }
            />
          )}
          <ErrorLine error={error} at="diagnose-asks" className="mt-3" />
        </>
      )}
    </section>
  )
}
