import { NEUTRAL_CHECK_IDS } from '@/lib/resume/checks'
import { FAIL_AT, PASS_AT } from '@/lib/resume/cuts'
import type { Judge } from '@/ai/jev'
import type { BulletJudgement, CheckResult } from '@/lib/resume/types'

/**
 * From a probability to a verdict, and from verdicts to the only numbers this product shows.
 *
 * Everything downstream keys on pass/fail — D2's counts, §6.3's input set, the `Re-checked: 3 of 4`
 * line, §6.2's buckets — so the conversion lives in one pure function rather than in each of them.
 */

/** The four Nouls, always, whichever judge answered. The denominator on every row. */
export const NOULS_PER_BULLET = 4

/**
 * At or above `PASS_AT` is a pass, at or below `FAIL_AT` is a fail, and between them is
 * `unjudged` — never a silent fail. Both cut points come from Task A4's probe against the owner's
 * labels on the §10 fixtures and are recorded in deps.md with the date and the pinned model id;
 * re-tuning them against a new `jev-1.13.x` is a deps.md entry, which is why the version is
 * pinned.
 *
 * The Gemini arm has no band. It returns no number, so there is nothing to be uncertain about in
 * a way this code could read: `yes` is a pass and `no` is a fail, the denominator is the same
 * four, and the judge is named beside the count so the reader knows which rule produced it.
 */
export function toVerdict(
  noul: number | null,
  judge: Judge,
  answer: 'yes' | 'no' | null,
): 'pass' | 'fail' | 'unjudged' {
  if (judge === 'gemini') {
    if (answer === 'yes') return 'pass'
    if (answer === 'no') return 'fail'
    return 'unjudged'
  }
  if (noul === null || !Number.isFinite(noul)) return 'unjudged'
  if (noul >= PASS_AT) return 'pass'
  if (noul <= FAIL_AT) return 'fail'
  return 'unjudged'
}

/**
 * "18 checks, 4 need attention" — both integers, as `.length` over the rows the page draws beside
 * them. Nothing here is read off a model: `z.number()` appears in no schema on this feature, and
 * this is the only arithmetic that produces a number on the Diagnose section.
 *
 * `unjudged` is counted separately and never as a checked item: it is drawn as its own
 * `Could not judge this line.` row, and under D2 a counted item owes the reader an expansion.
 * A `not-run` check is neither — it did not happen.
 *
 * A neutral check (`NEUTRAL_CHECK_IDS`, the employment gap) that ran is checked and never needs
 * attention: D4 reports the period and nothing else, and §7 draws it with a plain chip, so
 * counting it here would be the verdict the row itself does not give (final review, page-3).
 *
 * The checks parameter is the narrowest shape that does the job, so the stored slice
 * (`DiagnoseResult['checks']`, which drops `lines`) and the full `CheckResult` both fit.
 */
export function counts(
  judgements: BulletJudgement[],
  checks: readonly Pick<CheckResult, 'checkId' | 'state'>[],
): { checked: number; needAttention: number; unjudged: number } {
  const ranChecks = checks.filter((c) => c.state !== 'not-run')
  const judged = judgements.filter((j) => j.verdict !== 'unjudged')
  const neutral = (c: Pick<CheckResult, 'checkId'>) => NEUTRAL_CHECK_IDS.some((id) => id === c.checkId)
  return {
    checked: ranChecks.length + judged.length,
    needAttention:
      ranChecks.filter((c) => c.state === 'fail' && !neutral(c)).length +
      judged.filter((j) => j.verdict === 'fail').length,
    unjudged: judgements.filter((j) => j.verdict === 'unjudged').length,
  }
}
