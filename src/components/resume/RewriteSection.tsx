'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { AskHumanQueue } from '@/components/review/AskHumanQueue'
import { CitationText } from '@/components/review/CitationText'
import {
  inPlaceOf, JUDGE_NAME, leftAsItIs, NO_BULLETS_FOUND, NO_TEXT_TO_READ, NOTHING_TO_REWRITE, STALE,
} from '@/components/resume/copy'   // R36, R57, R44, ledger B3; NO_TEXT_TO_READ ledger E6; inPlaceOf, leftAsItIs page-6
import { TEXT_LAYER_CHECK } from '@/components/resume/EvidenceTable'   // amended 2026-09-25, ledger E6
import { REWRITE_SECONDS, secondsNote } from '@/components/resume/timings'
import { ErrorLine, type ToolError } from '@/components/resume/ToolError'
import { NOULS_PER_BULLET } from '@/lib/resume/verdict'
import type { AcceptedRewrite, Citation, Fact, StoredResume } from '@/lib/types'

/**
 * Rewrite: a proposal, and nothing written until it is accepted — `reconcileFacts`'s shape, for
 * the same reason. The words are about this person's own work, and a tool that edited them in
 * place would be writing their story for them.
 *
 * Accepting is its own request because it is the only thing on this feature that writes
 * model-derived text: the route re-checks every `factId` against the live bank, re-judges the
 * new line by the same four questions, and answers with the stored document. `Re-checked: 3 of
 * 4` is arithmetic over what comes back, with the judge that answered named beside it.
 */

/**
 * One proposed rewrite as the route answers it — `BulletRewriteOutSchema`'s element
 * (`src/ai/schemas.ts`, stage E), declared structurally rather than imported: `@/ai/schemas`
 * pulls Genkit in, and nothing in a client bundle should. The three fields it shares with the
 * stored form are taken from `AcceptedRewrite` so there is one declaration of them, not two.
 */
export type RouteRewrite = Pick<AcceptedRewrite, 'bulletId' | 'text' | 'citations'> & {
  askHuman: { question: string; why: string; shape: 'range' | 'frequency' | 'scale' | null }[]
  skipped: { reason: string } | null
}

/**
 * (amended 2026-09-24, R31) The same, with each ask's stable id attached — what the section
 * renders and what the answer carries to the asks route.
 */
export type RewriteProposal = Omit<RouteRewrite, 'askHuman'> & {
  askHuman: (RouteRewrite['askHuman'][number] & { askId: string })[]
}

/**
 * (amended 2026-09-24, R31) `rewrite-<bulletId>-<first 8 hex of sha1(question)>`: derived, never
 * minted, so the same card has the same id on every run — which is what lets a card already in
 * `resume.asks` be left out, and the asks route's 409 mean "already answered". Web Crypto's
 * digest is asynchronous, so the page attaches the ids once, when the proposal arrives
 * (`withAskIds`), rather than during render. `crypto.subtle` needs a secure context: the deployed
 * page is HTTPS and `next dev` is localhost, and Node's global `crypto` serves the tests.
 */
export async function rewriteAskId(bulletId: string, question: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(question))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `rewrite-${bulletId}-${hex.slice(0, 8)}`
}

/** Every ask of every proposed rewrite, with its id attached (R31). */
export async function withAskIds(rewrites: RouteRewrite[]): Promise<RewriteProposal[]> {
  return Promise.all(
    rewrites.map(async (r) => ({
      ...r,
      askHuman: await Promise.all(
        r.askHuman.map(async (ask) => ({ ...ask, askId: await rewriteAskId(r.bulletId, ask.question) })),
      ),
    })),
  )
}

const STAGES = [
  { at: 0, text: 'Reading the lines you chose…' },
  { at: 6_000, text: 'Writing them again from your own facts…' },
  { at: 20_000, text: 'Checking every number against something you said…' },
]

/** The three honest shapes a missing number can take, said as what would be enough. */
const SHAPE: Record<'range' | 'frequency' | 'scale', string> = {
  range: 'A range is enough — the smallest number you are sure of.',
  frequency: 'How often is enough — a week, a month, a release.',
  scale: 'How big is enough — people, records, requests.',
}

/** D2's count, over the re-judgement the accept route stored. The denominator is the four. */
export function recheckLine(
  recheck: AcceptedRewrite['recheck'],
  judge: AcceptedRewrite['judge'],
): string {
  const passed = recheck.filter((r) => r.verdict === 'pass').length
  // (amended 2026-09-24, R36) One judge-name map, in copy.ts, shared with C11 and D8.
  return `Re-checked: ${passed} of ${NOULS_PER_BULLET}, by ${JUDGE_NAME[judge]}.`
}

/**
 * The ticks that still name a line on offer (final review, page-1). A tick outlives the line it
 * was on — a re-run of the checks that passes it, or ids re-allocated by a Replace — and a tick
 * that is not drawn can be neither seen nor unticked, so only the live ones are checked, counted
 * or sent.
 */
export function liveSelection(chosen: string[], failedIds: string[]): string[] {
  return chosen.filter((id) => failedIds.includes(id))
}

/**
 * The open citation, only while this card still cites it (final review, page-1): a second run for
 * the same line is a new card, and a fact panel held over from the first would sit under a
 * sentence that no longer cites that fact. Matched on the fact and the span together.
 */
export function openCitation(
  rewrite: Pick<RewriteProposal, 'bulletId' | 'citations'>,
  active: { bulletId: string; citation: Citation } | null,
): Citation | null {
  if (active === null || active.bulletId !== rewrite.bulletId) return null
  const cited = rewrite.citations.some(
    (c) => c.factId === active.citation.factId && c.claimSpan === active.citation.claimSpan,
  )
  return cited ? active.citation : null
}

interface Props {
  resume: StoredResume
  proposal: { rewrites: RewriteProposal[] } | null
  facts: Fact[]
  busy: boolean
  /** A failed request's sentence; drawn here only when it came from this section (page-5). */
  error?: ToolError
  onRun: (bulletIds: string[]) => Promise<void>
  onAccept: (rewrite: RewriteProposal) => Promise<void>
  onAnswerAsk: (answers: { askId: string; question: string; answer: string }[]) => Promise<void>   // R31
}

export function RewriteSection({ resume, proposal, facts, busy, error = null, onRun, onAccept, onAnswerAsk }: Props) {
  const [chosen, setChosen] = useState<string[]>([])
  // (amended 2026-09-24, R56) The open citation is held with the card it belongs to, so the fact
  // behind it is drawn under that card and no other.
  const [active, setActive] = useState<{ bulletId: string; citation: Citation } | null>(null)
  const [copied, setCopied] = useState('')
  // (amended 2026-09-25, ledger D8) The page's `busy` is one flag for every tool on it; this
  // section's regions speak only for a request this section sent, so pressing Compare never draws
  // the rewrite stages here. An accept is not tracked: the stages describe writing, not the
  // accept route's re-check and re-judge.
  const [pending, setPending] = useState<'rewrite' | 'answers' | null>(null)
  async function track(kind: 'rewrite' | 'answers', request: Promise<void>) {
    setPending(kind)
    try {
      await request
    } finally {
      setPending(null)
    }
  }

  const factsById = new Map(facts.map((fact) => [fact.id, fact]))
  // (amended 2026-09-24, R44) A diagnosis of an earlier upload is treated as none: its bullet ids
  // were allocated over a different document, and the rewrite route refuses every one of them.
  const staleDiagnose = resume.diagnose !== undefined && resume.diagnose.reviewedFrom !== resume.addedAt
  const diagnose = staleDiagnose ? undefined : resume.diagnose
  const failedIds = [
    ...new Set((diagnose?.judgements ?? []).filter((j) => j.verdict === 'fail').map((j) => j.bulletId)),
  ]
  const failed = resume.bullets.filter((b) => failedIds.includes(b.id))
  const selected = liveSelection(chosen, failedIds)
  const lineOf = new Map(resume.bullets.map((b) => [b.id, b.text]))
  // (amended 2026-09-24, R31) One card per question, and none for an askId this resume already
  // holds an answer to. The queue hands back `{ question, answer }`, so each answer gets its
  // card's askId from the question it was typed under — which is why a question asked of two
  // bullets is one card, answered once.
  const answered = new Set((resume.asks ?? []).map((a) => a.askId))
  const asks: { askId: string; question: string; why: string }[] = []
  for (const ask of (proposal?.rewrites ?? []).flatMap((r) => r.askHuman)) {
    if (answered.has(ask.askId) || asks.some((a) => a.question === ask.question)) continue
    asks.push({
      askId: ask.askId,
      question: ask.question,
      why: ask.shape ? `${ask.why} ${SHAPE[ask.shape]}` : ask.why,
    })
  }
  const askIdOf = new Map(asks.map((a) => [a.question, a.askId]))

  function toggle(id: string) {
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
    } catch {
      // A refused clipboard is not worth a sentence: the text is on screen and selectable.
    }
  }

  return (
    <section aria-labelledby="rewrite-heading">
      <h2 id="rewrite-heading" className="font-display text-xl tracking-tight text-ink">
        The lines that need a result
      </h2>
      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        Written again from your own facts. Nothing here is stored until you accept it, and no
        number appears that you did not already state somewhere.
      </p>

      {diagnose === undefined ? (
        <>
          {/* R44: checks run against an earlier upload say so, and count as not run. */}
          {staleDiagnose && <p className="mt-2 text-sm text-ink-3">{STALE}</p>}
          <p className="mt-5 max-w-[62ch] border border-dashed border-line px-5 py-8 text-sm leading-relaxed text-ink-2">
            Run the checks first — this works from the lines they could not pass.
          </p>
        </>
      ) : failed.length === 0 ? (
        <p className="mt-5 max-w-[62ch] border border-dashed border-line px-5 py-8 text-sm leading-relaxed text-ink-2">
          {/* No line judged is not every line passing (amended 2026-09-24, ledger B3), and no
              text is not no line: C11's precedence (amended 2026-09-25, ledger E6). */}
          {diagnose.checks.some((c) => c.checkId === TEXT_LAYER_CHECK && c.state === 'fail')
            ? NO_TEXT_TO_READ
            : diagnose.judgements.length === 0
              ? NO_BULLETS_FOUND
              : NOTHING_TO_REWRITE}
        </p>
      ) : (
        <>
          <ul className="mt-4 max-w-[76ch] border-t border-line">
            {failed.map((bullet) => (
              <li key={bullet.id} className="border-b border-line py-2.5">
                <label className="flex cursor-pointer items-baseline gap-3">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={selected.includes(bullet.id)}
                    onChange={() => toggle(bullet.id)}
                  />
                  <span className="font-display text-[0.9375rem] leading-relaxed text-ink">
                    {bullet.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className="btn btn-quiet"
              disabled={selected.length === 0}
              onClick={() => void track('rewrite', onRun(selected))}
            >
              Write these again
            </button>
            <span className="text-sm text-ink-3">Nothing is stored by this.</span>
          </div>
        </>
      )}

      <Working
        busy={busy && pending === 'rewrite'}
        className="mt-3 empty:mt-0"
        stages={STAGES}
        note={secondsNote(REWRITE_SECONDS)}
      >
        {/* At rest the same measured note sits under the trigger, as C11's DiagnoseSection does;
            with no trigger drawn, there is no wait to describe (amended 2026-09-25, ledger C11). */}
        {diagnose !== undefined && failed.length > 0 && (
          <p className="text-sm text-ink-3">{secondsNote(REWRITE_SECONDS)}</p>
        )}
      </Working>
      <ErrorLine error={error} at="rewrite" className="mt-2" />

      {proposal && (
        <div className="mt-6 grid gap-8">
          {proposal.rewrites.map((rewrite) => {
            // An upload clears the proposal, so its ids are always this upload's (page-6).
            const original = lineOf.get(rewrite.bulletId)
            const open = openCitation(rewrite, active)
            return (
              <div key={rewrite.bulletId} className="border border-line bg-surface px-5 py-5">
                {original !== undefined && (
                  <p className="mb-3 max-w-[64ch] text-sm leading-relaxed text-ink-3">
                    {rewrite.skipped ? leftAsItIs(original) : inPlaceOf(original)}
                  </p>
                )}
                {rewrite.skipped ? (
                  <p className="max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-2">
                    {rewrite.skipped.reason}
                  </p>
                ) : (
                  <>
                    <CitationText
                      text={rewrite.text}
                      // Only the citations that point at a fact: `CitationText` follows a
                      // `factId`, and a citation whose evidence is the old resume line is not
                      // something to follow — it is shown as itself, below.
                      citations={rewrite.citations
                        .filter((c) => c.factId !== null)
                        .map((c) => ({ claimSpan: c.claimSpan, factId: c.factId as string }))}
                      factsById={factsById}
                      // R56: only this card's open citation, never another card's.
                      active={open}
                      onSelect={(citation) => setActive({ bulletId: rewrite.bulletId, citation })}
                    />

                    {open !== null && factsById.has(open.factId) && (
                      <p className="mt-3 max-w-[64ch] border-l-2 border-line-strong pl-3 text-sm leading-relaxed text-ink-2">
                        {factsById.get(open.factId)?.claim}
                      </p>
                    )}

                    {rewrite.citations
                      .filter((c) => c.factId === null && c.resumeSpan !== null)
                      .map((c, i) => (
                        <p key={`${c.claimSpan}-${i}`} className="mt-2 max-w-[64ch] text-sm text-ink-3">
                          From your resume: “{c.resumeSpan}”
                        </p>
                      ))}

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <button type="button" className="btn btn-primary" onClick={() => void onAccept(rewrite)}>
                        Accept this line
                      </button>
                      <span className="text-sm text-ink-3">
                        Accepting re-checks every fact and judges the line again.
                      </span>
                    </div>
                    <ErrorLine error={error} at={`accept-${rewrite.bulletId}`} className="mt-2" />
                  </>
                )}
              </div>
            )
          })}

          {asks.length > 0 && (
            <AskHumanQueue
              // Remounted when the set of open cards changes, as DiagnoseSection's is, so its
              // inputs re-seed rather than shifting onto the card after one just answered.
              key={asks.map((a) => a.askId).join('|')}
              asks={asks}
              busy={busy && pending === 'answers'}
              headingId="rewrite-ask-heading"
              // amended 2026-09-25, ledger C11: answering here only saves; nothing re-drafts.
              action="save"
              // R31: every answer carries the stable id of the card it was typed under.
              onSubmit={(answers) =>
                void track('answers', onAnswerAsk(
                  answers.flatMap((a) => {
                    const askId = askIdOf.get(a.question)
                    return askId === undefined ? [] : [{ askId, question: a.question, answer: a.answer }]
                  }),
                ))
              }
            />
          )}
          <ErrorLine error={error} at="rewrite-asks" />
        </div>
      )}

      {(resume.rewrites ?? []).length > 0 && (
        <div className="mt-10">
          <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
            Accepted
          </h3>
          <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-2">
            The app never edits your PDF. These are here to copy into it.
          </p>
          <ul className="mt-3 max-w-[76ch] border-t border-line">
            {(resume.rewrites ?? []).map((accepted, i) => (
              <li key={`${accepted.bulletId}-${i}`} className="border-b border-line py-4">
                {/* Only on the upload it was accepted against: ids are re-allocated per upload, so
                    an earlier one's id may name a different line now (R44, ledger B7). */}
                {accepted.reviewedFrom === resume.addedAt && lineOf.has(accepted.bulletId) && (
                  <p className="mb-1.5 max-w-[68ch] text-sm leading-relaxed text-ink-3">
                    {inPlaceOf(lineOf.get(accepted.bulletId) ?? '')}
                  </p>
                )}
                <p className="max-w-[68ch] font-display text-[1.0625rem] leading-relaxed text-ink">
                  {accepted.text}
                </p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="tnum text-sm text-ink-3">
                    {recheckLine(accepted.recheck, accepted.judge)}
                  </span>
                  {/* R44: kept, because it is a record, and marked when its basis has moved. */}
                  {accepted.reviewedFrom !== resume.addedAt && (
                    <span className="text-sm text-ink-3">{STALE}</span>
                  )}
                  <button type="button" className="btn-link text-sm" onClick={() => void copy(accepted.text)}>
                    Copy
                  </button>
                  {copied === accepted.text && <span className="text-sm text-accent">copied</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
