import { describe, it, expect } from 'vitest'
import { mapRoundToStage, nextStage, STAGE_LABEL, stagePosition } from '@/lib/processMap'
import type { InterviewRound, ProcessMap, ProcessStage } from '@/lib/types'

const stage = (order: number, kind: ProcessStage['kind'], name: string = kind): ProcessStage => ({
  order, name, kind, format: 'video', whatItProbes: '', tips: [], sourceIds: ['s1'], confidence: 'community',
})
const map: ProcessMap = {
  stages: [stage(1, 'recruiter-screen'), stage(2, 'take-home'), stage(3, 'technical'), stage(4, 'technical', 'Second coding round'), stage(5, 'onsite')],
  takeHome: { present: 'yes', description: '', tips: [], sourceIds: ['s1'] },
  sources: [], guides: [], askRecruiter: [], caveats: [], grounded: true, researchedAt: '2026-09-02T00:00:00.000Z',
}
const round = (id: string, roundType: InterviewRound['roundType'], createdAt: string): InterviewRound => ({
  id, noticeRaw: '', roundType, people: [], chat: [], createdAt,
})

describe('mapRoundToStage', () => {
  const r1 = round('r1', 'technical', '2026-09-01T00:00:00.000Z')
  const r2 = round('r2', 'technical', '2026-09-03T00:00:00.000Z')
  const r3 = round('r3', 'other', '2026-09-04T00:00:00.000Z')
  const r4 = round('r4', 'panel', '2026-09-05T00:00:00.000Z')
  const rounds = [r2, r1, r3, r4]
  it('gives each round the first unclaimed stage of its kind, in the order the rounds were logged', () => {
    expect(mapRoundToStage(r1, rounds, map)?.order).toBe(3)
    expect(mapRoundToStage(r2, rounds, map)?.order).toBe(4)
  })
  it('maps an "other" round to nothing, and a kind the loop lacks to nothing', () => {
    expect(mapRoundToStage(r3, rounds, map)).toBeNull()
    // r4 is in `rounds`, so this is null because the loop has no panel stage — not because
    // the round was never walked to.
    expect(mapRoundToStage(r4, rounds, map)).toBeNull()
  })
  it('gives a system-design round the system-design stage rather than a coding one', () => {
    // This is what the round type was added for. Typed 'technical' — which is what a
    // system-design notice used to be read as — this round would have claimed the coding
    // stage, and the mock would have set it a coding problem for a design round.
    const designMap: ProcessMap = {
      ...map,
      stages: [stage(1, 'technical', 'Coding round'), stage(2, 'system-design', 'System & API Design')],
    }
    const r = round('r1', 'system-design', '2026-09-01T00:00:00.000Z')
    expect(mapRoundToStage(r, [r], designMap)?.name).toBe('System & API Design')
  })
})

describe('stagePosition / nextStage', () => {
  it('says where a stage sits and what follows it', () => {
    expect(stagePosition(map.stages[2], map)).toBe('Stage 3 of 5')
    expect(nextStage(map.stages[2], map)?.name).toBe('Second coding round')
    expect(nextStage(map.stages[4], map)).toBeNull()
  })
})

describe('STAGE_LABEL', () => {
  it('names every kind, including the two the rounds do not have', () => {
    expect(STAGE_LABEL['take-home']).toBe('Take-home')
    expect(STAGE_LABEL['system-design']).toBe('System design')
    expect(STAGE_LABEL['recruiter-screen']).toBe('Recruiter screen')
  })
})
