import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { dateOnly } from '@/lib/dates'
import type { BriefInUse } from '@/lib/assignment'
import type { InterviewRound, ResearchSource, TakeHomeGuide } from '@/lib/types'

// A static render reaches everything this section decides before anybody clicks: which of the
// three states it is in, what it is allowed to offer there, and what it says. The two mocks are
// the pair every component test here carries — `apiFetch` reaches for the browser's fetch and the
// signed-in user, and importing the Firebase client starts an app.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { TakeHomeSection } from '@/components/interviews/TakeHomeSection'

type Props = Parameters<typeof TakeHomeSection>[0]

const sources: ResearchSource[] = [
  {
    id: 's1',
    title: 'My Marram take-home',
    url: 'https://www.reddit.com/r/cscareerquestions/comments/abc/',
    host: 'reddit.com',
    kind: 'community',
    snippet: '',
    publishedAt: '2026-02-01T00:00:00.000Z',
    fetched: true,
  },
  {
    id: 's2',
    title: 'How we review take-homes',
    url: 'https://marram.dev/engineering/take-home',
    host: 'marram.dev',
    kind: 'company',
    snippet: '',
    fetched: true,
  },
]

// A whole guide, of the shape the guard lets through: every brief item carries a span of the
// brief, every reported item carries source ids that were handed over, and the plan cites
// nothing.
const guide = (over: Partial<TakeHomeGuide> = {}): TakeHomeGuide => ({
  brief: {
    task: 'Build a small ledger service that records transfers and reports a balance.',
    timeLimit: {
      text: 'Spend no more than four hours.',
      quote: 'Please spend no more than four hours on this.',
    },
    deliverables: [
      { text: 'A repository with a README.', quote: 'Send us a link to a repository with a README.' },
    ],
    constraints: [
      { text: 'Spend no more than four hours.', quote: 'Please spend no more than four hours on this.' },
    ],
    evaluation: [
      { text: 'Tests and clarity are read first.', quote: 'We read your tests and the clarity of your code first.' },
    ],
  },
  reported: {
    tasks: [{ text: 'Others were given the same ledger service.', sourceIds: ['s1'] }],
    evaluation: [{ text: 'Reviewers look for tests over features.', sourceIds: ['s1', 's2'] }],
    pitfalls: [{ text: 'People say a missing README cost them.', sourceIds: ['s2'] }],
    time: [{ text: 'People spent five to six hours.', sourceIds: ['s1'] }],
  },
  plan: [
    { step: 'Read the brief and list the deliverables.', budget: '15 min' },
    { step: 'Write the ledger and its tests.' },
  ],
  askRecruiter: ['Is four hours a limit or a guide?'],
  caveats: ['Two write-ups, one of them from the company itself.'],
  sources,
  guides: [
    { sourceId: 's1', takeaways: ['Tests matter more than features.'], quotes: ['we read your tests'], stale: false, firstHand: true },
  ],
  grounded: true,
  plannedFrom: '2026-09-05T09:00:00.000Z',
  plannedAt: '2026-09-05T10:30:00.000Z',
  ...over,
})

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r1',
  noticeRaw: '',
  roundType: 'take-home',
  people: [],
  chat: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

// The brief in use, as the page hands it down. Long enough to plan from unless a test says
// otherwise, and its identity is the one the fixture guide was planned from.
const brief = (over: Partial<BriefInUse> = {}): BriefInUse => ({
  text: 'x'.repeat(1_200),
  identity: '2026-09-05T09:00:00.000Z',
  cut: false,
  source: 'pasted',
  ...over,
})

const base: Props = {
  appId: 'app-1',
  round: round(),
  company: 'Marram Systems',
  brief: brief(),
  lock: null,
  setLock: () => {},
  onRound: () => {},
}
const html = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(TakeHomeSection, { ...base, ...over }))

describe('TakeHomeSection — not planned', () => {
  it('says what the plan is drawn from, and offers it', () => {
    const out = html()
    expect(out).toContain('The plan')
    expect(out).toContain(
      'Reads the brief, searches for what people report about Marram Systems’s take-home, and lays out a plan inside its limits.',
    )
    expect(out).toContain('Plan the take-home')
    expect(out).toContain('Takes under half a minute.')
    expect(out).not.toContain('disabled=""')
  })

  it('will not plan from a notice too short to plan from, and says which way out there is', () => {
    // The only way the brief in use can be under the floor: the notice is the brief and nobody
    // has added one. The assignment route refuses a short brief before it stores it.
    const out = html({
      brief: brief({ text: 'A short note saying a take-home is coming.', identity: 'notice', source: 'notice' }),
    })
    expect(out).toContain('disabled=""')
    expect(out).toContain('The notice is too short to plan from — add the brief.')
  })

  it('waits for a brief that is still being read', () => {
    const out = html({ lock: 'reading' })
    expect(out).toContain('disabled=""')
    expect(out).toContain('Wait for the brief to be read.')
    // The two disabled reasons are different facts and say different things; only one is true.
    expect(out).not.toContain('The notice is too short to plan from')
  })

  it('says the brief is being read, not that the notice under it is too short', () => {
    // The ordinary way a brief gets added: a notice too short to plan from, and a real brief on
    // its way in. Telling the reader to add the brief they are adding is the one wrong answer.
    const out = html({
      lock: 'reading',
      brief: brief({ text: 'A short note saying a take-home is coming.', identity: 'notice', source: 'notice' }),
    })
    expect(out).toContain('Wait for the brief to be read.')
    expect(out).not.toContain('The notice is too short to plan from')
  })
})

describe('TakeHomeSection — planning', () => {
  it('gives the button over to the wait, and says how long a minute is', () => {
    const out = html({ lock: 'planning' })
    expect(out).not.toContain('Plan the take-home')
    expect(out).toContain('role="status"')
    expect(out).toContain('Starting the searches…')
    expect(out).toContain('Usually takes under half a minute.')
  })
})

describe('TakeHomeSection — planned', () => {
  const planned = (over: Partial<TakeHomeGuide> = {}) => ({ round: round({ takeHome: guide(over) }) })

  it('dates the plan, counts what it was drawn from, and offers another', () => {
    const out = html(planned())
    // The reader's own locale formats the date, so the assertion asks the same formatter for it
    // rather than pinning one machine's answer. What it pins is the line's shape and its count.
    expect(out).toContain(`Planned ${dateOnly('2026-09-05T10:30:00.000Z')} from 2 sources`)
    expect(out).toContain('Plan again')
    // Focus lands here when a plan arrives, so the line has to be reachable.
    expect(out).toContain('tabindex="-1"')
    expect(out).not.toContain('Plan the take-home')
  })

  it('says when the web could not be reached', () => {
    const out = html(planned({ grounded: false }))
    expect(out).toContain('The web could not be reached — this is drawn from the brief alone.')
  })

  it('says when the plan was drawn from a brief that is no longer the one in use', () => {
    const out = html({ ...planned(), brief: brief({ identity: '2026-09-06T08:00:00.000Z' }) })
    expect(out).toContain('Planned from an earlier brief — plan again.')
  })

  it('says nothing of the sort when it was drawn from the brief in use', () => {
    expect(html(planned())).not.toContain('Planned from an earlier brief')
  })

  it('shows what the brief asks for, each item with the words of the brief that say it', () => {
    const out = html(planned())
    expect(out).toContain('What the brief asks for')
    expect(out).toContain('Build a small ledger service that records transfers and reports a balance.')
    expect(out).toContain('Deliverables')
    expect(out).toContain('Constraints')
    expect(out).toContain('How it will be judged')
    expect(out).toContain('The brief:')
    expect(out).toContain('Send us a link to a repository with a README.')
    // Quoted, and it looks quoted — the same rule and reading face the rehearsal lines use.
    expect(out).toContain('border-l-2 border-line-strong pl-4 font-display')
  })

  it('does not head a list the guard left with nothing in it', () => {
    const g = guide()
    const out = html({ round: round({ takeHome: { ...g, brief: { ...g.brief, evaluation: [] } } }) })
    expect(out).toContain('Deliverables')
    expect(out).not.toContain('How it will be judged')
  })

  it('shows what people report, each item counting the sources behind it', () => {
    const out = html(planned())
    expect(out).toContain('What people report about Marram Systems’s take-home')
    expect(out).toContain('What others were given')
    expect(out).toContain('What reviewers look for')
    expect(out).toContain('Why people say they were rejected')
    expect(out).toContain('How long it takes')
    expect(out).toContain('>1 source<')
    expect(out).toContain('>2 sources<')
    expect(out).toContain('My Marram take-home')
    expect(out).toContain('rel="noreferrer"')
  })

  it('counts a source once, however many times an item cites it', () => {
    const g = guide()
    const out = html({
      round: round({
        takeHome: {
          ...g,
          reported: {
            tasks: [{ text: 'Others were given the same ledger service.', sourceIds: ['s1', 's1'] }],
            evaluation: [], pitfalls: [], time: [],
          },
        },
      }),
    })
    expect(out).toContain('>1 source<')
    expect(out).not.toContain('>2 sources<')
  })

  it('says a plan with nothing behind it was drawn without sources, and offers no empty list', () => {
    // Both real states of a plan the search came back empty from: the line counts to nothing in
    // words, and the disclosure that would open on an empty list is not there to open.
    const out = html(
      planned({ sources: [], guides: [], reported: { tasks: [], evaluation: [], pitfalls: [], time: [] } }),
    )
    expect(out).toContain(`Planned ${dateOnly('2026-09-05T10:30:00.000Z')} without sources`)
    expect(out).not.toContain('from 0 sources')
    expect(out).not.toContain('All 0 sources')
  })

  it('says plainly when the search found nobody writing about it', () => {
    const out = html(planned({ reported: { tasks: [], evaluation: [], pitfalls: [], time: [] } }))
    expect(out).toContain(
      'Nobody has written about Marram Systems’s take-home that the search could find.',
    )
    expect(out).not.toContain('What others were given')
  })

  it('holds the plan inside the limit the brief states, and says the plan is ours', () => {
    const out = html(planned())
    expect(out).toContain('A plan')
    expect(out).toContain('Within: Spend no more than four hours.')
    expect(out).toContain('Read the brief and list the deliverables.')
    expect(out).toContain('15 min')
    expect(out).toContain('Suggested — not from any source.')
  })

  it('states no limit the brief did not state', () => {
    const g = guide()
    const out = html({ round: round({ takeHome: { ...g, brief: { ...g.brief, timeLimit: undefined } } }) })
    expect(out).not.toContain('Within:')
    expect(out).toContain('Suggested — not from any source.')
  })

  it('puts the open questions in amber, and nothing there when there are none', () => {
    const out = html(planned())
    expect(out).toContain('Ask the recruiter')
    expect(out).toContain('border-amber')
    expect(out).toContain('Is four hours a limit or a guide?')
    const none = html(planned({ askRecruiter: [] }))
    expect(none).not.toContain('Ask the recruiter')
    // Amber means only a person can settle it. Nothing else in this section may wear it.
    expect(none).not.toContain('border-amber')
  })

  it('keeps the caveats and every source it read within reach', () => {
    const out = html(planned())
    expect(out).toContain('Two write-ups, one of them from the company itself.')
    expect(out).toContain('All 2 sources')
    expect(out).toContain('https://marram.dev/engineering/take-home')
  })
})
