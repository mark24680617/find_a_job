import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InterviewRound, PrepBrief, ProcessMap, ProcessStage } from '@/lib/types'

vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn(), ApiError: class ApiError extends Error {} }))

import { BriefSection, RoundPlacement, TakeHomePlacement } from '@/components/interviews/RoundPage'

const map: ProcessMap = {
  stages: [
    { order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', whatItProbes: 'Fit.', tips: ['Be brief.'], sourceIds: ['s1'], confidence: 'community' },
    { order: 2, name: 'Coding round', kind: 'technical', format: 'video', whatItProbes: 'Algorithms.', tips: [], sourceIds: ['s1'], confidence: 'community' },
  ],
  takeHome: { present: 'no', description: '', tips: [], sourceIds: [] },
  sources: [{ id: 's1', title: 't', url: 'https://x.com/', host: 'x.com', kind: 'community', snippet: '', fetched: false }],
  guides: [], askRecruiter: [], caveats: [], grounded: true, researchedAt: '2026-09-02T00:00:00.000Z',
}
const round = (roundType: InterviewRound['roundType']): InterviewRound => ({ id: 'r1', noticeRaw: '', roundType, people: [], chat: [], createdAt: '2026-09-01T00:00:00.000Z' })

describe('RoundPlacement', () => {
  it('places a mapped round and names what comes next', () => {
    const markup = renderToStaticMarkup(createElement(RoundPlacement, { round: round('recruiter-screen'), rounds: [round('recruiter-screen')], map, appId: 'app-1' }))
    expect(markup).toContain('Stage 1 of 2')
    expect(markup).toContain('Recruiter screen')
    expect(markup).toContain('Be brief.')
    expect(markup).toContain('Next: Coding round')
  })
  it('says when a round is not on the reported loop', () => {
    const markup = renderToStaticMarkup(createElement(RoundPlacement, { round: round('panel'), rounds: [round('panel')], map, appId: 'app-1' }))
    expect(markup).toContain('isn’t on the reported loop')
  })
  it('points back to the research when there is no map', () => {
    const markup = renderToStaticMarkup(createElement(RoundPlacement, { round: round('technical'), rounds: [], map: undefined, appId: 'app-1' }))
    expect(markup).toContain('Research the process')
    expect(markup).toContain('href="/applications/app-1"')
  })
  it('says when the round is the last reported stage', () => {
    const markup = renderToStaticMarkup(createElement(RoundPlacement, { round: round('technical'), rounds: [round('technical')], map, appId: 'app-1' }))
    expect(markup).toContain('This is the last reported stage.')
  })
  it('reports a failed rounds fetch as a failed fetch, not as a fact about the loop', () => {
    const markup = renderToStaticMarkup(createElement(RoundPlacement, { round: round('recruiter-screen'), rounds: [], map, appId: 'app-1', roundsFailed: true }))
    expect(markup).toContain('The other rounds couldn’t be loaded, so this one can’t be placed — reload to try again.')
    expect(markup).not.toContain('isn’t on the reported loop')
    expect(markup).not.toContain('Stage 1 of 2')
  })
  it('places the round even when the list it was given leaves it out', () => {
    const markup = renderToStaticMarkup(createElement(RoundPlacement, { round: round('recruiter-screen'), rounds: [], map, appId: 'app-1' }))
    expect(markup).toContain('Stage 1 of 2')
    expect(markup).not.toContain('isn’t on the reported loop')
  })
})

// A take-home is the one round type a reported loop often has no stage for: the research answers
// "is there a take-home" in a block of its own and lists the conversations as stages. So
// "this round isn’t on the reported loop" answers a question nobody asked — and, for a "no",
// leaves the person unable to check the one verdict that contradicts the email in their inbox.
//
// How the page decides: a take-home round's "Where this sits" is always `TakeHomePlacement`, and
// `TakeHomePlacement` hands back to `RoundPlacement` for every case that is not the one it exists
// for — a round that maps, a page with no map, a rounds list that failed to load. Only a null
// placement on a map that exists gets the verdict. That is why the ordinary cases are asserted
// here too: on a take-home round they are this component's answers, not another's.
const takeHomeStage: ProcessStage = {
  order: 3,
  name: 'Take-home exercise',
  kind: 'take-home',
  format: 'async',
  whatItProbes: 'Working code, unhurried.',
  tips: [],
  sourceIds: ['s1'],
  confidence: 'community',
}
// The fixture map above has no take-home stage, which is the shape this section is for.
const verdictMap = (takeHome: Partial<ProcessMap['takeHome']>): ProcessMap => ({
  ...map,
  takeHome: { present: 'unknown', description: '', tips: [], sourceIds: ['s1'], ...takeHome },
})
const takeHomeRound = (id: string, createdAt: string): InterviewRound => ({
  id,
  noticeRaw: '',
  roundType: 'take-home',
  people: [],
  chat: [],
  createdAt,
})
const placed = (
  m: ProcessMap | undefined,
  round: InterviewRound,
  rounds: InterviewRound[] = [round],
  roundsFailed = false,
) =>
  renderToStaticMarkup(
    createElement(TakeHomePlacement, { round, rounds, map: m, appId: 'app-1', roundsFailed }),
  )

describe('TakeHomePlacement', () => {
  const first = takeHomeRound('r1', '2026-09-01T00:00:00.000Z')

  it('reports the map’s own verdict when the loop has no take-home stage', () => {
    const out = placed(
      verdictMap({ present: 'yes', description: 'A four-hour data pipeline exercise.' }),
      first,
    )
    expect(out).toContain('The research reported a take-home.')
    expect(out).toContain('A four-hour data pipeline exercise.')
    expect(out).not.toContain('isn’t on the reported loop')
  })

  it('shows a “no” with what says so, so the verdict can be checked', () => {
    const out = placed(
      verdictMap({ present: 'no', description: 'Two write-ups say the loop is interviews only.' }),
      first,
    )
    expect(out).toContain(
      'The research reported no take-home. This one is not on the reported loop.',
    )
    expect(out).toContain('Two write-ups say the loop is interviews only.')
    expect(out).toContain('href="https://x.com/"')
    expect(out).toContain('>t</a>')
  })

  it('says plainly when the research could not settle it', () => {
    const out = placed(verdictMap({ present: 'unknown' }), first)
    expect(out).toContain('The research could not settle whether there is a take-home.')
    expect(out).not.toContain('isn’t on the reported loop')
  })

  it('places a mapped take-home round exactly as any other round is placed', () => {
    const mapped: ProcessMap = {
      ...verdictMap({ present: 'yes', description: 'A four-hour data pipeline exercise.' }),
      stages: [...map.stages, takeHomeStage],
    }
    const out = placed(mapped, first)
    expect(out).toContain('Stage 3 of 3')
    expect(out).toContain('Take-home exercise')
    expect(out).toContain('Working code, unhurried.')
    expect(out).not.toContain('The research reported a take-home.')
  })

  it('gives the verdict to a second take-home round, once the first has taken the stage', () => {
    // One stage, two rounds: the first claims it and the second is left with nowhere on the loop
    // to sit. The map still says there is a take-home, and that is what this round's page shows.
    const mapped: ProcessMap = {
      ...verdictMap({ present: 'yes', description: 'A four-hour data pipeline exercise.' }),
      stages: [...map.stages, takeHomeStage],
    }
    const second = takeHomeRound('r2', '2026-09-02T00:00:00.000Z')
    const out = placed(mapped, second, [first, second])
    expect(out).toContain('The research reported a take-home.')
    expect(out).toContain('A four-hour data pipeline exercise.')
    expect(out).not.toContain('Stage 3 of 3')
  })

  it('points back to the research when there is no map', () => {
    const out = placed(undefined, first, [])
    expect(out).toContain('Research the process')
    expect(out).toContain('href="/applications/app-1"')
    expect(out).not.toContain('The research could not settle')
  })

  it('reports a failed rounds fetch as a failed fetch, not as a verdict', () => {
    const out = placed(verdictMap({ present: 'no' }), first, [], true)
    expect(out).toContain(
      'The other rounds couldn’t be loaded, so this one can’t be placed — reload to try again.',
    )
    expect(out).not.toContain('The research reported no take-home.')
  })
})

// The brief's own section: what the link is called, whether the brief on screen was written
// before the research, and whether there is a brief for a rewrite to replace. The `map` fixture
// above was researched on 2026-09-02; the briefs below are dated against it.
//
// What is deliberately not asserted here: the 422 line. `renderToStaticMarkup` draws the section
// at rest, and the error is state a click and a failed fetch put there — no static render can
// reach it. The one thing a static render CAN say about it is that it is absent until then, and
// the first test below says exactly that.
const brief = (over: Partial<PrepBrief> = {}): PrepBrief => ({
  likelyTopics: ['What money movement looks like here'],
  questionsToPrepare: [],
  questionsToAsk: [],
  factsToRehearse: [],
  redFlags: [],
  ...over,
})

// The map is passed at every call rather than defaulted: a default parameter fires on an
// explicit `undefined` too, so the two tests whose whole point is that there is no map would
// have been handed the fixture back and would have been testing the branch beside the one they
// name.
const section = (over: Partial<InterviewRound>, m: ProcessMap | undefined) =>
  renderToStaticMarkup(
    createElement(BriefSection, {
      appId: 'app-1',
      round: { ...round('technical'), ...over },
      map: m,
      onRound: () => {},
    }),
  )

describe('BriefSection', () => {
  it('offers to write the first brief, with nothing to replace', () => {
    const out = section({}, map)
    expect(out).toContain('Write the brief')
    expect(out).toContain('No brief was written for this round.')
    expect(out).not.toContain('Replaces the brief you have now.')
    // Nothing was written, so nothing was written before the research either.
    expect(out).not.toContain('Written before the research.')
    // And nothing has been clicked, so the 422's sentence is not on screen either — the section
    // at rest makes no claim about a brief that is or is not still here.
    expect(out).not.toContain('is still here')
  })

  it('offers the research when there is a map and a brief to replace', () => {
    const out = section({ prepBrief: brief() }, map)
    expect(out).toContain('Rewrite the brief with the research')
    expect(out).toContain('Replaces the brief you have now.')
  })

  it('offers a plain rewrite when nothing has been researched', () => {
    const out = section({ prepBrief: brief() }, undefined)
    expect(out).toContain('Rewrite the brief')
    expect(out).not.toContain('with the research')
    expect(out).toContain('Replaces the brief you have now.')
  })

  it('says when the brief was written before the research', () => {
    expect(section({ prepBrief: brief() }, map)).toContain('Written before the research.')
  })

  it('says it too when the brief read an older map', () => {
    const older = brief({ basis: { stageOrder: 2, researchedAt: '2026-09-01T00:00:00.000Z' } })
    expect(section({ prepBrief: older }, map)).toContain('Written before the research.')
  })

  it('stays quiet when the brief already read this map', () => {
    const same = brief({ basis: { stageOrder: 2, researchedAt: '2026-09-02T00:00:00.000Z' } })
    expect(section({ prepBrief: same }, map)).not.toContain('Written before the research.')
    const newer = brief({ basis: { stageOrder: 2, researchedAt: '2026-09-03T00:00:00.000Z' } })
    expect(section({ prepBrief: newer }, map)).not.toContain('Written before the research.')
  })

  it('stays quiet when there is no research for the brief to predate', () => {
    expect(section({ prepBrief: brief() }, undefined)).not.toContain('Written before the research.')
  })

  it('names the guide a cited question came from', () => {
    const cited = brief({
      questionsToPrepare: [{ q: 'Walk me through a payment that failed.', angle: 'f1', sourceId: 's1' }],
    })
    const out = section({ prepBrief: cited }, map)
    expect(out).toContain('reported by x.com')
    expect(out).toContain('href="https://x.com/"')
  })
})
