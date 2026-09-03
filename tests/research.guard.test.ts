import { describe, it, expect } from 'vitest'
import { guardProcessMap, type SynthesizedMap } from '@/lib/research/guard'
import type { ProcessStage } from '@/lib/types'

const stage = (over: Partial<ProcessStage>): ProcessStage => ({
  order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', whatItProbes: 'fit',
  tips: [], sourceIds: ['s1'], confidence: 'community', ...over,
})
const map = (over: Partial<SynthesizedMap> = {}): SynthesizedMap => ({
  stages: [stage({}), stage({ order: 2, name: 'Onsite', kind: 'onsite', format: 'onsite' })],
  takeHome: { present: 'no', description: '', tips: [], sourceIds: [] },
  askRecruiter: [], caveats: [], ...over,
})
const ids = new Set(['s1', 's2'])

describe('guardProcessMap', () => {
  it('passes a map whose every citation exists and whose uncited stages are inferred', () => {
    expect(guardProcessMap(map(), ids)).toEqual([])
    expect(guardProcessMap(map({ stages: [stage({ sourceIds: [], confidence: 'inferred' })] }), ids)).toEqual([])
  })
  it('rejects a citation onto a source that was never provided', () => {
    const problems = guardProcessMap(map({ stages: [stage({ sourceIds: ['s9'] })] }), ids)
    expect(problems).toEqual([expect.stringContaining('s9')])
  })
  it('rejects an uncited stage that claims confidence, and a cited one that claims inference', () => {
    expect(guardProcessMap(map({ stages: [stage({ sourceIds: [], confidence: 'community' })] }), ids)).toHaveLength(1)
    expect(guardProcessMap(map({ stages: [stage({ sourceIds: ['s1'], confidence: 'inferred' })] }), ids)).toHaveLength(1)
  })
  it('rejects a take-home said to exist with nobody saying so', () => {
    expect(guardProcessMap(map({ takeHome: { present: 'yes', description: 'x', tips: [], sourceIds: [] } }), ids)).toHaveLength(1)
    expect(guardProcessMap(map({ takeHome: { present: 'yes', description: 'x', tips: [], sourceIds: ['s2'] } }), ids)).toEqual([])
  })
  it('walks a take-home nobody says is absent back to "unknown", and leaves a cited "no" alone', () => {
    // The mirror of the rule above. Repaired in place rather than rejected: "unknown" is the
    // honest word for it, and the rest of the loop is still worth showing.
    const uncited = map({ takeHome: { present: 'no', description: 'There is no take-home.', tips: [], sourceIds: [] } })
    expect(guardProcessMap(uncited, ids)).toEqual([])
    expect(uncited.takeHome).toEqual({ present: 'unknown', description: '', tips: [], sourceIds: [] })
    expect(uncited.caveats).toEqual(['No source says there is no take-home, so whether there is one is unknown.'])

    const cited = map({ takeHome: { present: 'no', description: 'They set none.', tips: [], sourceIds: ['s1'] } })
    expect(guardProcessMap(cited, ids)).toEqual([])
    expect(cited.takeHome.present).toBe('no')

    // A citation onto a source nobody handed over is not a citation, so it is walked back too.
    const invented = map({ takeHome: { present: 'no', description: 'They set none.', tips: [], sourceIds: ['s9'] } })
    expect(guardProcessMap(invented, ids)).toEqual([expect.stringContaining('s9')])
    expect(invented.takeHome.present).toBe('unknown')
  })
  it('rejects misnumbered stages and an empty loop', () => {
    expect(guardProcessMap(map({ stages: [stage({ order: 2 })] }), ids)).toHaveLength(1)
    expect(guardProcessMap(map({ stages: [] }), ids)).toHaveLength(1)
  })
})
