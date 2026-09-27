/**
 * The two cut points that turn a probability into a verdict, and the third number that says how
 * far apart they have to be.
 *
 * A `noul` is a number and everything downstream keys on pass/fail — the counts on the page,
 * §6.3's input set, the `Re-checked: 3 of 4` line, §6.2's buckets — so the conversion is a
 * decision, not an implementation detail. At or above PASS_AT the verdict is `pass`; at or below
 * FAIL_AT it is `fail`; between them it is `unjudged`, which draws as `Could not judge this
 * line.` with the line beside it and is never a counted item. A counted item owes the user an
 * honest expansion, and there is none for a judge that was not confident.
 *
 * NOT MEASURED. docs/notes/deps.md, "Cut points (spec §6.1)", reads "JEV not reachable, 2026-09-25":
 * the probe could not reach JEV, so the three numbers below are placeholders that satisfy the
 * band's invariants and nothing more. CUTS_MEASURED is false, so no live path asks JEV and none
 * of these is ever applied — the product runs the Gemini fallback, named on the page. When A4
 * measures them, Task A8's measured form replaces this file and sets CUTS_MEASURED to true.
 *
 * The Gemini fallback has no band at all: `yes` is `pass`, `no` is `fail`, nothing is
 * `unjudged`, and the denominator is the same four questions. These two numbers do not apply to
 * it, and `toVerdict` takes the judge for exactly that reason.
 */

/**
 * PLACEHOLDER — not measured; see CUTS_MEASURED. deps.md, "Cut points (spec §6.1)": "JEV not
 * reachable, 2026-09-25". A measured `scripts/jev-probe.ts cuts` run replaces it and flips the flag.
 */
export const PASS_AT = 0.7

/**
 * PLACEHOLDER — not measured; see CUTS_MEASURED. deps.md, "Cut points (spec §6.1)": "JEV not
 * reachable, 2026-09-25". A measured `scripts/jev-probe.ts cuts` run replaces it and flips the flag.
 */
export const FAIL_AT = 0.3

/**
 * PLACEHOLDER — not measured; see CUTS_MEASURED. deps.md, "Cut points (spec §6.1)": "JEV not
 * reachable, 2026-09-25". A measured `scripts/jev-probe.ts repeat` run replaces it and flips the
 * flag.
 */
export const REPEAT_SPREAD = 0.05

/** False: deps.md records "JEV not reachable, 2026-09-25" under "Cut points". Tasks C5 and C8 keep
 * the Gemini fallback until this is true. */
export const CUTS_MEASURED = false
