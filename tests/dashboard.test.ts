import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import {
  ageLabel,
  COLUMNS,
  lastTouched,
  nextSteps,
  PipelineBoard,
  statusChange,
} from '@/components/board/PipelineBoard'
import {
  UpcomingStrip,
  upcomingRounds,
  type UpcomingRound,
} from '@/components/board/UpcomingStrip'
import { formatWhen } from '@/lib/rounds'
import type { Application, InterviewRound } from '@/lib/types'

const app = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Nectir',
  role: 'Founding Engineer',
  jdRaw: '',
  adapter: 'manual',
  questions: [],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }],
  createdAt: '2026-08-20T09:00:00.000Z',
  ...over,
})

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r-1',
  noticeRaw: '',
  roundType: 'recruiter-screen',
  datetime: '2026-09-05T17:00:00.000Z',
  people: [],
  chat: [],
  createdAt: '2026-08-28T09:00:00.000Z',
  ...over,
})

const NOW = Date.parse('2026-08-28T12:00:00.000Z')

describe('lastTouched', () => {
  it('reads the newest timeline entry, not the record’s birthday', () => {
    const a = app({
      timeline: [
        { event: 'created', at: '2026-08-20T09:00:00.000Z' },
        { event: 'applied', at: '2026-08-25T09:00:00.000Z' },
      ],
    })
    expect(lastTouched(a)).toBe('2026-08-25T09:00:00.000Z')
  })

  it('falls back to createdAt for an empty or unreadable timeline', () => {
    expect(lastTouched(app({ timeline: [] }))).toBe('2026-08-20T09:00:00.000Z')
    expect(lastTouched(app({ timeline: [{ event: 'created', at: 'whenever' }] }))).toBe(
      '2026-08-20T09:00:00.000Z',
    )
  })
})

describe('ageLabel', () => {
  it('counts whole days since the last thing that happened', () => {
    expect(ageLabel('2026-08-28T09:00:00.000Z', NOW)).toBe('today')
    expect(ageLabel('2026-08-27T09:00:00.000Z', NOW)).toBe('yesterday')
    expect(ageLabel('2026-08-16T09:00:00.000Z', NOW)).toBe('12 days')
  })

  it('says nothing rather than something wrong when the date is unreadable', () => {
    expect(ageLabel('whenever', NOW)).toBe('')
  })

  it('treats a timestamp ahead of our clock as today', () => {
    expect(ageLabel('2026-08-29T09:00:00.000Z', NOW)).toBe('today')
  })
})

describe('statusChange', () => {
  it('appends one event and keeps the history that was already there', () => {
    const a = app({ timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }] })
    const patch = statusChange(a, 'interviewing', '2026-08-28T12:00:00.000Z')

    expect(patch).toEqual({
      status: 'interviewing',
      timeline: [
        { event: 'created', at: '2026-08-20T09:00:00.000Z' },
        { event: 'status → interviewing', at: '2026-08-28T12:00:00.000Z' },
      ],
    })
    // The record the board is holding is not mutated on the way.
    expect(a.timeline).toHaveLength(1)
  })
})

describe('upcomingRounds', () => {
  const item = (over: Partial<InterviewRound>): UpcomingRound => ({ app: app(), round: round(over) })

  it('keeps only what is still ahead, soonest first', () => {
    const sorted = upcomingRounds(
      [
        item({ id: 'later', datetime: '2026-09-10T17:00:00.000Z' }),
        item({ id: 'past', datetime: '2026-08-01T17:00:00.000Z' }),
        item({ id: 'soon', datetime: '2026-08-29T17:00:00.000Z' }),
      ],
      NOW,
    )
    expect(sorted.map((u) => u.round.id)).toEqual(['soon', 'later'])
  })

  it('drops a round whose notice never yielded a time', () => {
    expect(upcomingRounds([item({ datetime: undefined }), item({ datetime: 'next Tuesday' })], NOW))
      .toEqual([])
  })
})

describe('formatWhen', () => {
  it('is empty for a time it cannot read, rather than "Invalid Date"', () => {
    expect(formatWhen(undefined)).toBe('')
    expect(formatWhen('next Tuesday')).toBe('')
  })

  it('renders a readable date for a real one', () => {
    expect(formatWhen('2026-09-05T17:00:00.000Z')).toMatch(/Sep|Sept/)
  })
})

/**
 * The card names the one step it offers by where that step lands — the same word as the column
 * heading it moves the card under. Everything else a status could become stays reachable through
 * the select below it, so this is about which one question the card asks, not which moves are
 * possible.
 */
describe('nextSteps', () => {
  it('offers the one thing that happens next, named by the column it lands in', () => {
    expect(nextSteps('draft')).toEqual([{ label: 'Applied', to: 'applied', tone: 'advance' }])
    expect(nextSteps('applied')).toEqual([
      { label: 'Interviewing', to: 'interviewing', tone: 'advance' },
    ])
  })

  it('gives an interviewing record both ways it can end, weighted differently', () => {
    expect(nextSteps('interviewing')).toEqual([
      { label: 'Offer', to: 'offer', tone: 'advance' },
      { label: 'Rejected', to: 'rejected', tone: 'aside' },
    ])
  })

  it('labels every step with the heading of the column it moves to', () => {
    // The button and the column say the same word, so a click needs no translating.
    const columnLabel = new Map(COLUMNS.map((c) => [c.status, c.label]))
    for (const { status } of COLUMNS) {
      for (const step of nextSteps(status)) expect(step.label).toBe(columnLabel.get(step.to))
    }
  })

  it('offers nothing at the end of the line', () => {
    // An offer and a rejection are outcomes, not stages. Correcting one is the select's job.
    expect(nextSteps('offer')).toEqual([])
    expect(nextSteps('rejected')).toEqual([])
  })

  it('never points a record at the status it is already in', () => {
    for (const { status } of COLUMNS) {
      expect(nextSteps(status).map((s) => s.to)).not.toContain(status)
    }
  })
})

describe('PipelineBoard render', () => {
  const html = () =>
    renderToStaticMarkup(
      createElement(PipelineBoard, {
        apps: [
          app({ id: 'a1', company: 'Nectir', status: 'draft' }),
          app({ id: 'a2', company: 'TRM Labs', role: 'Backend Engineer', status: 'offer' }),
        ],
        onMove: async () => {},
        onRemove: async () => {},
      }),
    )

  it('shows every column, including the empty ones, with its count', () => {
    const markup = html()
    for (const { label } of COLUMNS) expect(markup).toContain(`>${label}</h2>`)
    expect(markup).toContain('Interviewing')
  })

  it('puts each record in its own column, linked to its page', () => {
    expect(html()).toContain('href="/applications/a1"')
    expect(html()).toContain('TRM Labs')
    expect(html()).toContain('Backend Engineer')
  })

  it('offers the correction control as an action, labelled per record', () => {
    const markup = html()
    expect(markup).toContain('aria-label="Move Nectir to another column"')
    // A placeholder rather than the current column: the column the card sits in already says
    // where the record is, so the select is only ever somewhere else to put it.
    expect(markup).toContain('>Move to…</option>')
  })

  it('leaves the record’s own column off its correction list', () => {
    const markup = renderToStaticMarkup(
      createElement(PipelineBoard, {
        apps: [app({ id: 'a1', company: 'Nectir', status: 'draft' })],
        onMove: async () => {},
        onRemove: async () => {},
      }),
    )
    expect(markup).toContain('value="applied"')
    expect(markup).not.toContain('value="draft"')
  })

  it('asks the next step of a card that has one, and nothing of a card that doesn’t', () => {
    // Matched as a button, not as loose text: every label is now also a column heading, so
    // `toContain('Applied')` would pass on the column that is merely sitting there empty.
    const markup = html()
    expect(markup).toContain('>Applied</button>') // the draft
    expect(markup).not.toContain('>Interviewing</button>') // nothing here is applied
    expect(markup).not.toContain('>Offer</button>') // and the offer is already an offer
  })

  it('shows both endings on an interviewing record', () => {
    const markup = renderToStaticMarkup(
      createElement(PipelineBoard, {
        apps: [app({ id: 'a1', status: 'interviewing' })],
        onMove: async () => {},
        onRemove: async () => {},
      }),
    )
    expect(markup).toContain('>Offer</button>')
    expect(markup).toContain('>Rejected</button>')
  })

  it('names the record on its Remove button, since every card carries the same word', () => {
    expect(html()).toContain('aria-label="Remove Nectir · Founding Engineer"')
    expect(html()).toContain('aria-label="Remove TRM Labs · Backend Engineer"')
  })
})

describe('UpcomingStrip render', () => {
  it('renders nothing at all when no round is booked', () => {
    expect(renderToStaticMarkup(createElement(UpcomingStrip, { items: [] }))).toBe('')
  })

  it('names the company, the round and a way to keep it', () => {
    const markup = renderToStaticMarkup(
      createElement(UpcomingStrip, {
        items: [{ app: app(), round: round({ people: ['Kavitha Rao'] }) }],
      }),
    )
    expect(markup).toContain('Nectir')
    expect(markup).toContain('Recruiter screen')
    expect(markup).toContain('Kavitha Rao')
    expect(markup).toContain('Add to calendar')
  })

  it('names each row\'s button for itself, since they all read "Add to calendar"', () => {
    const markup = renderToStaticMarkup(
      createElement(UpcomingStrip, {
        items: [
          { app: app({ id: 'a1' }), round: round({ id: 'r1' }) },
          {
            app: app({ id: 'a2', company: 'TRM Labs' }),
            round: round({ id: 'r2', roundType: 'panel' }),
          },
        ],
      }),
    )
    // The visible words open the name, contiguously, so speaking what is written on the
    // button still matches it (WCAG 2.5.3 Label in Name).
    expect(markup).toContain('aria-label="Add to calendar: Nectir Recruiter screen"')
    expect(markup).toContain('aria-label="Add to calendar: TRM Labs Panel"')
  })
})
