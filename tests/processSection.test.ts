import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Application, CommunityGuide, InterviewRound, ProcessMap } from '@/lib/types'

vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn().mockResolvedValue([]), ApiError: class ApiError extends Error {} }))

import { ProcessSection } from '@/components/process/ProcessSection'
import { StageLedger } from '@/components/process/StageLedger'

const map: ProcessMap = {
  stages: [
    { order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', duration: '30 min', whatItProbes: 'Fit and logistics.', tips: ['Have your salary range ready.'], sourceIds: ['s1'], confidence: 'community' },
    { order: 2, name: 'Take-home', kind: 'take-home', format: 'async', duration: '3 days', whatItProbes: 'Working code.', tips: [], sourceIds: ['s1', 's2'], confidence: 'community' },
    { order: 3, name: 'Coding round', kind: 'technical', format: 'video', whatItProbes: 'Algorithms.', tips: [], sourceIds: [], confidence: 'inferred' },
  ],
  takeHome: { present: 'yes', description: 'A small ledger service.', timeBudget: '3 days', tips: ['Ship a README.'], sourceIds: ['s1'] },
  timeline: 'About four weeks.',
  sources: [
    { id: 's1', title: 'Marram interview experience', url: 'https://www.reddit.com/r/x/1', host: 'reddit.com', kind: 'community', snippet: '', publishedAt: '2026-01-01', fetched: true },
    { id: 's2', title: 'Careers — how we interview', url: 'https://marram.dev/careers', host: 'marram.dev', kind: 'company', snippet: '', fetched: false },
  ],
  guides: [{ sourceId: 's1', takeaways: ['Recruiter screen first.', 'Take-home is three days.'], questionsReported: ['Design a ledger'], quotes: ['took three days'], stale: false, firstHand: true }],
  askRecruiter: ['Is there a take-home this cycle?'],
  caveats: ['Two sources, both from 2026.'],
  grounded: true,
  researchedAt: '2026-09-02T00:00:00.000Z',
}
const app = (over: Partial<Application> = {}): Application => ({
  id: 'app-1', company: 'Marram Systems', role: 'Senior Backend Engineer', jdRaw: '', adapter: 'ashby',
  parsed: { company: 'Marram Systems', role: 'Senior Backend Engineer', roleFacts: [], gates: [], themes: [], scope: 'per-application', advisory: '' },
  questions: [], status: 'applied', timeline: [], createdAt: '2026-08-27T00:00:00.000Z', ...over,
})
const round: InterviewRound = { id: 'r1', noticeRaw: '', roundType: 'recruiter-screen', datetime: '2026-09-05T17:00:00.000Z', people: [], chat: [], createdAt: '2026-09-01T00:00:00.000Z' }

describe('ProcessSection', () => {
  it('offers the research when there is no map, and says what it costs in time', () => {
    const markup = renderToStaticMarkup(createElement(ProcessSection, { app: app(), rounds: [], onResearched: () => {} }))
    expect(markup).toContain('What to expect')
    expect(markup).toContain('>Research the process<')
    expect(markup).toContain('Takes about a minute.')
  })
  it('shows the researched map with its date, the loop, the take-home, the guides, the questions and the caveats', () => {
    const markup = renderToStaticMarkup(createElement(ProcessSection, { app: app({ process: map }), rounds: [round], onResearched: () => {} }))
    expect(markup).toContain('Researched')
    expect(markup).toContain('>Research again<')
    expect(markup).toContain('Recruiter screen')
    expect(markup).toContain('Take-home assignment')
    expect(markup).toContain('A small ledger service.')
    expect(markup).toContain('What people who went through it say')
    expect(markup).toContain('Design a ledger')
    expect(markup).toContain('“took three days”')
    expect(markup).toContain('Is there a take-home this cycle?')
    expect(markup).toContain('border-amber')
    expect(markup).toContain('Two sources, both from 2026.')
    expect(markup).toContain('All 2 sources')
    // The page owns the list; this is the section handing it down to the ledger.
    expect(markup).toContain('Your Recruiter screen')
  })
  it('says what it knows about each write-up: undated, old, or second-hand', () => {
    const guide = map.guides[0]
    const undated = { ...map, sources: [{ ...map.sources[0], publishedAt: undefined }, map.sources[1]] }
    // Two different facts, and neither stands in for the other: nobody dated it, and it is not
    // the account of somebody who sat through the loop. "Out of date" is not among them — an
    // undated page cannot be out of date from anything, so the two never appear together.
    const undatedMarkup = renderToStaticMarkup(createElement(ProcessSection, {
      app: app({ process: { ...undated, guides: [{ ...guide, stale: false, firstHand: false }] } }),
      rounds: [], onResearched: () => {},
    }))
    expect(undatedMarkup).toContain('date not stated')
    expect(undatedMarkup).toContain('second-hand')
    expect(undatedMarkup).not.toContain('may be out of date')

    // The third fact needs a date to be measured from, so it is shown beside one.
    const oldMarkup = renderToStaticMarkup(createElement(ProcessSection, {
      app: app({ process: { ...map, guides: [{ ...guide, stale: true }] } }),
      rounds: [], onResearched: () => {},
    }))
    expect(oldMarkup).toContain('may be out of date')
    expect(oldMarkup).not.toContain('date not stated')
  })
  it('says nothing it cannot know about a guide saved before either field existed', () => {
    // No `firstHand` at all, and a `stale` computed when undated counted as old. Absent is not
    // "no", and "may be out of date" without a date contradicts the line beside it.
    const guide = map.guides[0]
    const { sourceId, takeaways, questionsReported, quotes } = guide
    const legacy = { sourceId, takeaways, questionsReported, quotes, stale: true } as CommunityGuide
    const undated = { ...map, sources: [{ ...map.sources[0], publishedAt: undefined }, map.sources[1]] }
    const markup = renderToStaticMarkup(createElement(ProcessSection, {
      app: app({ process: { ...undated, guides: [legacy] } }), rounds: [], onResearched: () => {},
    }))
    expect(markup).toContain('date not stated')
    expect(markup).not.toContain('may be out of date')
    expect(markup).not.toContain('second-hand')
  })
  it('leaves a dated first-hand write-up unqualified', () => {
    const markup = renderToStaticMarkup(createElement(ProcessSection, { app: app({ process: map }), rounds: [], onResearched: () => {} }))
    expect(markup).not.toContain('date not stated')
    expect(markup).not.toContain('may be out of date')
    expect(markup).not.toContain('second-hand')
  })
  it('keeps the map beside the wait rather than inside it, so a re-run neither blanks nor announces it', () => {
    // Two things turn on the same fact, that the map is `Working`'s sibling and not its
    // children: `Working` swaps its children out while busy, so a map inside it would blank
    // the ninety seconds of reading somebody was part-way through, and it wraps whatever it
    // holds in `role="status"`, so the finished run would announce all seven stages and every
    // quote under them. There is no DOM in this suite to click "Research again" with, so what
    // is pinned is the structure that decides both: the region closes empty, and the ledger
    // follows it as a sibling. Ordering alone would not discriminate — it held before too.
    const markup = renderToStaticMarkup(createElement(ProcessSection, { app: app({ process: map }), rounds: [], onResearched: () => {} }))
    expect(markup).toContain('role="status" class="mt-3 empty:mt-0"></div>')
    expect(markup).toContain('Recruiter screen')
    expect(markup.indexOf('role="status"')).toBeLessThan(markup.indexOf('Recruiter screen'))
  })
  it('shows a "no" on the take-home, and what says so, rather than hiding it', () => {
    // A wrong "yes" is inspectable; a hidden "no" is the one verdict nobody can check.
    const markup = renderToStaticMarkup(createElement(ProcessSection, {
      app: app({ process: { ...map, takeHome: { present: 'no', description: '', tips: [], sourceIds: ['s16'] },
        sources: [...map.sources, { id: 's16', title: 'How they hire', url: 'https://marram.dev/hiring', host: 'marram.dev', kind: 'company', snippet: '', fetched: true }] } }),
      rounds: [], onResearched: () => {},
    }))
    expect(markup).toContain('Take-home assignment')
    expect(markup).toContain('No take-home reported.')
    // Cited under the block, not merely present in the footer's list of everything.
    expect(markup.indexOf('>s16<')).toBeLessThan(markup.indexOf('All 3 sources'))
  })
  it('says plainly when the web could not be reached', () => {
    const markup = renderToStaticMarkup(createElement(ProcessSection, { app: app({ process: { ...map, grounded: false } }), rounds: [], onResearched: () => {} }))
    expect(markup).toContain('The web could not be reached')
  })
})

describe('StageLedger', () => {
  it('numbers the stages, chips their kind, counts sources, and marks the inferred one', () => {
    const markup = renderToStaticMarkup(createElement(StageLedger, { map, rounds: [], appId: 'app-1' }))
    expect(markup).toContain('>01<')
    expect(markup).toContain('>2 sources<')
    expect(markup).toContain('>1 source<')
    expect(markup).toContain('>inferred<')
    expect(markup).toContain('call · 30 min')
  })
  it('pins a logged round under its stage, linking to the round page', () => {
    const markup = renderToStaticMarkup(createElement(StageLedger, { map, rounds: [round], appId: 'app-1' }))
    expect(markup).toContain('Your Recruiter screen')
    expect(markup).toContain('href="/applications/app-1/interviews/r1"')
  })
  it('says when nobody knows about a take-home', () => {
    const markup = renderToStaticMarkup(createElement(ProcessSection, { app: app({ process: { ...map, takeHome: { present: 'unknown', description: '', tips: [], sourceIds: [] } } }), rounds: [], onResearched: () => {} }))
    expect(markup).toContain('Nobody says whether there is one — ask.')
  })
})
