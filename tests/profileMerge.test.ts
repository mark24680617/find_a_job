import { describe, it, expect } from 'vitest'
import { mergeIngest, mergeStory } from '@/lib/profileMerge'
import type { Fact, Profile } from '@/lib/types'

// The merge is where a second upload either extends the vault or quietly destroys it, so
// every rule gets a case: ids never collide, hand-entered answers survive, voice rules are
// untouched, gaps are replaced.

const fact = (id: string, claim: string): Fact => ({
  id,
  claim,
  sourceSnippet: claim,
  tags: ['backend'],
})

const stored: Profile = {
  facts: [fact('f1', 'Shipped the payments service'), fact('f2', 'Graduated in 2020')],
  standardAnswers: { work_authorization: 'US citizen', notice_period: 'UNKNOWN' },
  voiceRules: [
    { rule: 'Lead with the number', evidence: 'moved 12k up', createdAt: '2026-08-01T00:00:00Z' },
  ],
  gaps: ['no dates on the 2024 role'],
}

const ingested = {
  facts: [fact('f1', 'Cut p99 latency to 210ms'), fact('f2', 'Mentors two engineers')],
  standardAnswers: { relocation: 'UNKNOWN' },
  gaps: ['no links to the project'],
}

describe('mergeIngest facts', () => {
  it('appends new facts after the existing ones', () => {
    const merged = mergeIngest(stored, ingested)
    expect(merged.facts.map((f) => f.claim)).toEqual([
      'Shipped the payments service',
      'Graduated in 2020',
      'Cut p99 latency to 210ms',
      'Mentors two engineers',
    ])
  })

  it('re-numbers incoming facts so ids never collide', () => {
    // The model numbers from f1 on every run; without the re-id a second upload would
    // hand two different facts the same id, and citations point at ids.
    const merged = mergeIngest(stored, ingested)
    expect(merged.facts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4'])
  })

  it('continues past the highest id in use, not past the count', () => {
    const sparse: Profile = { ...stored, facts: [fact('f1', 'one'), fact('f7', 'seven')] }
    expect(mergeIngest(sparse, ingested).facts.map((f) => f.id)).toEqual(['f1', 'f7', 'f8', 'f9'])
  })

  it('numbers from f1 into an empty profile', () => {
    const empty: Profile = { facts: [], standardAnswers: {}, voiceRules: [], gaps: [] }
    expect(mergeIngest(empty, ingested).facts.map((f) => f.id)).toEqual(['f1', 'f2'])
  })

  it('ignores stored ids that are not f<n> when picking the next one', () => {
    const odd: Profile = { ...stored, facts: [fact('imported-3', 'from elsewhere')] }
    expect(mergeIngest(odd, ingested).facts.map((f) => f.id)).toEqual(['imported-3', 'f1', 'f2'])
  })

  it('keeps everything else about an incoming fact', () => {
    const merged = mergeIngest(stored, ingested)
    expect(merged.facts[2]).toEqual({
      id: 'f3',
      claim: 'Cut p99 latency to 210ms',
      sourceSnippet: 'Cut p99 latency to 210ms',
      tags: ['backend'],
    })
  })

  it('does not mutate the profile it was given', () => {
    mergeIngest(stored, ingested)
    expect(stored.facts).toHaveLength(2)
    expect(stored.gaps).toEqual(['no dates on the 2024 role'])
  })
})

describe('mergeIngest standardAnswers', () => {
  const merge = (incoming: Record<string, string>) =>
    mergeIngest(stored, { ...ingested, standardAnswers: incoming }).standardAnswers

  it('never lets UNKNOWN overwrite an answer the candidate gave', () => {
    // Only the human knows these. A resume that simply fails to mention work
    // authorization must not erase the answer they typed in.
    expect(merge({ work_authorization: 'UNKNOWN' }).work_authorization).toBe('US citizen')
  })

  it('overwrites with a real value the input actually states', () => {
    expect(merge({ work_authorization: 'H-1B, transfer needed' }).work_authorization).toBe(
      'H-1B, transfer needed',
    )
  })

  it('overwrites a stored UNKNOWN with a real value', () => {
    expect(merge({ notice_period: 'two weeks' }).notice_period).toBe('two weeks')
  })

  it('records an unseen key as UNKNOWN so the candidate is asked', () => {
    expect(merge({ relocation: 'UNKNOWN' }).relocation).toBe('UNKNOWN')
  })

  it('keeps answers the ingest said nothing about', () => {
    expect(merge({}).work_authorization).toBe('US citizen')
  })

  it('drops a value that is not a string', () => {
    const merged = merge({ relocation: true as unknown as string })
    expect(merged.relocation).toBeUndefined()
  })
})

describe('mergeIngest voiceRules and gaps', () => {
  it('never wipes voice rules — they are learned from edits, not from resumes', () => {
    expect(mergeIngest(stored, ingested).voiceRules).toEqual(stored.voiceRules)
  })

  it('replaces gaps wholesale — they describe the profile as it now stands', () => {
    expect(mergeIngest(stored, ingested).gaps).toEqual(['no links to the project'])
  })

  it('clears gaps when the ingest found none left', () => {
    expect(mergeIngest(stored, { ...ingested, gaps: [] }).gaps).toEqual([])
  })
})

// mergeStory is mergeIngest for a different kind of input: a few sentences the candidate
// typed about one answer, not a document describing their whole career. Everything about
// facts and standard answers is the same — the one difference is gaps, and it is the whole
// reason this exists.

describe('mergeStory', () => {
  it('appends and re-numbers the story’s facts exactly as an ingest does', () => {
    const merged = mergeStory(stored, ingested)
    expect(merged.facts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4'])
    expect(merged.facts.map((f) => f.claim)).toEqual([
      'Shipped the payments service',
      'Graduated in 2020',
      'Cut p99 latency to 210ms',
      'Mentors two engineers',
    ])
  })

  it('merges standard answers the same way, never letting UNKNOWN overwrite an answer', () => {
    const merged = mergeStory(stored, {
      ...ingested,
      standardAnswers: { work_authorization: 'UNKNOWN', notice_period: 'two weeks' },
    })
    expect(merged.standardAnswers.work_authorization).toBe('US citizen')
    expect(merged.standardAnswers.notice_period).toBe('two weeks')
  })

  it('leaves the voice rules alone', () => {
    expect(mergeStory(stored, ingested).voiceRules).toEqual(stored.voiceRules)
  })

  it('KEEPS the existing gaps — the one thing it does differently from mergeIngest', () => {
    // A gaps list read off a whole resume says what the PROFILE is missing. Two paragraphs
    // about one job would be read as a profile missing almost everything, and letting that
    // replace the list would wipe the real one — the delta that makes this function exist.
    expect(mergeIngest(stored, ingested).gaps).toEqual(['no links to the project'])
    expect(mergeStory(stored, ingested).gaps).toEqual(['no dates on the 2024 role'])
  })

  it('keeps an empty gaps list empty rather than filling it from the story', () => {
    const noGaps: Profile = { ...stored, gaps: [] }
    expect(mergeStory(noGaps, ingested).gaps).toEqual([])
  })
})
