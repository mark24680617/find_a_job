import { STANDARD_KEYS } from '@/ai/prompts/profileIngest'

/**
 * The presentation + serialization layer for the eight standard answers.
 *
 * Storage does not change: `profile.standardAnswers` stays `Record<string,string>`, "UNKNOWN"
 * stays the not-answered sentinel, and `profileIngest` keeps writing plain strings. What this
 * file adds is a *shape* for each answer — a yes/no, a date, a salary — so the profile screen can
 * offer the right control instead of a blank box, plus a pair of pure functions that move each
 * shape to and from its one canonical string.
 *
 * The contract the tests hold us to:
 *   - parseField(kind, serializeField(v))  deep-equals v      — a typed value round-trips.
 *   - serializeField(parseField(kind, s))  is a fixed point   — re-saving never drifts.
 *   - a value that does not fit its kind (an old free-text answer, something an ingest wrote)
 *     parses to { type: 'text' } and serializes back unchanged — nothing stored is ever dropped.
 */

export type StandardKey = (typeof STANDARD_KEYS)[number]

export type FieldKind = 'yesno' | 'yesno_note' | 'multiselect' | 'date' | 'select' | 'money'

export interface StandardField {
  key: StandardKey
  label: string
  kind: FieldKind
}

export type YesNo = 'Yes' | 'No'
export type Relocation = 'Yes' | 'No' | 'Depends'
export type RemoteOption = 'Remote' | 'On-site' | 'Hybrid'
export type NoticeOption = 'Immediate' | '2 weeks' | '1 month' | '2 months'
export type MoneyPeriod = 'year' | 'hour'

/**
 * The parsed form of a stored answer. `unknown` is the amber unanswered state; `text` is the
 * loss-proof fallback for a stored string that does not fit its kind.
 */
export type StdValue =
  | { type: 'unknown' }
  | { type: 'text'; text: string }
  | { type: 'yesno'; value: YesNo }
  | { type: 'reloc'; value: Relocation; note: string }
  | { type: 'multiselect'; values: RemoteOption[] }
  | { type: 'date'; value: string }
  | { type: 'asap' }
  | { type: 'notice'; value: NoticeOption }
  | { type: 'notice_other'; text: string }
  | { type: 'money'; amount: number; period: MoneyPeriod }

/** The not-answered sentinel — shared with `profileIngest` and `mergeIngest`. */
export const UNKNOWN = 'UNKNOWN'

export const REMOTE_OPTIONS: readonly RemoteOption[] = ['Remote', 'On-site', 'Hybrid']
export const NOTICE_OPTIONS: readonly NoticeOption[] = ['Immediate', '2 weeks', '1 month', '2 months']

/** The separator between a choice and its free-text note ("Depends — within 50 miles"). */
const NOTE_SEP = ' — '

const FIELD_SPEC: Record<StandardKey, { label: string; kind: FieldKind }> = {
  work_authorization: { label: 'Work authorization', kind: 'yesno' },
  visa_sponsorship_needed: { label: 'Visa sponsorship needed', kind: 'yesno' },
  relocation: { label: 'Open to relocation', kind: 'yesno_note' },
  remote_onsite_preference: { label: 'Remote or on-site', kind: 'multiselect' },
  earliest_start_date: { label: 'Earliest start date', kind: 'date' },
  notice_period: { label: 'Notice period', kind: 'select' },
  salary_expectation: { label: 'Salary expectation', kind: 'money' },
  security_clearance: { label: 'Security clearance', kind: 'yesno' },
}

/**
 * The eight fields in the order STANDARD_KEYS pins. STANDARD_KEYS stays the one source of the
 * key list; this only attaches a label and a control kind to each, and the Record type above
 * makes the compiler check that every key has both.
 */
export const STANDARD_FIELDS: StandardField[] = STANDARD_KEYS.map((key) => ({
  key,
  label: FIELD_SPEC[key].label,
  kind: FIELD_SPEC[key].kind,
}))

/** Blank, missing, or the sentinel — all mean "the candidate has not answered this yet". */
function isBlank(stored: string): boolean {
  const t = stored.trim()
  return t === '' || t.toUpperCase() === UNKNOWN
}

export function parseField(kind: FieldKind, stored: string): StdValue {
  if (isBlank(stored)) return { type: 'unknown' }
  const raw = stored.trim()
  switch (kind) {
    case 'yesno':
      return parseYesNo(raw)
    case 'yesno_note':
      return parseReloc(raw)
    case 'multiselect':
      return parseMultiselect(raw)
    case 'date':
      return parseDate(raw)
    case 'select':
      return parseNotice(raw)
    case 'money':
      return parseMoney(raw)
  }
}

export function serializeField(v: StdValue): string {
  switch (v.type) {
    case 'unknown':
      return UNKNOWN
    case 'text':
      return v.text
    case 'yesno':
      return v.value
    case 'reloc':
      return v.note.trim() ? `${v.value}${NOTE_SEP}${v.note.trim()}` : v.value
    case 'multiselect':
      return v.values.length ? canonicalRemote(v.values).join(', ') : UNKNOWN
    case 'date':
      return v.value
    case 'asap':
      return 'ASAP'
    case 'notice':
      return v.value
    case 'notice_other':
      return v.text.trim() ? `Other${NOTE_SEP}${v.text.trim()}` : 'Other'
    case 'money':
      return `$${formatAmount(v.amount)} per ${v.period}`
  }
}

function parseYesNo(raw: string): StdValue {
  const low = raw.toLowerCase()
  if (low === 'yes') return { type: 'yesno', value: 'Yes' }
  if (low === 'no') return { type: 'yesno', value: 'No' }
  return { type: 'text', text: raw }
}

function parseReloc(raw: string): StdValue {
  const [head, ...rest] = raw.split(NOTE_SEP)
  const choice = matchReloc(head.trim())
  if (!choice) return { type: 'text', text: raw }
  return { type: 'reloc', value: choice, note: rest.join(NOTE_SEP).trim() }
}

function matchReloc(s: string): Relocation | null {
  const low = s.toLowerCase()
  if (low === 'yes') return 'Yes'
  if (low === 'no') return 'No'
  if (low === 'depends') return 'Depends'
  return null
}

function parseMultiselect(raw: string): StdValue {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const mapped = tokens.map(matchRemote)
  if (tokens.length === 0 || mapped.some((m) => m === null)) return { type: 'text', text: raw }
  return { type: 'multiselect', values: canonicalRemote(mapped as RemoteOption[]) }
}

/** "On-site" / "on site" / "onsite" all collapse to the same token before matching. */
function matchRemote(s: string): RemoteOption | null {
  switch (s.toLowerCase().replace(/[^a-z]/g, '')) {
    case 'remote':
      return 'Remote'
    case 'onsite':
      return 'On-site'
    case 'hybrid':
      return 'Hybrid'
    default:
      return null
  }
}

/** Fixed option order, de-duplicated — the one canonical arrangement of a selection. */
function canonicalRemote(values: RemoteOption[]): RemoteOption[] {
  return REMOTE_OPTIONS.filter((o) => values.includes(o))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function parseDate(raw: string): StdValue {
  if (raw.toUpperCase() === 'ASAP') return { type: 'asap' }
  if (ISO_DATE.test(raw) && isRealDate(raw)) return { type: 'date', value: raw }
  return { type: 'text', text: raw }
}

/** Guards against a well-shaped but impossible date like 2026-02-30 rolling silently forward. */
function isRealDate(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

function parseNotice(raw: string): StdValue {
  const [head, ...rest] = raw.split(NOTE_SEP)
  if (head.trim().toLowerCase() === 'other') {
    return { type: 'notice_other', text: rest.join(NOTE_SEP).trim() }
  }
  const opt = NOTICE_OPTIONS.find((o) => o.toLowerCase() === raw.toLowerCase())
  return opt ? { type: 'notice', value: opt } : { type: 'text', text: raw }
}

/**
 * Money parses ONLY when the whole string is a single clean amount: an optional `USD`, an
 * optional `$`, digits with optional thousands separators, an optional decimal, and an optional
 * trailing period token (`per year` / `per hour` / `/yr` / `/hr`). Anything else — a range
 * (`120k-150k`), a `k`/`m` suffix, extra prose (`$140k base + equity`, `HR approved 150000`),
 * or a word (`DOE`, `competitive`) — is NOT money and returns text, so the original string
 * reaches a plain input and serializes back unchanged. `k`/`m` are deliberately treated as text
 * (no ×1000 expansion) for MVP. The period comes only from the trailing token, so an `HR` sitting
 * inside other prose can never be read as hourly.
 */
const MONEY_RE =
  /^(?:USD\s*)?\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s*(?:per\s+|\/)\s*(year|yr|hour|hr))?$/i

function parseMoney(raw: string): StdValue {
  const m = MONEY_RE.exec(raw)
  if (!m) return { type: 'text', text: raw }
  const amount = Number(m[1].replace(/,/g, ''))
  if (!Number.isFinite(amount)) return { type: 'text', text: raw }
  const unit = m[2]?.toLowerCase()
  const period: MoneyPeriod = unit === 'hour' || unit === 'hr' ? 'hour' : 'year'
  return { type: 'money', amount, period }
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
