/**
 * One interview round as an iCalendar file (RFC 5545).
 *
 * This is the only thing the product hands to another program instead of to a person. A
 * calendar that dislikes the file does not complain — it drops the event — so the three
 * quiet ways that happens are all handled here: times are written in UTC (a local stamp
 * lands an interview an hour off), text is escaped (an unescaped comma ends a property
 * early and truncates the rest of the line), and lines end in CRLF (the spec's line break,
 * and the one Outlook still insists on).
 *
 * No timezone component and no recurrence: a round happens once, at a known instant.
 */

export interface IcsEvent {
  title: string
  startIso: string
  durationMin: number
  description: string
  /**
   * The identity of the thing this event *is*, from a caller that has one — a round id, say.
   * A calendar keys on UID, so this is what makes a re-export replace the entry rather than
   * add a second one, and it therefore has to survive the two edits that cause a re-export:
   * a reschedule and a changed interviewer list.
   */
  uid?: string
}

const CRLF = '\r\n'
const MAX_LINE = 75 // RFC 5545 §3.1

/** `2026-09-05T10:00:00-07:00` → `20260905T170000Z`. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * RFC 5545 §3.3.11. Backslash first — escaping it after the others would double the
 * backslashes they just introduced.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // Every line break, including a lone CR: an unescaped one would end the content line
    // mid-property and put the rest of the text where no parser expects it.
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * RFC 5545 §3.1: a content line runs to 75 octets, and continues on the next line behind a
 * single space. Split by code point rather than by index so a name outside ASCII can never
 * be cut in half. Note this counts code points, not octets: a line of non-ASCII text is
 * folded at 75 characters, which is *more* than 75 octets, so it can still exceed the limit.
 * Deliberate for now — every parser we care about accepts the over-long line; counting bytes
 * without splitting a code point is the fix if one ever doesn't.
 */
function fold(line: string): string {
  const chars = Array.from(line)
  if (chars.length <= MAX_LINE) return line
  const parts = [chars.slice(0, MAX_LINE).join('')]
  for (let i = MAX_LINE; i < chars.length; i += MAX_LINE - 1) {
    parts.push(' ' + chars.slice(i, i + MAX_LINE - 1).join(''))
  }
  return parts.join(CRLF)
}

/**
 * The fallback UID for a caller with no id of its own: FNV-1a over the event's content, plus
 * its start. Two different events get two different UIDs — which is all this can promise.
 * It is NOT stable across an edit: change the time or the people and the UID changes with
 * them, so the calendar gains a second entry rather than replacing the first. A caller that
 * wants a re-export to *replace* has to pass `uid`.
 */
function contentUid(e: IcsEvent, start: Date): string {
  const seed = `${e.title} ${e.description} ${e.durationMin}`
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193) >>> 0
  }
  return `${stamp(start)}-${hash.toString(16)}@find-a-job`
}

export function buildIcs(e: IcsEvent): string {
  const start = new Date(e.startIso)
  // A stored datetime the parse never resolved would otherwise become `Invalid Date` and
  // throw somewhere further down, or worse, be written out as a plausible-looking stamp.
  if (Number.isNaN(start.getTime())) throw new Error(`unreadable startIso: ${e.startIso}`)
  const end = new Date(start.getTime() + e.durationMin * 60_000)

  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Find a Job//Interview//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${e.uid ?? contentUid(e, start)}`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(fold)
      .join(CRLF) + CRLF
  )
}
