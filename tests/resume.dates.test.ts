import { describe, it, expect } from 'vitest'
import { findGaps, GAP_MONTHS, monthNumber, parseDateRange } from '@/lib/resume/dates'
import type { StoredResume } from '@/lib/resume/types'

// Every format here is one the spec's risk 6 inventory named, written out as the two raw sides
// the structure pass hands over. The rule under test is D4's: a side that cannot be read is
// null, never a guess, and a year with no month is a year — not January dressed up as a fact.

const TODAY = '2026-09-21'

const entry = (over: Partial<StoredResume['entries'][number]> = {}): StoredResume['entries'][number] => ({
  org: 'Marram Systems',
  role: 'Backend Engineer',
  fromRaw: 'Jan 2020',
  toRaw: 'Dec 2021',
  from: '2020-01',
  to: '2021-12',
  bulletIds: ['b1'],
  bulletLines: [3],
  ...over,
})

describe('parseDateRange', () => {
  it('reads a month name and resolves Present against the caller’s clock', () => {
    expect(parseDateRange('Jan 2020', 'Present', TODAY)).toEqual({ from: '2020-01', to: '2026-09' })
    expect(parseDateRange('January 2020', 'Current', TODAY)).toEqual({ from: '2020-01', to: '2026-09' })
    expect(parseDateRange('Jan. 2020', 'Now', TODAY)).toEqual({ from: '2020-01', to: '2026-09' })
  })

  it('reads a bare year as a year, not as a month it was never told', () => {
    expect(parseDateRange('2020', '2022', TODAY)).toEqual({ from: '2020', to: '2022' })
  })

  it('reads MM/YY on both sides, with the two-digit year resolved against today', () => {
    expect(parseDateRange('03/19', '06/21', TODAY)).toEqual({ from: '2019-03', to: '2021-06' })
  })

  it('reads the year out of a season and refuses the month', () => {
    expect(parseDateRange('Summer 2021', 'Winter 2022', TODAY)).toEqual({ from: '2021', to: '2022' })
  })

  it('reads the Chinese year-month form', () => {
    expect(parseDateRange('2020年3月', '2021年11月', TODAY)).toEqual({ from: '2020-03', to: '2021-11' })
  })

  it('returns null for anything it cannot read, and never guesses a neighbour', () => {
    expect(parseDateRange('sometime after uni', 'Dec 2021', TODAY)).toEqual({ from: null, to: '2021-12' })
    expect(parseDateRange('Jan 2020', '', TODAY)).toEqual({ from: '2020-01', to: null })
    expect(parseDateRange('Present', 'Present', TODAY)).toEqual({ from: null, to: '2026-09' })
  })

  it('splits a range that arrived whole on the from side', () => {
    expect(parseDateRange('Jan 2020 – Present', '', TODAY)).toEqual({ from: '2020-01', to: '2026-09' })
    expect(parseDateRange('2020-2022', '', TODAY)).toEqual({ from: '2020', to: '2022' })
    expect(parseDateRange('03/19–06/21', '', TODAY)).toEqual({ from: '2019-03', to: '2021-06' })
    expect(parseDateRange('2020年3月至今', '', TODAY)).toEqual({ from: '2020-03', to: '2026-09' })
    expect(parseDateRange('2020年3月至2021年11月', '', TODAY)).toEqual({ from: '2020-03', to: '2021-11' })
  })

  it('reads every form B3’s DATE_TOKEN hands over', () => {
    expect(parseDateRange('03.2019', '06.2021', TODAY)).toEqual({ from: '2019-03', to: '2021-06' })
    expect(parseDateRange('3.2019', 'Present', TODAY)).toEqual({ from: '2019-03', to: '2026-09' })
    expect(parseDateRange('03/2019', '06/2021', TODAY)).toEqual({ from: '2019-03', to: '2021-06' })
    expect(parseDateRange('Sept 2021', 'Sept. 2022', TODAY)).toEqual({ from: '2021-09', to: '2022-09' })
  })
})

describe('monthNumber', () => {
  it('widens a bare year to January on the from edge and December on the to edge', () => {
    expect(monthNumber('2020', 'from')).toBe(2020 * 12 + 1)
    expect(monthNumber('2020', 'to')).toBe(2020 * 12 + 12)
    expect(monthNumber('2020-06', 'from')).toBe(2020 * 12 + 6)
    expect(monthNumber('nonsense', 'to')).toBeNull()
  })
})

describe('findGaps', () => {
  it('reports a gap longer than six months, as a period and nothing else', () => {
    const gaps = findGaps([
      entry({ from: '2022-04', to: '2024-08' }),
      entry({ from: '2020-01', to: '2021-06' }),
    ])
    expect(gaps).toEqual([{ from: '2021-07', to: '2022-03', months: 9 }])
  })

  it('stays silent at exactly six months — the threshold is “over”', () => {
    // 2021-07 .. 2021-12 is six months, and GAP_MONTHS is the number it must exceed.
    expect(GAP_MONTHS).toBe(6)
    expect(findGaps([entry({ from: '2020-01', to: '2021-06' }), entry({ from: '2022-01', to: '2024-08' })])).toEqual([])
  })

  it('merges overlapping entries rather than reading the overlap as two runs', () => {
    expect(
      findGaps([
        entry({ from: '2020-01', to: '2022-03' }),
        entry({ from: '2021-06', to: '2024-08' }),
      ]),
    ).toEqual([])
  })

  it('refuses (null, not "no gaps") when any entry has a date it could not read', () => {
    // A gap computed over a partial set is a claim about a period the unreadable entry may
    // well cover. The dates-parseable check is what fires instead, and the gap row is not-run.
    expect(
      findGaps([
        entry({ from: '2020-01', to: '2021-06' }),
        entry({ from: null, to: null, fromRaw: 'sometime after uni', toRaw: '' }),
        entry({ from: '2024-01', to: '2026-09' }),
      ]),
    ).toBeNull()
  })

  it('refuses (null) when an entry ends before it begins, rather than reordering it', () => {
    expect(
      findGaps([entry({ from: '2015-01', to: '2016-01' }), entry({ from: '2022-01', to: '2019-01' })]),
    ).toBeNull()
  })

  it('never reports a gap after the last entry', () => {
    expect(findGaps([entry({ from: '2018-01', to: '2019-01' })])).toEqual([])
  })
})
