import type { ProfileIngestOut } from '@/ai/schemas'
import { LETTERHEAD_FIELD_MAX } from '@/lib/letter/letterhead'
import type { Fact, Profile, ProfileContact } from '@/lib/types'

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
 * - **contact fills blanks, the human wins.** Same principle as standardAnswers: a stored
 *   field stands and only a blank one takes what the document stated. A resume header is
 *   evidence about the four fields, and the number the candidate typed by hand is an answer.
 */
export function mergeIngest(existing: Profile, out: ProfileIngestOut): Profile {
  return {
    facts: [...existing.facts, ...renumber(out.facts, nextFactId(existing.facts))],
    standardAnswers: mergeStandardAnswers(existing.standardAnswers, out.standardAnswers),
    voiceRules: existing.voiceRules,
    gaps: out.gaps,
    contact: mergeContact(existing.contact, out.contact),
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

/** The four fields, all blank — a profile that has been asked nothing about its letterhead. */
export function blankContact(): ProfileContact {
  return { name: '', email: '', phone: '', location: '' }
}

// Everything C0 and C1 except `\n`, which is folded to a space just above: each of the four is
// one line of an address block, and a newline in one reaches the PDF as a line the layout never
// planned for. The same rule `readLetterhead` applies to the same four values.
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g

/**
 * The contact as stored, made safe. Applied on every read: the field is optional, older profiles
 * have none, and the PUT that writes it takes whatever four strings a client sent. `field` is
 * `readLetterhead`'s rule for the same four values, held to the same 200 so that what the profile
 * keeps and what the letterhead prints cannot disagree about what fits.
 */
export function readContact(value: unknown): ProfileContact {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const field = (raw: unknown): string => {
    if (typeof raw !== 'string') return ''
    const clean = raw.replace(/\r\n?/g, '\n').replace(/\n/g, ' ').replace(CONTROLS, '').trim()
    // Cut by code point, as the letterhead cuts: a slice that lands inside a surrogate pair
    // leaves half a character the person can neither read nor delete.
    return Array.from(clean).slice(0, LETTERHEAD_FIELD_MAX).join('')
  }
  return { name: field(v.name), email: field(v.email), phone: field(v.phone), location: field(v.location) }
}

/**
 * The stored contact with the incoming one filling its blanks, and nothing else. Both sides are
 * read through `readContact` — the stored one because it came out of a document that has held
 * anything a client sent, the incoming one because a model wrote it.
 */
export function mergeContact(existing: unknown, incoming: unknown): ProfileContact {
  const stored = readContact(existing)
  const fresh = readContact(incoming)
  const merged = blankContact()
  for (const key of Object.keys(merged) as (keyof ProfileContact)[]) {
    merged[key] = stored[key] || fresh[key]
  }
  return merged
}

/**
 * Whether two profiles differ in anything a changeset can point at — everything they hold except
 * the contact block.
 *
 * The profile screen refuses to accept a changeset while the working copy has unsaved edits,
 * because a revision names a fact by id and an id that exists only in the browser would land on
 * the wrong claim. No contact field can move an id, and the reading that fills the block is the
 * same reading whose facts are waiting to be accepted — so a contact is an unsaved edit like any
 * other, and it is simply not this refusal's business.
 */
export function differsBesideContact(a: Profile, b: Profile): boolean {
  // `JSON.stringify` drops a key whose value is undefined, so the comparison reads the same
  // whether or not either profile has ever stored a contact.
  const beside = (p: Profile) => JSON.stringify({ ...p, contact: undefined })
  return beside(a) !== beside(b)
}
