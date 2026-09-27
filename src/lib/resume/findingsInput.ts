import type { ResumeFindingsInput } from '@/ai/flows/resumeFindings'
import type { BulletNoulId } from '@/ai/nouls'
import { NEUTRAL_CHECK_IDS, hiddenLineIndices, visibleBullets, visibleText } from '@/lib/resume/checks'
import type { BulletJudgement, CheckResult, StoredResume } from '@/lib/resume/types'

/**
 * What `resumeFindings` is shown, built in one place so the route and the live smoke can never
 * send the model two different things.
 *
 * §8 keeps hidden text out of every model input, and a failing row's `lines` is a model input:
 * so every row's lines are filtered against `hiddenLineIndices(resume)`, and the two hidden-text
 * rows — whose lines are nothing BUT hidden text — go over with the fixed description below
 * instead. The gap is left out (D4: stated, never explained), the bullets are the visible ones,
 * and each failed bullet carries the Noul ids it failed (R24).
 */

/** Stands in for a hidden-text row's lines. It describes the row, and carries nothing of the resume. */
export const HIDDEN_ROW_LINES: readonly string[] = [
  '(withheld: lines the page does not render are never shown to a model)',
]

const HIDDEN_ROWS = new Set<string>(['hidden-text-geometry', 'hidden-text-colour'])

export function buildFindingsInput(
  resume: StoredResume,
  checks: CheckResult[],
  judgements: BulletJudgement[],
  today: string,
): ResumeFindingsInput {
  const hidden = new Set(hiddenLineIndices(resume))

  const failures = checks
    .filter((c) => c.state === 'fail' && !NEUTRAL_CHECK_IDS.some((id) => id === c.checkId))
    .map((c) => ({
      checkId: c.checkId,
      source: c.source,
      lines: HIDDEN_ROWS.has(c.checkId)
        ? [...HIDDEN_ROW_LINES]
        : c.lines
            .filter((i) => !hidden.has(i))
            .map((i) => resume.lines[i]?.text ?? '')
            .filter((t) => t !== ''),
    }))

  const failedBy = new Map<string, BulletNoulId[]>()
  for (const j of judgements) {
    if (j.verdict !== 'fail') continue
    failedBy.set(j.bulletId, [...(failedBy.get(j.bulletId) ?? []), j.questionId as BulletNoulId])
  }
  const failedBullets = visibleBullets(resume)
    .filter((b) => failedBy.has(b.id))
    .map((b) => ({ id: b.id, text: b.text, failed: failedBy.get(b.id) ?? [] }))

  return { resumeText: visibleText(resume), failures, failedBullets, today }
}
