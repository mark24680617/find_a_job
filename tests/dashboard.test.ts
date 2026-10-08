import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
// These hooks read the app router off a context a static render does not have, so the mock
// stands in for the whole module the board's tree reaches: the board's own `useRouter`, whose
// one use is the navigation after a move to Interviewing that no render here makes — where that
// move goes is decided by `afterBoardMove`, and read in `tests/stage.test.ts` — and the shell's
// `usePathname`, which is on the import chain whether or not a test draws the shell.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
}))

import { Dashboard } from '@/components/board/DashboardScreen'
import {
  ageLabel,
  byLastTouched,
  columnView,
  COLUMNS,
  lastTouched,
  matchesQuery,
  nextSteps,
  PipelineBoard,
  searchStatus,
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

/** A record created on day `d` of August and untouched since, so that day is its last activity. */
const touched = (id: string, d: number, over: Partial<Application> = {}): Application => {
  const at = `2026-08-${String(d).padStart(2, '0')}T09:00:00.000Z`
  return app({ id, company: `Company ${id}`, createdAt: at, timeline: [{ event: 'created', at }], ...over })
}

/**
 * The search is typed a letter at a time and read as words: a record matches when every word
 * appears somewhere in its company or its role, in any order — so "nectir eng" finds the
 * engineering role at Nectir and nothing else there.
 */
describe('matchesQuery', () => {
  const nectir = app({ company: 'Nectir', role: 'Founding Engineer' })

  it('ignores case', () => {
    expect(matchesQuery(nectir, 'NECTIR')).toBe(true)
  })

  it('needs every word, each found in the company or the role, in any order', () => {
    expect(matchesQuery(nectir, 'engineer nectir')).toBe(true)
    expect(matchesQuery(nectir, 'nectir backend')).toBe(false)
  })

  it('matches part of a word, since the query is still being typed', () => {
    expect(matchesQuery(nectir, 'nec gineer')).toBe(true)
  })

  it('reads any run of whitespace as one break, and ignores it at the ends', () => {
    expect(matchesQuery(nectir, '  nectir \t founding  ')).toBe(true)
  })

  it('never reads one word across the company into the role', () => {
    // The two are joined with a space, so no word can start in one and finish in the other.
    expect(matchesQuery(nectir, 'nectirfounding')).toBe(false)
  })

  it('keeps every record for a query with no words in it', () => {
    expect(matchesQuery(nectir, '')).toBe(true)
    expect(matchesQuery(nectir, '   ')).toBe(true)
  })
})

describe('byLastTouched', () => {
  const ids = (list: Application[]) => list.map((a) => a.id)

  it('puts the most recent activity first — the last thing that happened, not the creation', () => {
    // Created first but moved most recently: it is the one with news.
    const busy = app({
      id: 'busy',
      createdAt: '2026-08-01T09:00:00.000Z',
      timeline: [
        { event: 'created', at: '2026-08-01T09:00:00.000Z' },
        { event: 'status → applied', at: '2026-08-27T09:00:00.000Z' },
      ],
    })
    expect(ids([touched('quiet', 20), busy, touched('middle', 24)].sort(byLastTouched))).toEqual([
      'busy',
      'middle',
      'quiet',
    ])
  })

  it('sends a record whose date cannot be read to the end', () => {
    const unreadable = app({ id: 'unreadable', createdAt: 'whenever', timeline: [] })
    expect(
      ids([unreadable, touched('older', 20), touched('newer', 24)].sort(byLastTouched)),
    ).toEqual(['newer', 'older', 'unreadable'])
  })

  it('leaves records that tie in the order they arrived', () => {
    // The list arrives newest-created first, and a tie is no reason to shuffle it.
    expect(ids([touched('x', 20), touched('y', 20)].sort(byLastTouched))).toEqual(['x', 'y'])
    expect(ids([touched('y', 20), touched('x', 20)].sort(byLastTouched))).toEqual(['y', 'x'])
    const lost = (id: string) => app({ id, createdAt: 'whenever', timeline: [] })
    expect(ids([lost('u2'), lost('u1'), touched('x', 20)].sort(byLastTouched))).toEqual([
      'x',
      'u2',
      'u1',
    ])
  })
})

/**
 * What one column draws: newest first, six at most with a button for the rest; Rejected folded
 * to its count until it is opened; and while a query is set, simply every match.
 */
describe('columnView', () => {
  // d1 was touched most recently and each after it a day earlier. They are handed over out of
  // order, so the order that comes back is the view's own. Two are data roles, for the queries.
  const eight = [
    touched('d3', 26),
    touched('d8', 21),
    touched('d1', 28),
    touched('d6', 23, { role: 'Data Engineer' }),
    touched('d2', 27, { role: 'Data Engineer' }),
    touched('d7', 22),
    touched('d4', 25),
    touched('d5', 24),
  ]
  const rest = { query: '', cap: 6, expanded: false, collapsed: false }
  const ids = (view: { shown: Application[] }) => view.shown.map((a) => a.id)

  it('shows the six most recent of a long column, and offers all of them by number', () => {
    const view = columnView(eight, rest)
    expect(ids(view)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])
    expect(view.hidden).toBe(2)
    expect(view.toggle).toBe('Show all 8')
  })

  it('shows every card once opened, and offers to show fewer', () => {
    const view = columnView(eight, { ...rest, expanded: true })
    expect(ids(view)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'])
    expect(view.hidden).toBe(0)
    expect(view.toggle).toBe('Show fewer')
  })

  it('offers nothing to a column that fits, and the button to one that is a card over', () => {
    const six = eight.filter((a) => a.id !== 'd7' && a.id !== 'd8')
    expect(ids(columnView(six, rest))).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6'])
    expect(columnView(six, rest)).toMatchObject({ hidden: 0, toggle: null })
    const seven = eight.filter((a) => a.id !== 'd8')
    expect(columnView(seven, rest)).toMatchObject({ hidden: 1, toggle: 'Show all 7' })
  })

  it('folds a collapsed column to its button, which says how many it holds', () => {
    expect(columnView(eight.slice(0, 3), { ...rest, collapsed: true })).toEqual({
      shown: [],
      hidden: 3,
      toggle: 'Show 3',
    })
  })

  it('opens a collapsed column whole, however long, and offers to hide it again', () => {
    const view = columnView(eight, { ...rest, collapsed: true, expanded: true })
    expect(ids(view)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'])
    expect(view.hidden).toBe(0)
    expect(view.toggle).toBe('Hide')
  })

  it('has nothing to offer for an empty column, folded or open', () => {
    for (const over of [{}, { expanded: true }, { collapsed: true }, { collapsed: true, expanded: true }]) {
      expect(columnView([], { ...rest, ...over })).toEqual({ shown: [], hidden: 0, toggle: null })
    }
  })

  it('shows every match while a query is set — past the cap, through the fold, nothing to press', () => {
    // Every company here is "Company …", so all eight match.
    for (const over of [{}, { expanded: true }, { collapsed: true }]) {
      const view = columnView(eight, { ...rest, ...over, query: 'company' })
      expect(ids(view)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'])
      expect(view).toMatchObject({ hidden: 0, toggle: null })
    }
  })

  it('narrows to the matches, still newest first, folded column or not', () => {
    expect(ids(columnView(eight, { ...rest, query: 'data' }))).toEqual(['d2', 'd6'])
    expect(ids(columnView(eight, { ...rest, collapsed: true, query: 'DATA' }))).toEqual([
      'd2',
      'd6',
    ])
  })

  it('treats a query of nothing but spaces as no query', () => {
    expect(columnView(eight, { ...rest, query: '   ' })).toMatchObject({
      hidden: 2,
      toggle: 'Show all 8',
    })
  })

  it('leaves the list it was handed in the order it came', () => {
    columnView(eight, rest)
    expect(eight.map((a) => a.id)).toEqual(['d3', 'd8', 'd1', 'd6', 'd2', 'd7', 'd4', 'd5'])
  })
})

/**
 * The one sentence the board says about a search. The count is for a screen reader, since the
 * columns already show it; the no-match line is also the one thing on screen in their place.
 */
describe('searchStatus', () => {
  it('says nothing without a query', () => {
    expect(searchStatus('', 5)).toBe('')
    expect(searchStatus('   ', 5)).toBe('')
  })

  it('counts the matches, singular for one, and names what was searched for', () => {
    expect(searchStatus('eng', 3)).toBe('3 applications match “eng”.')
    expect(searchStatus('nectir', 1)).toBe('1 application matches “nectir”.')
  })

  it('says something new for each search, even one that finds as many as the last', () => {
    // A live region speaks only when its words change, so the same count twice would be silence.
    expect(searchStatus('data', 3)).not.toBe(searchStatus('backend', 3))
  })

  it('names the query without the spaces around it', () => {
    expect(searchStatus('  zqx ', 0)).toBe('No application matches “zqx”.')
    expect(searchStatus(' eng  ', 3)).toBe('3 applications match “eng”.')
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

/**
 * The first paint of a long pipeline, which is the state a person arrives in: a static render
 * runs no effects and presses no buttons. What a press changes is `columnView`'s, above.
 */
describe('PipelineBoard render, a long pipeline', () => {
  const markup = renderToStaticMarkup(
    createElement(PipelineBoard, {
      apps: [
        ...Array.from({ length: 8 }, (_, i) => touched(`d${i + 1}`, 28 - i)),
        touched('o1', 20, { status: 'offer' }),
        touched('r1', 20, { status: 'rejected' }),
        touched('r2', 19, { status: 'rejected' }),
      ],
      onMove: async () => {},
      onRemove: async () => {},
    }),
  )
  /** The opening tag of the element carrying this attribute, whatever order the rest are in. */
  const tag = (name: string, attr: string) =>
    markup.match(new RegExp(`<${name}[^>]*${attr}[^>]*>`))?.[0] ?? ''
  const button = (text: string) =>
    markup.match(new RegExp(`<button[^>]*>${text}</button>`))?.[0] ?? ''

  it('shows a long column’s six most recent cards, newest first, and offers the rest by number', () => {
    expect(markup.match(/href="\/applications\/d\d"/g)).toEqual([
      'href="/applications/d1"',
      'href="/applications/d2"',
      'href="/applications/d3"',
      'href="/applications/d4"',
      'href="/applications/d5"',
      'href="/applications/d6"',
    ])
    expect(button('Show all 8')).toContain('aria-expanded="false"')
    expect(button('Show all 8')).toContain('aria-controls="col-draft-list"')
    expect(tag('ul', 'id="col-draft-list"')).not.toBe('')
  })

  it('names each column’s button for its column, since two can read the same', () => {
    // The visible words open the name, so speaking what is written still matches (WCAG 2.5.3).
    expect(button('Show all 8')).toContain('aria-label="Show all 8: Draft"')
    expect(button('Show 2')).toContain('aria-label="Show 2: Rejected"')
  })

  it('counts the whole column in its heading, not the six on show', () => {
    expect(markup).toMatch(/>Draft<\/h2><span[^>]*>8<\/span>/)
  })

  it('starts Rejected folded: the heading and count stay, the cards wait behind a button', () => {
    expect(markup).not.toContain('href="/applications/r1"')
    expect(markup).not.toContain('href="/applications/r2"')
    expect(markup).toMatch(/>Rejected<\/h2><span[^>]*>2<\/span>/)
    expect(button('Show 2')).toContain('aria-expanded="false"')
    expect(button('Show 2')).toContain('aria-controls="col-rejected-list"')
    // Hidden rather than absent, so the button has a list to point at.
    expect(tag('ul', 'id="col-rejected-list"')).toContain(' hidden=""')
  })

  it('leaves Offer open', () => {
    expect(markup).toContain('href="/applications/o1"')
    expect(tag('ul', 'id="col-offer-list"')).not.toContain(' hidden=')
  })

  it('labels the search field, and its placeholder says the same words', () => {
    expect(markup).toMatch(/<label[^>]*for="board-search"[^>]*>Find an application<\/label>/)
    expect(tag('input', 'id="board-search"')).toContain('type="search"')
    expect(tag('input', 'id="board-search"')).toContain('placeholder="Find an application"')
  })

  it('has its status region on the page before there is anything to say', () => {
    // A region that arrives already carrying its message goes unannounced by several screen
    // readers (`src/components/Working.tsx`), so it is drawn from the first paint, empty.
    expect(tag('p', 'role="status"')).not.toBe('')
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

  // The same word as the card and the round page, for the same reason: three surfaces reading
  // three different ways about one date is how a deadline gets mistaken for a meeting. A
  // take-home whose notice stated no deadline never reaches this list at all — `upcomingRounds`
  // above drops every round with no readable time — so there is no "Deadline not stated" here.
  it('calls a take-home row’s time the deadline it is', () => {
    const markup = renderToStaticMarkup(
      createElement(UpcomingStrip, {
        items: [{ app: app(), round: round({ roundType: 'take-home' }) }],
      }),
    )
    expect(markup).toContain(`Due ${formatWhen('2026-09-05T17:00:00.000Z')}`)
    expect(markup).toContain('aria-label="Add to calendar: Nectir Take-home"')
  })

  it('leaves every other row’s time alone', () => {
    const markup = renderToStaticMarkup(
      createElement(UpcomingStrip, { items: [{ app: app(), round: round() }] }),
    )
    expect(markup).not.toContain('Due ')
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

/**
 * The way to add an application is the board's one primary action, and it is on screen before
 * anything has loaded — a static render runs no effects, so what this checks is the loading
 * state, which is exactly the state a person arrives in.
 */
describe('Dashboard render', () => {
  it('offers New application from the header, next to the heading', () => {
    const markup = renderToStaticMarkup(createElement(Dashboard))
    expect(markup).toContain('Applications')
    expect(markup).toContain('href="/applications/new"')
    expect(markup).toContain('class="btn btn-primary"')
    expect(markup).toContain('New application')
  })
})
