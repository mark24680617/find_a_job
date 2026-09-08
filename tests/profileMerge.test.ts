import { describe, it, expect } from 'vitest'
import {
  blankContact,
  differsBesideContact,
  mergeIngest,
  mergeStory,
  readContact,
} from '@/lib/profileMerge'
import type { Fact, Profile, ProfileContact } from '@/lib/types'

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
  contact: blankContact(),
}

const contact = (over: Partial<ProfileContact> = {}): ProfileContact => ({
  ...blankContact(),
  ...over,
})

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

// The contact block is the letterhead's first source, so what it does on a second reading is
// what decides whether a phone number the candidate typed survives their next resume.

describe('readContact', () => {
  it('reads the four fields and nothing else', () => {
    expect(
      readContact({
        name: 'Tom Candidate',
        email: 'tom@example.test',
        phone: '(503) 555-0161',
        location: 'Portland, OR',
        website: 'tom.example.test',
      }),
    ).toStrictEqual({
      name: 'Tom Candidate',
      email: 'tom@example.test',
      phone: '(503) 555-0161',
      location: 'Portland, OR',
    })
  })

  it('reads anything that is not four strings as blank', () => {
    for (const value of [undefined, null, 'a string', 42, { phone: 5551234 }]) {
      expect(readContact(value).phone).toBe('')
    }
  })

  it('folds newlines to a space and strips control characters', () => {
    // A letterhead field is one line of an address block: a newline left in one reaches the PDF
    // as a line the layout never planned for.
    expect(readContact({ location: 'Portland,\r\nOR' }).location).toBe('Portland, OR')
    expect(readContact({ name: 'Tom\u0007 Candidate' }).name).toBe('Tom Candidate')
  })

  it('cuts a field at the letterhead’s own 200', () => {
    expect(readContact({ name: 'a'.repeat(400) }).name).toHaveLength(200)
  })
})

describe('mergeIngest contact', () => {
  // Read back through `readContact`, which is how every reader gets at it: the stored field is
  // optional, so what the merge wrote is not a `ProfileContact` until something reads it as one.
  const merge = (existing: Profile, incoming: Partial<ProfileContact>) =>
    readContact(mergeIngest(existing, { ...ingested, contact: contact(incoming) }).contact)

  const stored_ = (over: Partial<ProfileContact>): Profile => ({ ...stored, contact: contact(over) })

  it('keeps a typed phone over the one the ingest read', () => {
    // Same principle as standardAnswers: the human wins, and a document that disagrees with
    // what they typed does not get to overwrite it.
    expect(merge(stored_({ phone: '(503) 555-0161' }), { phone: '(206) 555-0114' }).phone).toBe(
      '(503) 555-0161',
    )
  })

  it('fills a blank location from the ingest', () => {
    expect(merge(stored_({ phone: '(503) 555-0161' }), { location: 'Portland, OR' })).toStrictEqual({
      name: '',
      email: '',
      phone: '(503) 555-0161',
      location: 'Portland, OR',
    })
  })

  it('changes nothing when the ingest states none of the four', () => {
    const before = contact({ name: 'Tom Candidate', location: 'Portland, OR' })
    expect(merge({ ...stored, contact: before }, {})).toStrictEqual(before)
  })

  it('takes the ingest’s contact into a profile that has none', () => {
    expect(merge(stored, { name: 'Tom Candidate', email: 'tom@example.test' })).toStrictEqual({
      name: 'Tom Candidate',
      email: 'tom@example.test',
      phone: '',
      location: '',
    })
  })

  it('reads a stored contact of the wrong shape rather than trusting it', () => {
    const odd = { ...stored, contact: { phone: 5551234 } as unknown as ProfileContact }
    expect(merge(odd, { phone: '(503) 555-0161' }).phone).toBe('(503) 555-0161')
  })

  it('merges the story’s contact the same way', () => {
    const merged = mergeStory(stored_({ name: 'Tom Candidate' }), {
      ...ingested,
      contact: contact({ name: 'T. Candidate', phone: '(503) 555-0161' }),
    })
    expect(readContact(merged.contact)).toStrictEqual(
      contact({ name: 'Tom Candidate', phone: '(503) 555-0161' }),
    )
  })
})

/**
 * The comparison the profile screen's rule 1 is made of. A changeset names facts by id, so what
 * it can land on wrongly is a fact edited locally — never a contact field, which is why the block
 * a reading has just filled in must not be what refuses the reading's own facts.
 */
describe('differsBesideContact', () => {
  it('reads a contact-only difference as no difference at all', () => {
    const filled = { ...stored, contact: contact({ name: 'Tom Candidate' }) }
    expect(differsBesideContact(filled, stored)).toBe(false)
    expect(differsBesideContact(stored, filled)).toBe(false)
  })

  it('reads a blank contact on a profile that has none as no difference either', () => {
    expect(differsBesideContact({ ...stored, contact: blankContact() }, stored)).toBe(false)
  })

  it('still sees an edited fact', () => {
    const edited = {
      ...stored,
      contact: contact({ name: 'Tom Candidate' }),
      facts: [fact('f1', 'Shipped the payments service in 2024'), stored.facts[1]],
    }
    expect(differsBesideContact(edited, stored)).toBe(true)
  })

  it('still sees an answered gap and a typed standard answer', () => {
    expect(differsBesideContact({ ...stored, gaps: [] }, stored)).toBe(true)
    expect(
      differsBesideContact(
        { ...stored, standardAnswers: { ...stored.standardAnswers, notice_period: 'Two weeks' } },
        stored,
      ),
    ).toBe(true)
  })
})
