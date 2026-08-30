import type { ProfileIngestOut } from '@/ai/schemas'
import type { Fact, Profile } from '@/lib/types'

/**
 * Folds one ingest result into the stored profile. An ingest is additive evidence about
 * the candidate, never a replacement for what they have already told us by hand, so:
 *
 * - **facts append.** New facts are re-numbered from one past the highest existing id
 *   (f7, f8, ...) before they are added. The model numbers its own output from f1 every
 *   run, so without the re-id a second upload would collide with the first — and fact
 *   ids are what every citation points at.
 * - **standardAnswers merge, human wins.** An incoming real value overwrites; an
 *   incoming "UNKNOWN" never overwrites an answer already there. Only the candidate can
 *   answer these, so a later resume that simply fails to mention work authorization must
 *   not erase the answer they typed in. A key we have never seen is stored as UNKNOWN,
 *   which is what puts it in front of them to fill.
 * - **voiceRules are untouched.** They are learned from the candidate's edits and have
 *   nothing to do with the document being ingested.
 * - **gaps replace.** They describe what is missing from the profile as it now stands,
 *   so the previous run's list is stale by definition.
 */
export function mergeIngest(existing: Profile, out: ProfileIngestOut): Profile {
  return {
    facts: [...existing.facts, ...renumber(out.facts, nextFactId(existing.facts))],
    standardAnswers: mergeStandardAnswers(existing.standardAnswers, out.standardAnswers),
    voiceRules: existing.voiceRules,
    gaps: out.gaps,
  }
}

/** One past the highest `f<n>` in use. Other id shapes cannot collide, so they are ignored. */
function nextFactId(facts: Fact[]): number {
  const numbers = facts.map((f) => Number(/^f(\d+)$/.exec(f.id)?.[1] ?? 0))
  return Math.max(0, ...numbers) + 1
}

function renumber(facts: Fact[], from: number): Fact[] {
  return facts.map((fact, i) => ({ ...fact, id: `f${from + i}` }))
}

function mergeStandardAnswers(
  existing: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const merged = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    // The model's answer object reaches us as a bare record — the plugin strips the key
    // constraints from the schema — so nothing but this loop decides what lands in the
    // profile. A non-string would be a value the profile editor cannot render.
    if (typeof value !== 'string') continue
    if (value === 'UNKNOWN' && merged[key] !== undefined) continue
    merged[key] = value
  }
  return merged
}

/**
 * Folds a *story* — a few sentences the candidate typed about one answer — into the profile.
 *
 * Facts and standardAnswers behave exactly as they do for a resume, so mergeIngest does that
 * work. The one difference is gaps, and it is the reason this exists: mergeIngest replaces
 * them, because a gaps list read off a whole resume genuinely supersedes the last one. A story
 * about a single project is not a whole resume — read on its own it is a profile missing
 * almost everything, and letting its gaps replace the real list would delete what the resume
 * actually established was missing. So the stored gaps stand, untouched.
 */
export function mergeStory(existing: Profile, out: ProfileIngestOut): Profile {
  return { ...mergeIngest(existing, out), gaps: existing.gaps }
}
