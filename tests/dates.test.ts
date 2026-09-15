import { describe, it, expect } from 'vitest'
import { dateOnly, utcToday } from '@/lib/dates'

// Locale and zone are pinned so the assertion does not depend on the machine running it.
const opts = { locale: 'en-US', timeZone: 'UTC' }

describe('dateOnly', () => {
  it('formats an ISO instant as a short date', () => {
    expect(dateOnly('2026-08-28T02:51:50.000Z', opts)).toBe('Aug 28, 2026')
  })
  it('accepts the UTC string Firebase puts on user metadata', () => {
    expect(dateOnly('Fri, 28 Aug 2026 02:51:50 GMT', opts)).toBe('Aug 28, 2026')
  })
  it('shows a dash for nothing and for garbage', () => {
    expect(dateOnly(null, opts)).toBe('—')
    expect(dateOnly(undefined, opts)).toBe('—')
    expect(dateOnly('not a date', opts)).toBe('—')
  })
})

describe('utcToday', () => {
  it('is the UTC calendar date of the instant, as YYYY-MM-DD', () => {
    expect(utcToday(new Date('2026-09-14T12:00:00.000Z'))).toBe('2026-09-14')
  })
  it('is already tomorrow in UTC when it is still this evening further west', () => {
    // Half past eleven at night in California is 06:30 the next morning in UTC. The answer does
    // not depend on the zone of the machine running this, which is the point of reading UTC.
    expect(utcToday(new Date('2026-09-14T23:30:00-07:00'))).toBe('2026-09-15')
  })
})
