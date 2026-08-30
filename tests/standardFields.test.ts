import { describe, it, expect } from 'vitest'
import { STANDARD_KEYS } from '@/ai/prompts/profileIngest'
import {
  STANDARD_FIELDS,
  parseField,
  serializeField,
  UNKNOWN,
  type FieldKind,
  type StdValue,
} from '@/lib/standardFields'

/**
 * The serialization layer is the load-bearing part of typed standard answers: the profile is
 * still stored as `Record<string,string>`, so every control has to move its value to and from
 * one canonical string without ever dropping what was there. Two properties matter —
 *   parseField(kind, serializeField(v))    deep-equals v          (a typed value round-trips)
 *   serializeField(parseField(kind, s))    is a fixed point       (re-saving never drifts)
 * — plus: UNKNOWN is preserved, and anything that does not fit its kind survives as text.
 */

/** serialize∘parse must be idempotent: normalising once, then again, changes nothing. */
function stable(kind: FieldKind, stored: string): string {
  const once = serializeField(parseField(kind, stored))
  const twice = serializeField(parseField(kind, once))
  expect(twice).toBe(once)
  return once
}

describe('STANDARD_FIELDS', () => {
  it('covers exactly the standard keys, in their pinned order', () => {
    expect(STANDARD_FIELDS.map((f) => f.key)).toEqual([...STANDARD_KEYS])
  })

  it('gives every field a non-empty label and a kind', () => {
    for (const field of STANDARD_FIELDS) {
      expect(field.label.trim().length).toBeGreaterThan(0)
      expect(field.kind).toBeTruthy()
    }
  })
})

describe('unanswered / UNKNOWN', () => {
  it('every kind reads UNKNOWN, "", and whitespace as unanswered', () => {
    for (const { kind } of STANDARD_FIELDS) {
      expect(parseField(kind, UNKNOWN)).toEqual({ type: 'unknown' })
      expect(parseField(kind, '')).toEqual({ type: 'unknown' })
      expect(parseField(kind, '   ')).toEqual({ type: 'unknown' })
    }
  })

  it('serializes the unanswered value back to UNKNOWN for every kind', () => {
    const v: StdValue = { type: 'unknown' }
    expect(serializeField(v)).toBe(UNKNOWN)
    for (const { kind } of STANDARD_FIELDS) expect(stable(kind, UNKNOWN)).toBe(UNKNOWN)
  })
})

describe('yesno', () => {
  it('round-trips Yes and No', () => {
    for (const value of ['Yes', 'No'] as const) {
      expect(parseField('yesno', serializeField({ type: 'yesno', value }))).toEqual({
        type: 'yesno',
        value,
      })
    }
  })

  it('serializes to the bare word', () => {
    expect(serializeField({ type: 'yesno', value: 'Yes' })).toBe('Yes')
    expect(serializeField({ type: 'yesno', value: 'No' })).toBe('No')
  })

  it('reads case-insensitively and normalises', () => {
    expect(parseField('yesno', 'yes')).toEqual({ type: 'yesno', value: 'Yes' })
    expect(stable('yesno', 'no')).toBe('No')
  })

  it('keeps an unrecognised answer as text rather than dropping it', () => {
    expect(parseField('yesno', 'Authorized in the EU only')).toEqual({
      type: 'text',
      text: 'Authorized in the EU only',
    })
    expect(stable('yesno', 'Authorized in the EU only')).toBe('Authorized in the EU only')
  })
})

describe('yesno_note (relocation)', () => {
  it('round-trips a choice with a note', () => {
    const v: StdValue = { type: 'reloc', value: 'Depends', note: 'within 50 miles' }
    expect(parseField('yesno_note', serializeField(v))).toEqual(v)
    expect(serializeField(v)).toBe('Depends — within 50 miles')
  })

  it('round-trips a bare choice (no note)', () => {
    const v: StdValue = { type: 'reloc', value: 'Yes', note: '' }
    expect(serializeField(v)).toBe('Yes')
    expect(parseField('yesno_note', 'Yes')).toEqual(v)
  })

  it('keeps a note that itself contains the separator', () => {
    const v: StdValue = { type: 'reloc', value: 'Depends', note: 'US — not the EU' }
    expect(parseField('yesno_note', serializeField(v))).toEqual(v)
  })

  it('falls back to text when the head is not a choice', () => {
    expect(parseField('yesno_note', 'Maybe later')).toEqual({ type: 'text', text: 'Maybe later' })
  })
})

describe('multiselect (remote / on-site)', () => {
  it('round-trips one and several options', () => {
    const v: StdValue = { type: 'multiselect', values: ['Remote', 'Hybrid'] }
    expect(parseField('multiselect', serializeField(v))).toEqual(v)
    expect(serializeField(v)).toBe('Remote, Hybrid')
  })

  it('normalises order and spelling', () => {
    expect(parseField('multiselect', 'Hybrid, remote')).toEqual({
      type: 'multiselect',
      values: ['Remote', 'Hybrid'],
    })
    expect(stable('multiselect', 'on site, HYBRID')).toBe('On-site, Hybrid')
  })

  it('falls back to text if any token is unrecognised', () => {
    expect(parseField('multiselect', 'Remote, Anywhere')).toEqual({
      type: 'text',
      text: 'Remote, Anywhere',
    })
  })

  it('serializes an empty selection back to unanswered', () => {
    expect(serializeField({ type: 'multiselect', values: [] })).toBe(UNKNOWN)
  })
})

describe('date (earliest start)', () => {
  it('round-trips an ISO date', () => {
    const v: StdValue = { type: 'date', value: '2026-09-15' }
    expect(parseField('date', serializeField(v))).toEqual(v)
    expect(serializeField(v)).toBe('2026-09-15')
  })

  it('round-trips ASAP', () => {
    expect(serializeField({ type: 'asap' })).toBe('ASAP')
    expect(parseField('date', 'ASAP')).toEqual({ type: 'asap' })
    expect(parseField('date', 'asap')).toEqual({ type: 'asap' })
  })

  it('rejects an impossible date to text', () => {
    expect(parseField('date', '2026-02-30')).toEqual({ type: 'text', text: '2026-02-30' })
    expect(parseField('date', 'next month')).toEqual({ type: 'text', text: 'next month' })
  })
})

describe('select (notice period)', () => {
  it('round-trips a fixed option', () => {
    const v: StdValue = { type: 'notice', value: '2 weeks' }
    expect(parseField('select', serializeField(v))).toEqual(v)
    expect(serializeField(v)).toBe('2 weeks')
  })

  it('round-trips Other with and without a note', () => {
    const withText: StdValue = { type: 'notice_other', text: 'gardening leave until Nov' }
    expect(parseField('select', serializeField(withText))).toEqual(withText)
    expect(serializeField(withText)).toBe('Other — gardening leave until Nov')

    const bare: StdValue = { type: 'notice_other', text: '' }
    expect(serializeField(bare)).toBe('Other')
    expect(parseField('select', 'Other')).toEqual(bare)
  })

  it('keeps an unrecognised period as text', () => {
    expect(parseField('select', '3 weeks')).toEqual({ type: 'text', text: '3 weeks' })
  })
})

describe('money (salary)', () => {
  it('round-trips a yearly figure', () => {
    const v: StdValue = { type: 'money', amount: 145000, period: 'year' }
    expect(parseField('money', serializeField(v))).toEqual(v)
    expect(serializeField(v)).toBe('$145,000 per year')
  })

  it('round-trips an hourly figure with cents', () => {
    const v: StdValue = { type: 'money', amount: 62.5, period: 'hour' }
    expect(parseField('money', serializeField(v))).toEqual(v)
    expect(serializeField(v)).toBe('$62.5 per hour')
  })

  it('reads a bare number as a yearly amount and normalises it', () => {
    expect(parseField('money', '145000')).toEqual({ type: 'money', amount: 145000, period: 'year' })
    expect(stable('money', '145000')).toBe('$145,000 per year')
  })

  it('keeps a non-numeric answer as text', () => {
    expect(parseField('money', 'negotiable')).toEqual({ type: 'text', text: 'negotiable' })
  })

  it('never coerces a free-text or range salary into a number', () => {
    for (const s of [
      '120k-150k',
      '$140k base + equity',
      'HR approved 150000',
      'DOE',
      'competitive',
      '100,000 - 120,000',
      '$150,000 OTE',
    ]) {
      expect(parseField('money', s)).toEqual({ type: 'text', text: s })
      // The untouched string survives the round-trip through the text fallback.
      expect(serializeField(parseField('money', s))).toBe(s)
    }
  })

  it('accepts the controlled abbreviations (USD prefix, /yr, /hr)', () => {
    expect(parseField('money', 'USD 90,000')).toEqual({ type: 'money', amount: 90000, period: 'year' })
    expect(parseField('money', '90000/yr')).toEqual({ type: 'money', amount: 90000, period: 'year' })
    expect(parseField('money', '$75/hr')).toEqual({ type: 'money', amount: 75, period: 'hour' })
  })
})

describe('text fallback never drops a stored value', () => {
  it('serializes a text value back byte-for-byte', () => {
    expect(serializeField({ type: 'text', text: 'anything at all' })).toBe('anything at all')
  })
})
