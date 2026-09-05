import { describe, it, expect } from 'vitest'
import {
  CLOSING_LINE,
  MAX_ANSWER_CHARS,
  MAX_QUESTIONS,
  citeReported,
  placeRound,
  practiceMode,
  reportedQuestions,
  type ReportedQuestion,
} from '@/lib/practice'
import type {
  CommunityGuide,
  InterviewRound,
  ProcessMap,
  ProcessStage,
  ResearchSource,
  RoundType,
  StageKind,
} from '@/lib/types'

// The four decisions the practice half of a round makes without the model. Each of them is a
// place where a plausible-sounding answer would be wrong in a way nobody could see on screen:
// a code box for an account director, a stage borrowed from another round, a question nobody
// was asked, a citation onto a source that never said it.

const stage = (order: number, kind: StageKind, name: string = kind): ProcessStage => ({
  order, name, kind, format: 'video', whatItProbes: '', tips: [], sourceIds: ['s1'], confidence: 'community',
})
const source = (id: string, over: Partial<ResearchSource> = {}): ResearchSource => ({
  id, title: `Guide ${id}`, url: `https://example.com/${id}`, host: 'example.com',
  kind: 'community', snippet: '', publishedAt: '2024-03-01T00:00:00.000Z', fetched: true, ...over,
})
const guide = (
  sourceId: string,
  questionsReported: string[],
  over: Partial<CommunityGuide> = {},
): CommunityGuide => ({
  sourceId, takeaways: [], questionsReported, quotes: [], stale: false, firstHand: false, ...over,
})
const theMap = (over: Partial<ProcessMap> = {}): ProcessMap => ({
  stages: [stage(1, 'recruiter-screen'), stage(2, 'technical'), stage(3, 'system-design'), stage(4, 'onsite')],
  takeHome: { present: 'no', description: '', tips: [], sourceIds: [] },
  sources: [], guides: [], askRecruiter: [], caveats: [], grounded: true,
  researchedAt: '2026-09-03T00:00:00.000Z', ...over,
})
const round = (id: string, roundType: RoundType, createdAt = '2026-09-01T00:00:00.000Z'): InterviewRound => ({
  id, noticeRaw: '', roundType, people: [], chat: [], createdAt,
})

describe('practiceMode', () => {
  it('practises a system-design stage as design, whoever the candidate is', () => {
    expect(practiceMode('system-design', 'software engineering')).toBe('design')
    expect(practiceMode('system-design', 'design')).toBe('design')
    expect(practiceMode('system-design', 'general')).toBe('design')
  })
  it('opens the code box only for a technical stage in a role that codes', () => {
    expect(practiceMode('technical', 'software engineering')).toBe('coding')
    expect(practiceMode('technical', 'data science / ML')).toBe('coding')
    expect(practiceMode('technical', 'product')).toBe('conversation')
    expect(practiceMode('technical', 'design')).toBe('conversation')
    expect(practiceMode('technical', 'general')).toBe('conversation')
  })
  it('talks through every other kind of stage', () => {
    const kinds: StageKind[] = ['recruiter-screen', 'behavioral', 'panel', 'onsite', 'take-home', 'other']
    for (const kind of kinds) expect(practiceMode(kind, 'software engineering')).toBe('conversation')
  })
  it('takes the round’s own type when the round is not on the loop', () => {
    const design: RoundType = 'system-design'
    const technical: RoundType = 'technical'
    const other: RoundType = 'other'
    expect(practiceMode(design, 'product')).toBe('design')
    expect(practiceMode(technical, 'software engineering')).toBe('coding')
    expect(practiceMode(other, 'software engineering')).toBe('conversation')
  })
})

describe('placeRound', () => {
  it('gives the stage the round claims and how long the loop is', () => {
    const r = round('r1', 'technical')
    const placement = placeRound(r, [r], theMap())
    expect(placement?.stage.order).toBe(2)
    expect(placement?.of).toBe(4)
  })
  it('places a system-design round on the design stage', () => {
    const r = round('r1', 'system-design')
    expect(placeRound(r, [r], theMap())?.stage.order).toBe(3)
  })
  it('is null for a round whose kind the loop has no stage for', () => {
    const r = round('r1', 'behavioral')
    expect(placeRound(r, [r], theMap())).toBeNull()
  })
  it('is null for an "other" round, which claims nothing', () => {
    const r = round('r1', 'other')
    expect(placeRound(r, [r], theMap())).toBeNull()
  })
})

describe('reportedQuestions', () => {
  it('joins every reported question to the source that reported it', () => {
    const list = reportedQuestions(theMap({
      sources: [source('s1', { host: 'reddit.com', url: 'https://reddit.com/r/x/1' })],
      // The blank line is what a digest leaves behind when a guide listed nothing there.
      guides: [guide('s1', ['Walk me through a payment you shipped.', '   ', 'Why us?'], { firstHand: true })],
    }))
    expect(list).toStrictEqual([
      {
        sourceId: 's1', host: 'reddit.com', url: 'https://reddit.com/r/x/1',
        text: 'Walk me through a payment you shipped.', firstHand: true, stale: false, year: '2024',
      },
      {
        sourceId: 's1', host: 'reddit.com', url: 'https://reddit.com/r/x/1',
        text: 'Why us?', firstHand: true, stale: false, year: '2024',
      },
    ])
  })
  it('keeps one copy of a question, attributed to the best source that reported it', () => {
    const list = reportedQuestions(theMap({
      sources: [source('s1'), source('s2')],
      guides: [
        guide('s1', ['Tell me about   an outage\nyou owned.']),
        guide('s2', ['Tell me about an outage you owned.'], { firstHand: true }),
      ],
    }))
    expect(list).toHaveLength(1)
    expect(list[0].sourceId).toBe('s2')
    expect(list[0].text).toBe('Tell me about an outage you owned.')
  })
  it('orders first-hand first, then the not-stale, then the guides and their questions in order', () => {
    const list = reportedQuestions(theMap({
      sources: [source('s1'), source('s2'), source('s3'), source('s4')],
      guides: [
        guide('s1', ['second-hand fresh']),
        guide('s2', ['first-hand stale'], { firstHand: true, stale: true }),
        guide('s3', ['second-hand stale'], { stale: true }),
        guide('s4', ['first-hand fresh A', 'first-hand fresh B'], { firstHand: true }),
      ],
    }))
    expect(list.map((q) => q.text)).toEqual([
      'first-hand fresh A',
      'first-hand fresh B',
      'first-hand stale',
      'second-hand fresh',
      'second-hand stale',
    ])
  })
  it('says neither way for a guide digested before the first-hand flag existed', () => {
    const legacy: CommunityGuide = guide('s1', ['How do you test?'])
    delete (legacy as Partial<CommunityGuide>).firstHand
    const list = reportedQuestions(theMap({ sources: [source('s1')], guides: [legacy] }))
    expect(list[0].firstHand).toBeUndefined()
    expect(Object.keys(list[0])).not.toContain('firstHand')
  })
  it('carries no year when the source is undated, and none when its date is not one', () => {
    const list = reportedQuestions(theMap({
      sources: [source('s1', { publishedAt: undefined }), source('s2', { publishedAt: 'last spring' })],
      guides: [guide('s1', ['Q1']), guide('s2', ['Q2'])],
    }))
    expect(list.map((q) => q.year)).toEqual([undefined, undefined])
    expect(Object.keys(list[0])).not.toContain('year')
  })
  it('carries no year when the date parses but does not start with one', () => {
    // The digest asks for an ISO date; the schema only asks for a string, so 'March 2024' —
    // which Date.parse happily accepts — reaches here and must not become the year 'Marc'.
    const list = reportedQuestions(theMap({
      sources: [source('s1', { publishedAt: 'March 2024' })],
      guides: [guide('s1', ['Q1'])],
    }))
    expect(list[0].year).toBeUndefined()
    expect(Object.keys(list[0])).not.toContain('year')
  })
  it('carries the year of an ISO date', () => {
    const list = reportedQuestions(theMap({
      sources: [source('s1', { publishedAt: '2019-11-05T00:00:00.000Z' })],
      guides: [guide('s1', ['Q1'])],
    }))
    expect(list[0].year).toBe('2019')
  })
  it('hands over at most forty, the forty that ranked highest', () => {
    const many = Array.from({ length: 45 }, (_, i) => `Question ${i + 1}?`)
    const list = reportedQuestions(theMap({
      sources: [source('s1'), source('s2')],
      guides: [guide('s1', many), guide('s2', ['A first-hand question?'], { firstHand: true })],
    }))
    expect(list).toHaveLength(40)
    expect(list[0].text).toBe('A first-hand question?')
    expect(list[39].text).toBe('Question 39?')
  })
  it('skips a guide whose source is not in the map', () => {
    const list = reportedQuestions(theMap({
      sources: [source('s1')],
      guides: [guide('s9', ['Orphaned?']), guide('s1', ['Kept?'])],
    }))
    expect(list.map((q) => q.text)).toEqual(['Kept?'])
  })
})

describe('citeReported', () => {
  const reported = reportedQuestions(theMap({
    sources: [source('s1'), source('s2')],
    guides: [
      guide('s1', ['Walk me through a migration you led.']),
      guide('s2', ['How do you decide what not to build?']),
    ],
  }))

  it('keeps a citation whose source really reported that question', () => {
    expect(citeReported([{ q: 'Walk me through a migration you led.', angle: 'a', sourceId: 's1' }], reported))
      .toStrictEqual([{ q: 'Walk me through a migration you led.', angle: 'a', sourceId: 's1' }])
  })
  it('drops a citation onto a source that was never handed over', () => {
    expect(citeReported([{ q: 'Walk me through a migration you led.', angle: 'a', sourceId: 's9' }], reported))
      .toStrictEqual([{ q: 'Walk me through a migration you led.', angle: 'a' }])
  })
  it('drops a citation onto a source that reported something else', () => {
    expect(citeReported([{ q: 'Walk me through a migration you led.', angle: 'a', sourceId: 's2' }], reported))
      .toStrictEqual([{ q: 'Walk me through a migration you led.', angle: 'a' }])
  })
  it('drops a citation on a question that has been reworded', () => {
    expect(citeReported([{ q: 'Tell me about a migration you led.', angle: 'a', sourceId: 's1' }], reported))
      .toStrictEqual([{ q: 'Tell me about a migration you led.', angle: 'a' }])
  })
  it('keeps a citation when only whitespace differs, on either side', () => {
    const wrapped: ReportedQuestion[] = [{
      sourceId: 's1', host: 'example.com', url: 'https://example.com/s1',
      text: 'Walk me through\n a migration   you led.', firstHand: true, stale: false,
    }]
    const out = citeReported(
      [{ q: '  Walk me through\n  a migration you led. ', angle: 'a', sourceId: 's1' }],
      wrapped,
    )
    // The question keeps the model's own wording and spacing; only the citation was checked.
    expect(out).toStrictEqual([
      { q: '  Walk me through\n  a migration you led. ', angle: 'a', sourceId: 's1' },
    ])
  })
  it('turns an uncited question’s null into no key at all', () => {
    const out = citeReported([{ q: 'Something I wrote myself.', angle: 'a', sourceId: null }], reported)
    expect(out).toStrictEqual([{ q: 'Something I wrote myself.', angle: 'a' }])
    expect('sourceId' in out[0]).toBe(false)
  })
})

describe('the caps and the closing line', () => {
  it('are the numbers the mock route enforces', () => {
    expect(MAX_QUESTIONS).toBe(6)
    expect(MAX_ANSWER_CHARS).toBe(12_000)
  })
  it('is the interviewer’s last line, written here and never by the model', () => {
    expect(CLOSING_LINE).toBe('That’s all I had. End the mock for the feedback.')
  })
})
