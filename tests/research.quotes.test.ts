import { describe, it, expect } from 'vitest'
import { isStale, normalizeWs, verifyQuotes } from '@/lib/research/quotes'

const TEXT = `The onsite was four rounds.\n\nTwo   coding, one system   design,\none behavioral with the hiring manager.`

describe('verifyQuotes', () => {
  it('keeps a quote that appears verbatim once whitespace is normalised', () => {
    expect(verifyQuotes(['Two coding, one system design, one behavioral'], TEXT)).toEqual([
      'Two coding, one system design, one behavioral',
    ])
  })
  it('drops a quote the text does not contain, a paraphrase included', () => {
    expect(verifyQuotes(['The onsite had five rounds.'], TEXT)).toEqual([])
  })
  it('drops a quote over 240 characters and dedupes', () => {
    const q = 'The onsite was four rounds.'
    expect(verifyQuotes([q, q, 'x'.repeat(241)], TEXT)).toEqual([q])
  })
  it('never lets an empty quote through', () => {
    expect(verifyQuotes(['', '   '], TEXT)).toEqual([])
  })
})

describe('normalizeWs', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeWs('  a \n\n b\t c  ')).toBe('a b c')
  })
})

describe('isStale', () => {
  const now = '2026-09-02T00:00:00.000Z'
  it('is stale only when a date says so', () => {
    expect(isStale('2024-08-01', now)).toBe(true)
  })
  it('is fresh inside two years', () => {
    expect(isStale('2024-10-01', now)).toBe(false)
    expect(isStale('2026-08-30T12:00:00Z', now)).toBe(false)
  })
  it('says nothing about a write-up it cannot place in time', () => {
    // Almost nothing on the open web is dated. Calling all of it stale put the same warning
    // on twelve guides out of thirteen, first-hand accounts included; "date not stated" is
    // the honest thing to say there, and the screen says it separately.
    expect(isStale(undefined, now)).toBe(false)
    expect(isStale('garbage', now)).toBe(false)
  })
})
