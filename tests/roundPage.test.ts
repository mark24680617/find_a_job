import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InterviewRound, ProcessMap } from '@/lib/types'

vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn(), ApiError: class ApiError extends Error {} }))

import { RoundPlacement } from '@/components/interviews/RoundPage'

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
