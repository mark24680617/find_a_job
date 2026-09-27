/**
 * How long each tool takes, in whole seconds, as `scripts/smoke-resume.ts` measured it — the
 * floor of the fastest run and the ceiling of the slowest over three runs, recorded in
 * `docs/notes/deps.md` under `### Measured timings` beside the date and the judge that answered.
 * `Working`'s note is the one place the product tells somebody how long to wait, and a guessed
 * number there is the difference between a wait and a hang.
 *
 * Copied from that table, never re-measured here: two numbers in two places drift.
 */
export function secondsNote(seconds: readonly [number, number]): string {
  return `Usually takes ${seconds[0]}–${seconds[1]} seconds.`
}

/** The `| Diagnose |` row's pair, over Task C10b's run and Task C8b's re-measure of 2026-09-25. */
export const DIAGNOSE_SECONDS: readonly [number, number] = [11, 110]

/** The `| Gaps |` row's pair, over Task D7b's three runs of 2026-09-25. */
export const GAPS_SECONDS: readonly [number, number] = [7, 12]

/**
 * The `| Rewrite |` row's pair, over Task E5b's three runs of 2026-09-25 and the final regression
 * fix's three of 2026-09-26.
 */
export const REWRITE_SECONDS: readonly [number, number] = [19, 54]
