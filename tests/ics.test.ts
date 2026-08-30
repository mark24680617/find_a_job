import { describe, it, expect } from 'vitest'
import { buildIcs } from '@/lib/ics'

/**
 * The .ics file is the one artefact this product hands to another program rather than to a
 * person, so the format is the contract: a calendar either parses it or drops the invitation
 * on the floor, and there is no error message in between. These pin the three things that
 * silently break that — the wrong clock, unescaped punctuation, and bare newlines.
 */

// A 10am Pacific screen. The zone offset is the point: calendars read a `Z` stamp as UTC, so
// the local time has to be converted rather than copied.
const screen = {
  title: 'Recruiter screen — Nectir',
  startIso: '2026-09-05T10:00:00-07:00',
  durationMin: 60,
  description: 'Nectir — Founding Engineer',
}

/** Content lines, with the folding of over-long ones undone (RFC 5545 §3.1). */
const lines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n')

describe('buildIcs', () => {
  it('wraps one event in a VCALENDAR a calendar client will accept', () => {
    const ics = buildIcs(screen)
    expect(lines(ics)[0]).toBe('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:')
    expect(lines(ics)).toContain('BEGIN:VEVENT')
    expect(lines(ics)).toContain('END:VEVENT')
    expect(lines(ics).filter(Boolean).at(-1)).toBe('END:VCALENDAR')
  })

  it('writes the start in UTC, whatever zone the notice was written in', () => {
    expect(lines(buildIcs(screen))).toContain('DTSTART:20260905T170000Z')
    // The same instant, already expressed as UTC, has to land on the same stamp.
    expect(lines(buildIcs({ ...screen, startIso: '2026-09-05T17:00:00.000Z' }))).toContain(
      'DTSTART:20260905T170000Z',
    )
  })

  it('ends the event durationMin after it starts', () => {
    expect(lines(buildIcs(screen))).toContain('DTEND:20260905T180000Z')
    expect(lines(buildIcs({ ...screen, durationMin: 45 }))).toContain('DTEND:20260905T174500Z')
  })

  it('stamps DTSTAMP in the same UTC form', () => {
    expect(buildIcs(screen)).toMatch(/\r\nDTSTAMP:\d{8}T\d{6}Z\r\n/)
  })

  it('escapes the characters that would otherwise end a property early', () => {
    const ics = buildIcs({
      ...screen,
      title: 'Panel: Ada, Grace; and Alan',
      description: 'Bring the doc, the deck; C:\\notes\nsecond line',
    })
    const body = lines(ics)
    expect(body).toContain('SUMMARY:Panel: Ada\\, Grace\\; and Alan')
    expect(body).toContain('DESCRIPTION:Bring the doc\\, the deck\\; C:\\\\notes\\nsecond line')
  })

  it('separates every line with CRLF and never a bare newline', () => {
    const ics = buildIcs(screen)
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics).not.toMatch(/(^|[^\r])\n/)
    expect(ics.split('\r\n').length).toBeGreaterThan(10)
  })

  it('folds a line too long for the format instead of emitting it whole', () => {
    const ics = buildIcs({ ...screen, description: 'x'.repeat(300) })
    for (const line of ics.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75)
    // Unfolding puts it back exactly.
    expect(lines(ics)).toContain(`DESCRIPTION:${'x'.repeat(300)}`)
  })

  it('escapes a lone CR, which no CRLF check would catch', () => {
    // A notice pasted from an old Mac editor carries bare CRs. Left alone, one ends the
    // DESCRIPTION line mid-property and the rest of the text lands nowhere legible.
    const ics = buildIcs({ ...screen, description: 'first\rsecond' })
    expect(lines(ics)).toContain('DESCRIPTION:first\\nsecond')
    expect(ics).not.toMatch(/\r(?!\n)/)
  })

  it('keeps a caller-supplied UID across the edits that cause a re-export', () => {
    // A reschedule and an added interviewer are exactly when somebody exports again. The
    // UID has to survive both, or the calendar gains a second event beside the stale one.
    const round = { ...screen, uid: 'r-1@find-a-job' }
    const uid = (ics: string) => lines(ics).find((l) => l.startsWith('UID:'))

    expect(uid(buildIcs(round))).toBe('UID:r-1@find-a-job')
    expect(uid(buildIcs({ ...round, startIso: '2026-09-08T14:00:00-07:00' }))).toBe(
      'UID:r-1@find-a-job',
    )
    expect(uid(buildIcs({ ...round, description: 'Nectir — with one more interviewer' }))).toBe(
      'UID:r-1@find-a-job',
    )
    expect(uid(buildIcs({ ...round, uid: 'r-2@find-a-job' }))).toBe('UID:r-2@find-a-job')
  })

  it('falls back to a content UID that separates two events, for a caller with no id', () => {
    const uid = (ics: string) => lines(ics).find((l) => l.startsWith('UID:'))
    expect(uid(buildIcs(screen))).toBe(uid(buildIcs(screen)))
    expect(uid(buildIcs(screen))).not.toBe(uid(buildIcs({ ...screen, title: 'Technical — Nectir' })))
    expect(uid(buildIcs(screen))).not.toBe(
      uid(buildIcs({ ...screen, startIso: '2026-09-06T10:00:00-07:00' })),
    )
  })

  it('refuses a start time it cannot read rather than writing a broken stamp', () => {
    expect(() => buildIcs({ ...screen, startIso: 'next Tuesday' })).toThrow(/startIso/)
  })
})
