import type { Fact } from '@/lib/types'

/**
 * The human presentation layer over the fact bank.
 *
 * The fact bank is the AI substrate: a flat list of atomic, cited claims. A person opening their
 * profile wants something else — their name and contact details at the top, and the rest sorted
 * into the sections a resume would have. Nothing here is stored; these are pure, total functions
 * over the same `Fact[]` the bank already holds, so the organized view and the raw table are two
 * renderings of one working copy.
 *
 * Two rules keep it honest:
 *   - `sectionOf` returns exactly one section for every fact, so grouping is total — no fact is
 *     dropped and none is shown twice.
 *   - `extractIdentity` never invents: a field it cannot find in the facts (or in a standard
 *     answer an ingest happened to write) is simply absent, so the caller omits the row.
 *
 * `visibleGaps` is the same idea applied to the gaps list — a pure filter at render, so what is
 * stored stays exactly what the ingest wrote.
 *
 * `tests/profileView.test.ts` pins the mapping and the extraction.
 */

export type Section = 'Contact' | 'Education' | 'Experience' | 'Projects' | 'Skills' | 'Other'

/** The order sections are shown in — identity-ish first, the catch-all last. */
export const SECTION_ORDER: readonly Section[] = [
  'Contact',
  'Education',
  'Experience',
  'Projects',
  'Skills',
  'Other',
]

/**
 * Section-name-like tags map straight to a section. Topic tags an ingest writes — `backend`,
 * `payments`, `go` — deliberately do NOT appear here: they describe what a fact is about, not
 * which resume section it belongs to, so they fall through to the claim heuristics and then to
 * Other. Keeping the map to section words is what makes it predictable.
 */
const TAG_SECTION: Record<string, Section> = {
  contact: 'Contact',
  email: 'Contact',
  'e-mail': 'Contact',
  phone: 'Contact',
  mobile: 'Contact',
  location: 'Contact',
  address: 'Contact',
  website: 'Contact',
  url: 'Contact',
  linkedin: 'Contact',
  links: 'Contact',

  education: 'Education',
  degree: 'Education',
  academic: 'Education',
  academics: 'Education',
  school: 'Education',
  university: 'Education',
  college: 'Education',
  gpa: 'Education',
  coursework: 'Education',
  certification: 'Education',
  certifications: 'Education',
  diploma: 'Education',

  experience: 'Experience',
  work: 'Experience',
  employment: 'Experience',
  job: 'Experience',
  role: 'Experience',
  position: 'Experience',
  career: 'Experience',
  leadership: 'Experience',
  management: 'Experience',
  mentorship: 'Experience',
  mentoring: 'Experience',
  promotion: 'Experience',
  tenure: 'Experience',
  oncall: 'Experience',
  'on-call': 'Experience',

  project: 'Projects',
  projects: 'Projects',
  oss: 'Projects',
  'open-source': 'Projects',
  opensource: 'Projects',
  'side-project': 'Projects',
  hackathon: 'Projects',

  skill: 'Skills',
  skills: 'Skills',
  tool: 'Skills',
  tools: 'Skills',
  framework: 'Skills',
  frameworks: 'Skills',
  stack: 'Skills',
  tech: 'Skills',
  technology: 'Skills',
  technologies: 'Skills',
  proficiency: 'Skills',
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const EMAIL_RE_G = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL_RE =
  /(?:https?:\/\/|www\.)[^\s)]+|\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|io|dev|org|net|me|co|app|ai|gg|xyz)\b(?:\/[^\s)]*)?/i
/** A run of phone-ish characters; the digit count (not the shape) is what qualifies it. */
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/
/** "City, Region" and nothing else: exactly one comma, both halves capitalised words. */
const CITY_RE = /^[A-Z][A-Za-z.'-]+(?:\s[A-Za-z.'-]+)*,\s[A-Z][A-Za-z.'-]+(?:\s[A-Za-z.'-]+)*$/
const EDUCATION_RE =
  /\b(b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?b\.?a\.?|ph\.?\s?d|bachelor'?s?|master'?s?|doctorate|undergraduate|university|college|g\.?p\.?a\.?|graduated|majored?\sin|degree\sin)\b/i
const PROJECT_RE =
  /\b(open[-\s]source|github\sstars?|\d+\sstars|side\sproject|personal\sproject|hackathon)\b/i
const EXPERIENCE_RE =
  /\b(senior|junior|staff|principal|lead|led|manager|managed|manages|engineer|developer|analyst|designer|intern|consultant|director|on-?call|mentors?|mentored|promoted|reduced|cut|migrat\w*|shipped|owns?|owned|built|maintained|responsible\sfor|years?\sof\sexperience)\b/i

function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length
}

/** A phone number is 10–15 digits; that count is what keeps metrics like "12,000/day" out. */
function hasPhone(claim: string): boolean {
  const m = PHONE_RE.exec(claim)
  if (!m) return false
  const d = digitCount(m[0])
  return d >= 10 && d <= 15
}

/**
 * The one section a fact belongs to. Tags win first (a `education` tag is an explicit signal),
 * then the claim's own shape, and everything unaccounted-for is Other. Total by construction.
 */
export function sectionOf(fact: Fact): Section {
  for (const tag of fact.tags) {
    const mapped = TAG_SECTION[tag.trim().toLowerCase()]
    if (mapped) return mapped
  }
  const claim = fact.claim.trim()
  if (EMAIL_RE.test(claim) || URL_RE.test(claim) || hasPhone(claim) || CITY_RE.test(claim))
    return 'Contact'
  if (EDUCATION_RE.test(claim)) return 'Education'
  if (PROJECT_RE.test(claim)) return 'Projects'
  if (EXPERIENCE_RE.test(claim)) return 'Experience'
  return 'Other'
}

/** The facts partitioned into their sections, in SECTION_ORDER, empty sections dropped. */
export function groupFacts(facts: Fact[]): { section: Section; facts: Fact[] }[] {
  const buckets = new Map<Section, Fact[]>()
  for (const fact of facts) {
    const section = sectionOf(fact)
    const list = buckets.get(section)
    if (list) list.push(fact)
    else buckets.set(section, [fact])
  }
  return SECTION_ORDER.flatMap((section) => {
    const list = buckets.get(section)
    return list && list.length ? [{ section, facts: list }] : []
  })
}

/**
 * The tag prefix that says which named company, school or project a fact belongs to. The
 * extractor writes it (`entity:Fenwick`) and reconcile adds it to stored facts that are missing
 * it; everything below is the reading side, and it is deliberately tolerant — a bank that
 * predates the tag still sorts, off the claims alone.
 */
export const ENTITY_PREFIX = 'entity:'

/** The bucket for everything that belongs to no named entity. Shown last, never first. */
export const GENERAL = 'General'

/** The entity a fact's own tags name, prefix stripped, or null. The first such tag wins. */
export function tagEntity(fact: Fact): string | null {
  for (const tag of fact.tags) {
    const trimmed = tag.trim()
    if (!trimmed.toLowerCase().startsWith(ENTITY_PREFIX)) continue
    const name = trimmed.slice(ENTITY_PREFIX.length).trim()
    if (name) return name
  }
  return null
}

/**
 * The proper name a claim says it happened "at" — `Owns payments at Fenwick` → `Fenwick`.
 *
 * Deliberately narrow: a run of capitalised words immediately after " at ", stopping at the
 * first word that is not one. That keeps "at 12,000 requests/day" and "at scale" out, and it is
 * why "at Fenwick, handling 12,000/day" yields the company rather than the sentence.
 */
export function claimEntity(claim: string): string | null {
  const m = /\bat\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*)*)/.exec(claim)
  return m ? m[1] : null
}

/**
 * The names worth sorting a section by: every name a fact TAGS with, plus every name at least
 * two claims say they happened at. One claim mentioning a place is a mention; two is a column.
 *
 * Matching is case-insensitive, and the form a tag uses wins over the form a claim uses — the
 * tag is the deliberate statement, the claim is prose.
 */
export function knownEntities(facts: Fact[]): string[] {
  const canonical = new Map<string, string>()
  for (const fact of facts) {
    const tagged = tagEntity(fact)
    if (tagged) canonical.set(tagged.toLowerCase(), tagged)
  }
  const mentions = new Map<string, { name: string; count: number }>()
  for (const fact of facts) {
    if (tagEntity(fact)) continue // a tagged fact has already spoken for itself
    const name = claimEntity(fact.claim)
    if (!name) continue
    const key = name.toLowerCase()
    const seen = mentions.get(key)
    if (seen) seen.count += 1
    else mentions.set(key, { name, count: 1 })
  }
  for (const [key, { name, count }] of mentions) {
    if (count >= 2 && !canonical.has(key)) canonical.set(key, name)
  }
  return [...canonical.values()]
}

/**
 * Which entity one fact belongs to: its tag if it has one, else the name its claim says it
 * happened at — but only when that name is one the bank already knows. A claim's mention of a
 * place nothing else corroborates is not a column of its own; it stays General.
 */
export function entityOf(fact: Fact, known: readonly string[]): string | null {
  const tagged = tagEntity(fact)
  if (tagged) return tagged
  const mentioned = claimEntity(fact.claim)
  if (!mentioned) return null
  return known.find((name) => name.toLowerCase() === mentioned.toLowerCase()) ?? null
}

export interface EntityGroup {
  /** The entity's name, or `GENERAL` for the facts that belong to none. */
  entity: string
  facts: Fact[]
}

/**
 * One section's facts, sub-grouped by entity: named groups in the order they first appear, then
 * General. Total, like `groupFacts` — no fact is dropped and none appears twice.
 *
 * A bank with nothing to sort by comes back as one General group, which is how the caller knows
 * to render the section flat rather than under a sub-heading that says nothing.
 */
export function groupByEntity(facts: Fact[], known: readonly string[]): EntityGroup[] {
  const buckets = new Map<string, EntityGroup>()
  for (const fact of facts) {
    const name = entityOf(fact, known) ?? GENERAL
    const key = name === GENERAL ? GENERAL : name.toLowerCase()
    const bucket = buckets.get(key)
    if (bucket) bucket.facts.push(fact)
    else buckets.set(key, { entity: name, facts: [fact] })
  }
  const named = [...buckets.values()].filter((g) => g.entity !== GENERAL)
  const general = buckets.get(GENERAL)
  return general ? [...named, general] : named
}

export interface Identity {
  name?: string
  email?: string
  phone?: string
  website?: string
  location?: string
}

/** Keys an ingest might invent that carry an identity field — none of the eight standard keys do. */
const STD_ALIASES: Record<keyof Identity, string[]> = {
  name: ['name', 'full_name', 'fullname'],
  email: ['email', 'email_address'],
  phone: ['phone', 'phone_number', 'mobile'],
  website: ['website', 'url', 'portfolio', 'portfolio_url'],
  location: ['location', 'city', 'address'],
}

function fromStandard(answers: Record<string, string>, aliases: string[]): string | undefined {
  for (const key of Object.keys(answers)) {
    if (aliases.includes(key.trim().toLowerCase())) {
      const value = answers[key]?.trim()
      if (value && value.toUpperCase() !== 'UNKNOWN') return value
    }
  }
  return undefined
}

/**
 * Name / email / phone / website / location, pulled from the facts (and from any standard answer
 * an ingest wrote that happens to hold one). A field that cannot be found is left off — the block
 * shows what is known and never guesses the rest.
 */
export function extractIdentity(
  facts: Fact[],
  standardAnswers: Record<string, string> = {},
): Identity {
  const identity: Identity = {
    name: fromStandard(standardAnswers, STD_ALIASES.name),
    email: fromStandard(standardAnswers, STD_ALIASES.email),
    phone: fromStandard(standardAnswers, STD_ALIASES.phone),
    website: fromStandard(standardAnswers, STD_ALIASES.website),
    location: fromStandard(standardAnswers, STD_ALIASES.location),
  }

  for (const fact of facts) {
    const claim = fact.claim.trim()
    const tags = fact.tags.map((t) => t.trim().toLowerCase())

    if (!identity.email) {
      const m = EMAIL_RE.exec(claim)
      if (m) identity.email = m[0]
    }
    if (!identity.website) {
      // Strip any email first so its domain can't be mistaken for a site.
      const m = URL_RE.exec(claim.replace(EMAIL_RE_G, ' '))
      if (m) identity.website = m[0].replace(/[.,;]+$/, '')
    }
    if (!identity.phone && hasPhone(claim)) {
      const m = PHONE_RE.exec(claim)
      if (m) identity.phone = m[0].trim()
    }
    if (!identity.name && (tags.includes('name') || tags.includes('identity'))) {
      identity.name = claim
    }
    if (!identity.location) {
      if (tags.includes('location')) identity.location = claim
      else if (tags.includes('contact') && CITY_RE.test(claim)) identity.location = claim
    }
  }

  // Absent fields stay absent, so callers can omit a row by truthiness.
  ;(Object.keys(identity) as (keyof Identity)[]).forEach((key) => {
    if (!identity[key]) delete identity[key]
  })
  return identity
}

/**
 * The territory the Standard answers section already covers, one pattern per standard key
 * (plus location, which the identity block holds). An ingest that has just read a resume with
 * no salary in it reliably reports "no salary expectation stated" as a gap — which is true,
 * and is also the exact question the row above is already asking, with a typed control and an
 * amber "only you know this" beside it. Asking it twice in two different shapes is the kind of
 * duplication that makes a form feel like it is not listening.
 *
 * Every pattern is deliberately narrow: showing a duplicate is a smaller failure than silently
 * dropping a real gap, so a phrase has to be unmistakably one of the eight to be filtered.
 * `\blocation\b` does not match "relocation" — there is no word boundary inside it.
 */
const STANDARD_TERRITORY: readonly RegExp[] = [
  /\bwork authoriz|\bauthoriz\w* to work\b|\bright to work\b|\beligib\w* to work\b/i,
  /\bvisa\b|\bsponsorship\b|\bwork permit\b/i,
  /\brelocat\w*/i,
  /\bsalary\b|\bcompensation\b|\bpay expectation/i,
  /\bnotice period\b/i,
  /\bstart date\b|\bearliest start\b|\bavailability to start\b/i,
  /\bclearance\b/i,
  /\bremote or on-?site\b|\bremote\b.{0,20}\bpreference\b|\bon-?site\b.{0,20}\bpreference\b/i,
  /\blocation\b/i,
]

/**
 * The gaps still worth putting in front of someone: everything the Standard answers section
 * is not already asking. Pure and order-preserving, so the caller can filter at render and
 * keep `profile.gaps` exactly as the ingest wrote it — the stored list is the model's output,
 * not a view of it.
 */
export function visibleGaps(gaps: string[]): string[] {
  return gaps.filter((gap) => !STANDARD_TERRITORY.some((re) => re.test(gap)))
}

/** One past the highest `f<n>` in use — the rule the fact bank and `mergeIngest` both follow. */
export function nextFactId(facts: Fact[]): string {
  const numbers = facts.map((f) => Number(/^f(\d+)$/.exec(f.id)?.[1] ?? 0))
  return `f${Math.max(0, ...numbers) + 1}`
}

/**
 * Turn an answered gap into a fact. The answer is the claim; its source is the question the
 * candidate answered, so the provenance stays visible; and `from-you` marks it as theirs.
 */
export function factFromGapAnswer(facts: Fact[], gap: string, answer: string): Fact {
  return {
    id: nextFactId(facts),
    claim: answer.trim(),
    sourceSnippet: `You answered: ${gap}`,
    tags: ['from-you'],
  }
}
