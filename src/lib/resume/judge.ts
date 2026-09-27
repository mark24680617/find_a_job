import { JUDGE_FALLBACK_MODEL, judgeWithGemini } from '@/ai/flows/judgeFallback'
import { JevError, JEV_MAX_QUESTIONS, type Judge, type Noul, type askNouls as AskNouls } from '@/ai/jev'
import { BULLET_NOUL_IDS, bulletNouls } from '@/ai/nouls'
import { JUDGE_FALLBACK_GAPS_SYSTEM } from '@/ai/prompts/judgeFallback'
import { buildBulletState, entryLine } from '@/ai/prompts/nouls'
import { CUTS_MEASURED } from '@/lib/resume/cuts'
import { skillQuestionBatches, type SkillBatch } from '@/lib/resume/gaps'
import type { BulletJudgement, StoredResume } from '@/lib/resume/types'
import { toVerdict } from '@/lib/resume/verdict'

/**
 * The Noul layer: one request per bullet, four questions, and a judge named on every row.
 *
 * One request per bullet rather than one per resume, for the reason §6.1 and §8 both give: many
 * questions against one state is free and identical, many items packed into one state degrades
 * ranking — and a state that is one bullet plus its role line is the smallest thing an injected
 * instruction elsewhere in the document cannot reach.
 *
 * The fallback is per bullet, not per run. A vendor that answers four bullets and then has a bad
 * minute should cost the reader one judge label on one line, not a relabelled resume. The one
 * exception is a status-0 failure (timeout, transport, malformed answer): it closes JEV for the rest
 * of the run, because each one costs JEV_TIMEOUT_MS and stacked serially they would outrun §2's 300 s.
 *
 * `deps` is injected so the route's test needs neither vendor, the same seam `GenerateCall` is.
 * The caller passes `visibleBullets(resume)`: hidden lines are excluded from every model input on
 * this feature (§8), and this signature carries no line records to decide that from.
 */

/** One judged answer, before the caller says which bullet or skill it was about. R50. */
export type Answered = Omit<BulletJudgement, 'bulletId' | 'questionId'>

export interface JudgeDeps {
  askNouls: typeof AskNouls
  fallback: typeof judgeWithGemini
  /**
   * R6's gate, injected by tests and by Stage D once a batch has fallen back (D6 and D7b abandon
   * JEV for the rest of a run on the first non-422 failure). Defaults to `jevEnabled()`.
   */
  jevEnabled?: boolean
  /** The fallback's system prompt. Diagnose leaves it unset; Gaps passes JUDGE_FALLBACK_GAPS_SYSTEM (R34). */
  fallbackSystem?: string
}

/**
 * JEV is asked only when its cut points were measured and a key is configured (amended
 * 2026-09-24, R6). On A4's no-JEV branch `CUTS_MEASURED` is false and the numerals in cuts.ts are
 * placeholders, so the permanent Gemini fallback answers every question and the page names it.
 */
export function jevEnabled(): boolean {
  return CUTS_MEASURED && Boolean(process.env.TYPESAFE_API_KEY)
}

/**
 * One JEV-or-Gemini call with the 422 rule and the judge stamp in it (amended 2026-09-24, R50) —
 * the one place the rule lives. `judgeBullets` calls it per bullet; Tasks D6 and D7b call it per
 * K-split skill batch. JEV when the gate is open; Gemini on any `JevError` that is not a 422; the
 * 422 rethrown, because it names the offending field and is our bug in a question shape, and
 * masking it as a labelled Gemini answer would hide it for as long as the shape stayed wrong.
 */
export async function askWithFallback(
  state: string,
  questions: Record<string, Noul>,
  deps: JudgeDeps,
): Promise<{ judge: Judge; answers: Record<string, Answered> }> {
  const ids = Object.keys(questions)

  if (deps.jevEnabled ?? jevEnabled()) {
    try {
      const answers = await deps.askNouls(state, questions)
      return {
        judge: 'jev',
        answers: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              noul: answers[id].noul,
              verdict: toVerdict(answers[id].noul, 'jev', null),
              model: answers[id].model,
              judge: 'jev' as const,
            },
          ]),
        ),
      }
    } catch (error) {
      if (!(error instanceof JevError)) throw error
      if (error.status === 422) throw error
    }
  }

  const answers = await deps.fallback(state, questions, undefined, deps.fallbackSystem)
  return {
    judge: 'gemini',
    answers: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          // Gemini returns no number, and a zero here would read as a confident fail.
          noul: null,
          verdict: toVerdict(null, 'gemini', answers[id]),
          model: JUDGE_FALLBACK_MODEL,
          judge: 'gemini' as const,
        },
      ]),
    ),
  }
}

/**
 * How many bullets are judged at once. Task C10b's smoke measured the judge at 1.2–1.6 s a bullet
 * on the Gemini fallback (`docs/notes/deps.md`, `### Measured timings`): serially a 100-bullet
 * resume (10 pages × about 10) is 160 s of the 300 s request, past the controller's C10b gate of
 * 150 s, which named a bounded pool of four as the answer (Task C8b).
 */
export const JUDGE_CONCURRENCY = 4

export async function judgeBullets(
  bullets: StoredResume['bullets'],
  entries: StoredResume['entries'],
  deps: JudgeDeps,
): Promise<BulletJudgement[]> {
  const questions = bulletNouls()
  const slots: BulletJudgement[][] = []
  // A status-0 failure costs JEV_TIMEOUT_MS; stacked serially it would outrun the 300 s request timeout.
  let jevOpen = deps.jevEnabled ?? jevEnabled()
  const askNouls: typeof deps.askNouls = async (state, qs, fetchImpl) => {
    try {
      return await deps.askNouls(state, qs, fetchImpl)
    } catch (error) {
      if (error instanceof JevError && error.status === 0) jevOpen = false
      throw error
    }
  }

  let next = 0
  const worker = async () => {
    while (next < bullets.length) {
      const index = next++
      const bullet = bullets[index]
      const entry = entries[bullet.entryIndex]
      const state = buildBulletState(bullet.text, entry ? entryLine(entry) : '')
      // The breaker is read here, as this bullet's call begins: a bullet already in flight when a
      // status-0 failure lands finishes on the path it started on.
      const { answers } = await askWithFallback(state, questions, { ...deps, askNouls, jevEnabled: jevOpen })
      slots[index] = BULLET_NOUL_IDS.map((id) => ({ bulletId: bullet.id, questionId: id, ...answers[id] }))
    }
  }
  // A rejection ends the run: no worker starts another bullet, and the siblings in flight are not awaited.
  const stopOnError = (error: unknown) => {
    next = bullets.length
    throw error
  }
  await Promise.all(Array.from({ length: Math.min(JUDGE_CONCURRENCY, bullets.length) }, () => worker().catch(stopOnError)))
  return slots.flat()
}

/**
 * One request per resume, one Noul per candidate skill (spec §6.2). Callers pass
 * `visibleText(resume)` as the state (§8).
 *
 * Each request goes through C8's `askWithFallback` (R50): JEV when R6's gate is open, the
 * fallback on any `JevError` but a 422, and a 422 — our own bug in a question shape rather than a
 * vendor outage — rethrown so the route refuses with the field JEV named (spec §4). The fallback
 * is handed the Gaps prompt, `JUDGE_FALLBACK_GAPS_SYSTEM` (R34): the state here is the whole
 * visible resume, not one line, and C6's default prompt says one line.
 *
 * One judge answers the whole run, because `GapsResult` stamps one and the page names it. So the
 * first request that comes back from the fallback abandons JEV for the rest of the run — every
 * later call passes `jevEnabled: false` — and the batches JEV had already answered are asked
 * again of the fallback, rather than storing a mixed run under a single stamp (amended 2026-09-24,
 * R50: C8's `JudgeDeps`, with no wrapper and no stub of this route's own).
 *
 * `cap` is `JEV_MAX_QUESTIONS`, or `1` if Task A4's `batch` row measured a cross-composition
 * delta above `REPEAT_SPREAD` (Task D4, R8).
 */
export async function judgeSkills(
  state: string,
  names: string[],
  deps: Pick<JudgeDeps, 'askNouls' | 'fallback'>,
): Promise<{ judge: Judge; judgements: Record<string, BulletJudgement | null> }> {
  type Asked = { batch: SkillBatch } & Awaited<ReturnType<typeof askWithFallback>>
  const asked: Asked[] = []
  let abandoned = false
  const ask = (batch: SkillBatch) =>
    askWithFallback(state, batch.questions, {
      askNouls: deps.askNouls,
      fallback: deps.fallback,
      fallbackSystem: JUDGE_FALLBACK_GAPS_SYSTEM,
      jevEnabled: abandoned ? false : undefined,
    })
  for (const batch of skillQuestionBatches(names, JEV_MAX_QUESTIONS)) {
    const one = await ask(batch)
    if (one.judge === 'gemini' && !abandoned) {
      abandoned = true
      for (const earlier of asked) Object.assign(earlier, await ask(earlier.batch))
    }
    asked.push({ batch, ...one })
  }

  const judgements: Record<string, BulletJudgement | null> = {}
  for (const { batch, answers } of asked) {
    for (const { id, name } of batch.ids) {
      const answer = answers[id]
      // No bullet was judged here: the state was the whole resume, and the skill's identity is
      // its question id. `BulletJudgement` is the shape §5.1 stores for both. An id with no
      // answer is one no judge reached — null — and never a silent 'no'.
      judgements[name] = answer ? { bulletId: '', questionId: id, ...answer } : null
    }
  }
  return { judge: abandoned ? 'gemini' : 'jev', judgements }
}
