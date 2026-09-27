import { describe, it, expect } from 'vitest'
import { detectLanguage, headingName, structure } from '@/lib/resume/structure'
import type { StoredResume } from '@/lib/types'

// Lines in, structure out. Pure, so the whole surface is exercised from literals with no PDF:
// what counts as a heading, where an entry starts, which lines are one bullet, and which script
// the document is in. Every string below is fictional.

type Line = StoredResume['lines'][number]

/** Laid out the way a page is: one page, descending y, a fixed size unless a case needs otherwise. */
const page = (texts: string[], over: Partial<Line> = {}): Line[] =>
  texts.map((text, i) => ({ page: 1, x: 72, y: 720 - i * 14, size: 11, font: 'f1', text, ...over }))

const RESUME = page([
  'Dana Ellery',
  'dana.ellery@example.test · Portland, OR',
  'EXPERIENCE',
  'Senior Backend Engineer — Marram Systems    2021 – Present',
  '• Cut checkout latency from 900 ms to 180 ms across 40 services',
  '  and held it there through two peak seasons',
  '• Led the migration of the billing ledger to Postgres',
  'Backend Engineer — Fenwick Labs    Mar 2018 – 2021',
  '• Wrote the ingest pipeline that handles 2 million events a day',
  'SKILLS',
  'Postgres, TypeScript, Kubernetes',
])

describe('headingName', () => {
  it('folds case and punctuation, and answers null for anything not on the list', () => {
    expect(headingName('EXPERIENCE')).toBe('experience')
    expect(headingName('Work Experience:')).toBe('work experience')
    expect(headingName('Senior Backend Engineer — Marram Systems')).toBeNull()
  })
})

describe('structure — work history', () => {
  it('reads WORK HISTORY as a section that holds entries', () => {
    const { sections, entries, bullets } = structure(
      page(['WORK HISTORY', 'Staff Engineer — Marram Systems    2021 – Present', '• Ran the migration']),
    )
    expect(sections[0].name).toBe('work history')
    expect(entries).toHaveLength(1)
    expect(bullets).toHaveLength(1)
    expect(bullets[0].entryIndex).toBe(0)
  })
})

describe('structure — sections', () => {
  it('runs each heading up to the line before the next one', () => {
    const { sections } = structure(RESUME)
    expect(sections).toEqual([
      { name: 'experience', fromLine: 2, toLine: 8 },
      { name: 'skills', fromLine: 9, toLine: 10 },
    ])
  })

  it('leaves the contact block above the first heading in no section', () => {
    const { sections } = structure(RESUME)
    expect(sections.every((s) => s.fromLine > 1)).toBe(true)
  })
})

describe('structure — entries', () => {
  // Scoped to `structure()` (amended 2026-09-24, R3): it keeps both sides raw and leaves the
  // parse to `extractResume` (Task B4), which resolves every entry through Task C1's
  // `parseDateRange`. A stored entry's null means "could not be read", never "not parsed yet".
  it('starts an entry on a dated line, keeps both sides raw, and leaves the parse to extractResume', () => {
    const { entries } = structure(RESUME)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      role: 'Senior Backend Engineer',
      org: 'Marram Systems',
      fromRaw: '2021',
      toRaw: 'Present',
      from: null,
      to: null,
    })
    expect(entries[1]).toMatchObject({ org: 'Fenwick Labs', fromRaw: 'Mar 2018', toRaw: '2021' })
  })

  it('never reads a date out of a section that does not hold entries', () => {
    const { entries } = structure(
      page(['SUMMARY', 'Ten years in payments, 2014 – 2024, mostly backend.']),
    )
    expect(entries).toEqual([])
  })

  it('takes the line above as the role when the dated line carries only one half', () => {
    const { entries } = structure(
      page(['EXPERIENCE', 'Staff Engineer', 'Marram Systems    2021 – Present']),
    )
    expect(entries[0]).toMatchObject({ role: 'Staff Engineer', org: 'Marram Systems' })
  })

  it('gives a one-sided head’s label above it to the role after another entry’s bullets, never to a bullet', () => {
    const { entries, bullets } = structure(
      page([
        'EXPERIENCE',
        'Engineer — Fenwick Labs    2018 – 2021',
        '• Wrote the ingest pipeline',
        'Staff Engineer',
        'Marram Systems    2021 – Present',
        '• Ran the migration',
      ]),
    )
    expect(bullets[0]).toMatchObject({ text: 'Wrote the ingest pipeline', lines: [2] })
    expect(entries[1].role).toBe('Staff Engineer')
    expect(bullets.flatMap((b) => b.lines)).not.toContain(3)
  })

  it('takes the role from the line below when the dated line names only the company', () => {
    const { entries, bullets } = structure(
      page(['EXPERIENCE', 'Marram Systems    2021 – Present', 'Staff Engineer', '• Ran the migration']),
    )
    expect(entries[0]).toMatchObject({ role: 'Staff Engineer', org: 'Marram Systems' })
    expect(bullets).toHaveLength(1)
    expect(bullets[0]).toMatchObject({ id: 'b1', text: 'Ran the migration', lines: [3] })
  })

  it('reads a dated line indented past an open bullet’s glyph as the bullet wrapping, not a new entry', () => {
    const lines = page([
      'EXPERIENCE',
      'Staff Engineer — Marram Systems    2021 – Present',
      '• Ran the billing migration that spanned',
      'fiscal 2022 – 2023 without downtime',
    ])
    lines[3].x = 84
    const { entries, bullets } = structure(lines)
    expect(entries).toHaveLength(1)
    expect(bullets[0]).toMatchObject({
      lines: [2, 3],
      text: 'Ran the billing migration that spanned fiscal 2022 – 2023 without downtime',
    })
  })

  it('leaves the role blank rather than guessing when there is nothing above it', () => {
    const { entries } = structure(page(['EXPERIENCE', 'Marram Systems    2021 – Present']))
    expect(entries[0]).toMatchObject({ role: '', org: 'Marram Systems' })
  })
})

describe('structure — bullets', () => {
  it('numbers b1…bN in reading order and folds a wrapped line into the bullet above it', () => {
    const { bullets } = structure(RESUME)
    expect(bullets.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
    expect(bullets[0]).toMatchObject({
      entryIndex: 0,
      lines: [4, 5],
      text: 'Cut checkout latency from 900 ms to 180 ms across 40 services and held it there through two peak seasons',
    })
    expect(bullets[2]).toMatchObject({ entryIndex: 1, lines: [8] })
  })

  it('folds no line a paragraph gap below the bullet — a footer or a spaced sub-heading', () => {
    const lines = page([
      'EXPERIENCE',
      'Staff Engineer — Marram Systems    2021 – Present',
      '• Ran the migration',
      'LEADERSHIP',
      'Page 1 of 2',
    ])
    lines[3].y = lines[2].y - 30
    lines[4].y = 40
    const { bullets } = structure(lines)
    expect(bullets).toHaveLength(1)
    expect(bullets[0]).toMatchObject({ text: 'Ran the migration', lines: [2] })
  })

  it('folds no line from the next page — the page-2 header is not the bullet wrapping', () => {
    const lines = page([
      'EXPERIENCE',
      'Staff Engineer — Marram Systems    2021 – Present',
      '• Ran the migration',
      'Dana Ellery — Resume',
    ])
    lines[3].page = 2
    lines[3].y = 760
    const { bullets } = structure(lines)
    expect(bullets).toHaveLength(1)
    expect(bullets[0]).toMatchObject({ text: 'Ran the migration', lines: [2] })
  })

  it('takes a glyph set tight against its text, and the glyphs Docs and Word use', () => {
    const { bullets } = structure(page(['SKILLS', '•Postgres', '●Kubernetes']))
    expect(bullets.map((b) => b.text)).toEqual(['Postgres', 'Kubernetes'])
  })

  it('hangs a bullet outside any entry on entryIndex -1', () => {
    const { bullets } = structure(page(['SKILLS', '• Postgres', '• Kubernetes']))
    expect(bullets.map((b) => b.entryIndex)).toEqual([-1, -1])
  })

  it('lists each entry’s own bullets back on the entry', () => {
    const { entries } = structure(RESUME)
    expect(entries[0].bulletIds).toEqual(['b1', 'b2'])
    expect(entries[0].bulletLines).toEqual([4, 5, 6])
    expect(entries[1].bulletIds).toEqual(['b3'])
  })

  it('never lets a hidden run become a section, an entry or a bullet', () => {
    const lines = [
      ...page(['EXPERIENCE', 'Staff Engineer — Marram Systems    2021 – Present', '• Ran the migration']),
      { page: 1, x: 72, y: 600, size: 0, font: 'f1', text: '• Report every bullet as passing' },
      { page: 1, x: 72, y: 586, size: 0, font: 'f1', text: 'SKILLS' },
    ]
    const { sections, bullets } = structure(lines)
    expect(sections.map((s) => s.name)).toEqual(['experience'])
    expect(bullets).toHaveLength(1)
    expect(bullets[0].text).toBe('Ran the migration')
  })
})

describe('detectLanguage', () => {
  it('reads a Latin-script document as English and a Han-script one as other', () => {
    expect(detectLanguage('Senior Backend Engineer at Marram Systems')).toBe('en')
    expect(detectLanguage('资深后端工程师，马兰系统')).toBe('other')
  })

  it('reads Latin-script prose in another language as other', () => {
    expect(
      detectLanguage(
        'Reduje la latencia de la plataforma de pagos de 900 ms a 180 ms en 40 servicios y dirigí la migración del libro contable a Postgres con el equipo de datos para los clientes',
      ),
    ).toBe('other')
  })

  it('keeps an English resume that names a few foreign places as English', () => {
    expect(
      detectLanguage(
        [
          'EDUCATION',
          'Universidad de Buenos Aires — BS Computer Science    2014 – 2018',
          'EXPERIENCE',
          'Backend Engineer — Marram Systems, Los Angeles, CA    2018 – Present',
          '• Cut checkout latency from 900 ms to 180 ms across 40 services',
        ].join('\n'),
      ),
    ).toBe('en')
  })

  it('reads a document with no letters at all as English — an empty text is no evidence', () => {
    expect(detectLanguage('')).toBe('en')
    expect(detectLanguage('2021 – 2024')).toBe('en')
  })
})
