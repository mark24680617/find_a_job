import { describe, it, expect } from 'vitest'
import { dateOnly } from '@/lib/dates'

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
