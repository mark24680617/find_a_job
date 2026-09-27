'use client'

import { FIX_FOR } from '@/components/resume/checkFixes'
import {
  COLOUR_UNDETECTABLE, GAP_REPORTED, JUDGE_NAME, NO_BULLETS_FOUND, NO_TEXT_TO_READ, couldNotReadDates,
  noEntriesBetween,
} from '@/components/resume/copy'
import { COLOUR_HIDDEN_TEXT, NEUTRAL_CHECK_IDS } from '@/lib/resume/checks'
import { CHECK_LANGUAGE, LANGUAGE_GATE_SENTENCE, sourceFor, type CheckId } from '@/lib/resume/checkSources'
import type { EmploymentGap } from '@/lib/resume/dates'
import { counts } from '@/lib/resume/verdict'
import type { BulletJudgement, DiagnoseResult, StoredResume } from '@/lib/types'

/**
 * What was checked, what this document does, and who says so — one table, one axis, and the
 * third column is the point of it. A verdict with no named source is an opinion with a chip on
 * it, and this product does not have those.
 *
 * The shape is the gates table's (`src/components/wizard/ParseConfirm.tsx:282-321`) and so are
 * the chip classes, minus the amber row: amber means "only you know this" everywhere in this
 * product, and a verdict is never that. The ask cards below the table are the only amber here.
 */

/** `ParseConfirm.tsx:30-34`'s own classes, with the amber row deliberately absent. */
const CHIP: Record<'pass' | 'fail' | 'plain', { label: string; className: string }> = {
  pass: { label: 'Met', className: 'border-accent bg-accent-soft text-accent' },
  fail: { label: 'Needs attention', className: 'border-danger bg-danger-soft text-danger' },
  plain: { label: 'Not run', className: '' },
}

// Whose reading answered is `JUDGE_NAME`, from copy.ts — one map, which D8 and E6 import too (R36).

/**
 * The four Nouls of §6.1, in words. Keyed loosely and falling back to the id, so the question
 * set is stage C's to name and this table does not have to be edited when it is.
 */
const NOUL_LABEL: Record<string, string> = {
  result: 'A measurable result',
  action: 'A specific action',
  scale: 'Scope or scale',
  'self-description': 'More than self-description',
}

/**
 * Who documents the four Nouls is C2's table, read through `sourceFor` as every check row is — the
 * `bullet-*` ids exist there for exactly this, and a second copy here would drift from it
 * (amended 2026-09-24, R32).
 */
const noulSource = (questionId: string): string => sourceFor(`bullet-${questionId}` as CheckId)

/**
 * The check whose failure means there is nothing to read. Stage C names the check ids; this is
 * the one the page needs by name, for §6.1's image-only empty state.
 */
export const TEXT_LAYER_CHECK = 'text-layer'

/** `contact-in-header` → `Contact in header`. Works for whatever ids stage C settles on. */
function checkLabel(checkId: string): string {
  const words = checkId.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** D2's line. Both numbers are arithmetic over what this table is drawing. */
export function countLine(checked: number, needAttention: number): string {
  const items = `${checked} ${checked === 1 ? 'check' : 'checks'}`
  const attention = `${needAttention} ${needAttention === 1 ? 'needs' : 'need'} attention`
  return `${items}, ${attention}.`
}

interface Props {
  checks: DiagnoseResult['checks']
  judgements: BulletJudgement[]
  bullets: StoredResume['bullets']
  findings: DiagnoseResult['findings']
  judge: DiagnoseResult['judge']
  language: StoredResume['language']
  /**
   * The periods the gap row reports — `findGaps` over the entries of the document this review
   * read — or `null` when that is not known (a review of an earlier upload). D4: the row states
   * the period and nothing else (final review, page-3).
   */
  gaps: EmploymentGap[] | null
  /**
   * Each check's own line texts, from `runChecks` over the document this review read, with the
   * hidden lines left out except under the two hidden-text rows — or absent when that is not known (a review of an earlier upload,
   * whose stored rows carry no lines). D2: a failing row shows the line it is about (F1).
   */
  linesById?: Partial<Record<CheckId, string[]>>
  /** The raw text of every date the review's document could not read (D4), beside `linesById`. */
  unreadDates?: string[]
}

/**
 * The two rows whose lines are nothing but hidden text. They draw those lines to their owner, and
 * never a model quote: the model was handed a withheld sentence in their place, so its quote could
 * only point at a visible line and so at the wrong one (F1).
 */
export const HIDDEN_ROWS = new Set<string>(['hidden-text-geometry', 'hidden-text-colour'])

/** How many of a row's lines are quoted under it: the first one or two, as a finding quotes one. */
const LINES_SHOWN = 2

const fixFor = (checkId: string): string | undefined => (FIX_FOR as Partial<Record<string, string>>)[checkId]

/**
 * What a failing row is about, when no finding quotes it (F1): its own lines, or D4's unread
 * dates. Nothing on a stale review, whose rows have no lines.
 */
function RowLines({ checkId, linesById, unreadDates }: {
  checkId: string
  linesById: Props['linesById']
  unreadDates: string[]
}) {
  if (linesById === undefined) return null
  if (checkId === 'dates-parseable' && unreadDates.length > 0) {
    return <span className="mt-1.5 block text-sm leading-relaxed text-ink-2">{couldNotReadDates(unreadDates)}</span>
  }
  return (linesById[checkId as CheckId] ?? []).slice(0, LINES_SHOWN).map((text, i) => (
    <span key={i} className="mt-1.5 block font-display text-sm leading-relaxed text-ink-2">“{text}”</span>
  ))
}

/** A row D4 reports without a verdict: found is said as reported, never as needing attention. */
const isNeutral = (checkId: string): boolean => NEUTRAL_CHECK_IDS.some((id) => id === checkId)

export function EvidenceTable({
  checks, judgements, bullets, findings, judge, language, gaps, linesById, unreadDates = [],
}: Props) {
  const { checked, needAttention } = counts(judgements, checks)
  const textById = new Map(bullets.map((b) => [b.id, b.text]))
  const quoteById = new Map(findings.map((f) => [f.checkId, f.quote]))
  const noText = checks.some((c) => c.checkId === TEXT_LAYER_CHECK && c.state === 'fail')
  /**
   * A run with text, in English, that judged no line: there was no bullet line under a heading
   * `structure()` recognises. Keyed on `judgements`, the array the count is computed from, so a
   * stale review stays consistent with its own rows (amended 2026-09-24, ledger B3).
   */
  const noBullets = judgements.length === 0 && !noText && language === CHECK_LANGUAGE

  /** Why a row did not run, in the order the reasons actually apply. */
  const notRun =
    noText
      ? NO_TEXT_TO_READ
      : language !== CHECK_LANGUAGE
        ? LANGUAGE_GATE_SENTENCE
        : 'Not run.'

  return (
    <div className="mt-5">
      <p className="text-[0.9375rem] text-ink">
        <span className="tnum">{countLine(checked, needAttention)}</span>
        {/* Only a judge that answered is named: on a run that judged no line, none did (amended 2026-09-24, ledger B3). */}
        {judgements.length > 0 && (
          <>
            {' '}
            <span className="text-ink-3">Judged by {JUDGE_NAME[judge]}.</span>
          </>
        )}
      </p>
      {noBullets && <p className="mt-1 text-sm text-ink-2">{NO_BULLETS_FOUND}</p>}
      {/*
        §8's stated gap, once and never as a row: only a build that cannot read fill colour says
        it, and this one can (amended 2026-09-24, R9).
      */}
      {!COLOUR_HIDDEN_TEXT && <p className="mt-1 text-sm text-ink-3">{COLOUR_UNDETECTABLE}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-[0.9375rem]">
          <thead>
            <tr className="border-b border-line-strong text-left text-xs uppercase tracking-[0.12em] text-ink-3">
              <th scope="col" className="w-1/4 py-2 pr-6 font-medium">Check</th>
              <th scope="col" className="w-2/5 py-2 pr-6 font-medium">What your resume does</th>
              <th scope="col" className="py-2 font-medium">Who documents this</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.checkId} className="border-b border-line align-top">
                <td className="py-3 pr-6 leading-relaxed text-ink">{checkLabel(check.checkId)}</td>
                <td className="py-3 pr-6">
                  {check.state === 'not-run' ? (
                    <span className="text-ink-2">{notRun}</span>
                  ) : check.state === 'fail' && isNeutral(check.checkId) ? (
                    <>
                      {/* §7's plain chip for a neutral row, and D4's period under it. */}
                      <span className="chip font-medium">{GAP_REPORTED}</span>
                      {(gaps ?? []).map((gap) => (
                        <span key={`${gap.from}-${gap.to}`} className="mt-1.5 block text-sm leading-relaxed text-ink-2">
                          {noEntriesBetween(gap.from, gap.to)}
                        </span>
                      ))}
                    </>
                  ) : (
                    <>
                      <span className={`chip font-medium ${CHIP[check.state].className}`}>
                        {CHIP[check.state].label}
                      </span>
                      {!HIDDEN_ROWS.has(check.checkId) && quoteById.has(check.checkId) ? (
                        <span className="mt-1.5 block font-display text-sm leading-relaxed text-ink-2">
                          “{quoteById.get(check.checkId)}”
                        </span>
                      ) : (
                        check.state === 'fail' && (
                          <RowLines checkId={check.checkId} linesById={linesById} unreadDates={unreadDates} />
                        )
                      )}
                      {/* The fixed sentence is the floor: a row a finding covers has its fix in the list below. */}
                      {check.state === 'fail' && !quoteById.has(check.checkId) && fixFor(check.checkId) && (
                        <span className="mt-1.5 block text-sm leading-relaxed text-ink">{fixFor(check.checkId)}</span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-3 text-sm leading-relaxed text-ink-2">{check.source}</td>
              </tr>
            ))}

            {judgements.map((j, i) => (
              <tr key={`${j.bulletId}-${j.questionId}-${i}`} className="border-b border-line align-top">
                <td className="py-3 pr-6 leading-relaxed text-ink">
                  {NOUL_LABEL[j.questionId] ?? j.questionId}
                </td>
                <td className="py-3 pr-6">
                  {j.verdict === 'unjudged' ? (
                    <span className="chip">Could not judge this line.</span>
                  ) : (
                    <span className={`chip font-medium ${CHIP[j.verdict].className}`}>
                      {CHIP[j.verdict].label}
                    </span>
                  )}
                  <span className="mt-1.5 block font-display text-sm leading-relaxed text-ink-2">
                    {textById.get(j.bulletId) ?? j.bulletId}
                  </span>
                  {j.verdict === 'fail' && fixFor(`bullet-${j.questionId}`) && (
                    <span className="mt-1.5 block text-sm leading-relaxed text-ink">{fixFor(`bullet-${j.questionId}`)}</span>
                  )}
                </td>
                <td className="py-3 text-sm leading-relaxed text-ink-2">
                  {noulSource(j.questionId)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
