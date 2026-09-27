import { normalizeWs } from '@/lib/research/quotes'
import { ONET_ALIASES } from '@/lib/resume/onet'

/**
 * The matching rule of spec §6.2, and the only one on this feature: a term matches when its
 * whitespace-normalised, case-folded form is equal to, or a whole-word substring of, the
 * normalised haystack. Exact tokens only — never a stem, never an edit distance. A false match
 * here produces a bucket-1 row that tells the user something about their resume that is not
 * there, which is the one thing this product exists not to do; a miss lands the skill in bucket
 * 3, where the product asks instead of asserting. The asymmetry is deliberate and is why the
 * rule errs towards missing.
 */

const fold = (s: string): string => normalizeWs(s).toLowerCase()

/**
 * What continues a technology token: letters in any script, digits, `+`, `#` and `&`. So `C`
 * does not match inside `C++`, and `C#` matches beside a space; `R` matches neither `R&D` nor
 * `Résumé`, and `J` does not match `Jürgen`. The cost is that a term touching a non-Latin letter
 * with no space between (such as a CJK run) is a miss, which is the direction this rule errs in.
 * `.`, `-`, `/` and `_` are boundaries, which is what lets `PostgreSQL` match at the end of a
 * sentence; the cost is that `Node` matches inside `Node.js`, a match in the right direction that
 * still has to pass the judge before it can reach bucket 1.
 */
const TOKEN = /[\p{L}\p{N}+#&]/u

/**
 * One narrowing for the shortest names (F2, final review acceptance-6): a one- or two-character
 * name (`C`, `R`, `Go`, `J`) is never part of a hyphenated compound, so `go-to-market`, `go-live`
 * and `C-suite` are not Go or C. Go and C are O*NET rows for 11 and 12 of the 12 families, so a
 * saved posting that says go-to-market would otherwise put Go in scope as asked for; a longer name
 * keeps the hyphen as a boundary (`PostgreSQL-backed`). The cost is a miss on `Go-based`, which is the
 * direction this rule errs in. `Series C` still matches; the page quotes the line it matched, so
 * a match like that shows as what it is.
 */
const SHORT = 2

export function matchesTerm(term: string, haystack: string): boolean {
  const t = fold(term)
  const h = fold(haystack)
  if (t === '' || h === '') return false
  if (t === h) return true
  const ends = (c: string): boolean => !TOKEN.test(c) && !(t.length <= SHORT && c === '-')
  for (let at = h.indexOf(t); at >= 0; at = h.indexOf(t, at + 1)) {
    const before = at === 0 ? '' : h[at - 1]
    const after = h[at + t.length] ?? ''
    if (ends(before) && ends(after)) return true
  }
  return false
}

/** Every spelling that folds to one name, built once from the generated alias table. */
const CANONICAL = new Map(
  Object.entries(ONET_ALIASES).map(([spelling, name]) => [fold(spelling), name]),
)
const SPELLINGS = ((): Map<string, string[]> => {
  const byName = new Map<string, string[]>()
  for (const [spelling, name] of Object.entries(ONET_ALIASES)) {
    const k = fold(name)
    byName.set(k, [...(byName.get(k) ?? []), spelling])
  }
  return byName
})()

/**
 * The same rule, over every spelling of one skill: the O*NET name plus every `ONET_ALIASES` key
 * that folds to it. The table is what makes `Postgres` and `PostgreSQL` one skill (spec §6.2);
 * an unaliased spelling stays a miss, and the fix for one is a line in the generated table, not
 * a looser rule here.
 */
export function skillMatches(skill: string, haystack: string): boolean {
  const canonical = CANONICAL.get(fold(skill)) ?? skill
  if (matchesTerm(canonical, haystack)) return true
  return (SPELLINGS.get(fold(canonical)) ?? []).some((s) => matchesTerm(s, haystack))
}
