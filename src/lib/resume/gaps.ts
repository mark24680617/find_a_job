import type { Noul } from '@/ai/jev'
import { skillNoul } from '@/ai/nouls'
import { skillMatches } from '@/lib/resume/skillMatch'
import type { Application, BulletJudgement, GapsResult } from '@/lib/types'

/**
 * The Gaps arithmetic (spec §6.2). Pure: no Firestore, no model, no vendor. There is no Gemini
 * flow in Gaps at all — the route reads the postings, the fact bank and the resume, the judge
 * answers one yes/no per skill, and everything on screen after that is `.length` and a bucket
 * decided here.
 */

/**
 * Re-exported so the matching rule is reachable from the gaps layer, where the plan's interface
 * contract publishes it. The rule itself lives in exactly one file.
 */
export { matchesTerm } from '@/lib/resume/skillMatch'

/**
 * Tier 0 (spec §6.2): the user's own saved applications, as strings. **`Application.parsed` only,
 * never `jdRaw`** — the raw posting page is company boilerplate around the job, and a skill named
 * anywhere in it would come back as a skill the employer demanded. The spec says the same thing
 * in the same words; this is no longer a narrower reading the plan chose over it.
 *
 * `postingsUsed` is the real N the page states — "from the 4 postings you saved" — and it counts
 * applications that contributed at least one string, never the size of the collection. A posting
 * nobody interpreted contributes nothing and is not counted: it is not a posting we have read.
 * Never presented as a corpus; §6.2 uses Tier 0 for this-posting matching and nothing else.
 */
export function tier0Terms(apps: Application[]): { terms: string[]; postingsUsed: number } {
  const terms: string[] = []
  let postingsUsed = 0
  for (const app of apps) {
    const own = [
      ...(app.parsed?.roleFacts ?? []),
      ...(app.parsed?.gates ?? []).map((g) => g.requirement),
    ].filter((s) => s.trim() !== '')
    if (own.length === 0) continue
    postingsUsed += 1
    terms.push(...own)
  }
  return { terms, postingsUsed }
}

/** One request's worth of questions against the one state, and the ids that map back to skills. */
export interface SkillBatch {
  questions: Record<string, Noul>
  ids: { id: string; name: string }[]
}

/**
 * One Noul per candidate skill (spec §6.2), split into requests of at most `cap` questions
 * against the same state — the callers pass `JEV_MAX_QUESTIONS`. The split is safe only if one
 * Noul gets the same answer whatever it is batched with, and Task A4's `batch` arm is what
 * measures that: one Noul alone, in a K-split batch and in a full batch, the largest delta
 * recorded in docs/notes/deps.md's "Batching identity" row (R8). That row reads "not run" — JEV
 * was not reachable on 2026-09-25, CUTS_MEASURED is false, and the fallback judge answers every
 * batch, so the cap stands. If a measured delta is above `REPEAT_SPREAD`, the callers pass
 * `cap = 1`, one question per request. It is packing many items into one state that degrades
 * ranking, which is why the state stays one resume and the questions split. No skill is dropped
 * to fit.
 *
 * The question id is `s1 … sN` in candidates order and NOT the skill's name: O*NET technology
 * names carry `+`, `#`, `.` and `/` (C++, C#, Node.js), and two names that normalised to one key
 * would collide in a map whose answer-id set has to equal its question-id set exactly (spec §4's
 * hand-validation) — the collision would silently drop a skill from the run. `ids` is what
 * carries the mapping back to the caller.
 */
export function skillQuestionBatches(names: string[], cap: number): SkillBatch[] {
  const batches: SkillBatch[] = []
  names.forEach((name, i) => {
    if (i % cap === 0) batches.push({ questions: {}, ids: [] })
    const batch = batches[batches.length - 1]
    const id = `s${i + 1}`
    batch.questions[id] = skillNoul(name)
    batch.ids.push({ id, name })
  })
  return batches
}

/**
 * The candidates in scope. All three buckets of §6.2 start with "in the postings", so a skill
 * nobody asked for is not a gap — it is somebody else's job, and a row for it would be noise
 * over a list the user has to read.
 *
 * O*NET's In Demand skills count as demanded on their own, because that flag is O*NET's own
 * record of a technology frequently named in this occupation's job postings — the same claim
 * Tier 0 makes with a much smaller N (typically 3 to 30 postings, exactly one in the sample
 * world). Without it a user with one saved application would see an empty section.
 * O*NET's own definitions, read 2026-09-26 at
 * https://www.onetcenter.org/dictionary/31.0/excel/software_skills.html: "The In Demand column
 * indicates requirements frequently included in employer job postings for the particular
 * occupation." Hot Technology does NOT count (F3, ledger-2, owner decision 2026-09-26): it
 * "indicates requirements frequently included across all employer job postings", so it put 55
 * to 152 skills in scope per family on release 31.0, Adobe tools in front of a backend engineer
 * among them. In Demand puts 3 to 37.
 */
export function demandedSkills(
  candidates: { name: string; inDemand: boolean }[],
  postingTerms: string[],
): { name: string; inDemand: boolean }[] {
  return candidates.filter(
    (candidate) => candidate.inDemand || postingTerms.some((t) => skillMatches(candidate.name, t)),
  )
}

/**
 * The three buckets of spec §6.2, which ARE the arithmetic — there is no Gemini flow in Gaps:
 *
 *   1  in the postings and evidenced in the resume
 *   2  in the postings and in the fact bank, but not visible in the resume → shown on the page
 *      as a candidate for a rewrite. It is not an input to the rewrite flow in this plan: §6.3's
 *      inputs are the failed bullets, the fact bank and the answered asks, and the user picks the
 *      bullet in Rewrite (R38; owner to confirm against §6.2 bucket 2 and §13 row E).
 *   3  in the postings and nowhere → an `askHuman` card, `Have you done this?`, and never
 *      "you lack this skill": the product cannot state an absence about the user any more than
 *      a presence.
 *
 * Bucket 1 needs both halves. The skill's name has to be in the resume text — otherwise the row
 * would be a claim about a document that does not contain the word — and the judge has to say
 * the resume evidences hands-on use of it rather than merely listing it. A `fail`, an `unjudged`
 * and a skill no judge reached are all "not evidenced": the product may not assert evidence it
 * does not have, and an ask is the honest place for all three.
 *
 * Every row also carries `inPostings` and `namedInResume` (R37). The page cannot recompute them,
 * because it has no posting terms, and without them it would have to say "in the postings" of a
 * skill only O*NET's In Demand flag put in scope, or "not in your resume" of a skill the resume
 * names but the judge did not pass. Both would be claims about the user's documents that nothing
 * cites.
 *
 * And every row carries `evidence` (F2, final review acceptance-6): the text each flag matched,
 * because the page words those flags as statements about the user — "asked for in a posting you
 * saved", "your resume names it", "in your profile" — and the CLAUDE.md thesis is that the agent
 * never states a fact about the user it cannot cite. The posting term and the fact claim are the
 * first strings that matched. The resume line is the first of `resumeLines` (the visible
 * `lines[].text`) that matches on its own, and `namedInResume` is true exactly when there is one
 * (amended 2026-09-26, F2 fix round), so the flag and its quote cannot disagree. A name the PDF
 * wraps across a line break is a miss: it lands in bucket 3 (or bucket 2 with a fact), where the
 * product asks and never states.
 *
 * Skills come back in `candidates` order; the caller owns the display sort.
 */
export function bucketSkills(input: {
  candidates: { name: string; inDemand: boolean }[]
  postingTerms: string[]
  factClaims: string[]
  resumeLines: string[]
  judgements: Record<string, BulletJudgement | null>
}): GapsResult['skills'] {
  const rows: GapsResult['skills'] = []
  for (const candidate of demandedSkills(input.candidates, input.postingTerms)) {
    const matched = (texts: string[]): string | null =>
      texts.find((text) => skillMatches(candidate.name, text)) ?? null
    const judgement = input.judgements[candidate.name] ?? null
    const posting = matched(input.postingTerms)
    const resume = matched(input.resumeLines)
    const namedInResume = resume !== null
    const evidenced = judgement?.verdict === 'pass' && namedInResume
    const bank = matched(input.factClaims)
    const bucket: 1 | 2 | 3 = evidenced ? 1 : bank !== null ? 2 : 3
    rows.push({
      name: candidate.name,
      bucket,
      inPostings: posting !== null,
      namedInResume,
      judgement,
      evidence: { posting, resume, bank },
    })
  }
  return rows
}
