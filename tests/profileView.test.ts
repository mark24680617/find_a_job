import { describe, it, expect } from 'vitest'
import type { Fact } from '@/lib/types'
import {
  sectionOf,
  claimEntity,
  entityOf,
  groupByEntity,
  groupFacts,
  knownEntities,
  tagEntity,
  GENERAL,
  extractIdentity,
  factFromGapAnswer,
  nextFactId,
  visibleGaps,
  SECTION_ORDER,
  type Section,
} from '@/lib/profileView'

/**
 * The organized profile view is pure and must stay so: the same facts always sort the same way,
 * every fact lands in exactly one section, and identity extraction never invents a field it
 * cannot find. These are the two feedback fixes (organized view + answerable gaps) reduced to the
 * functions the DOM only renders.
 */

function fact(partial: Partial<Fact> & { id: string }): Fact {
  return { claim: '', sourceSnippet: '', tags: [], ...partial }
}

describe('sectionOf', () => {
  it('maps a section-name tag straight to its section', () => {
    expect(sectionOf(fact({ id: 'f1', tags: ['education'], claim: 'B.S. Computer Science' }))).toBe(
      'Education',
    )
    expect(sectionOf(fact({ id: 'f2', tags: ['contact'], claim: 'Portland, Oregon' }))).toBe('Contact')
    expect(sectionOf(fact({ id: 'f3', tags: ['experience'] }))).toBe('Experience')
    expect(sectionOf(fact({ id: 'f4', tags: ['project'] }))).toBe('Projects')
    expect(sectionOf(fact({ id: 'f5', tags: ['skills'] }))).toBe('Skills')
  })

  it('classifies an email- or url-looking claim as Contact', () => {
    expect(sectionOf(fact({ id: 'f1', claim: 'tom.candidate@example.com' }))).toBe('Contact')
    expect(sectionOf(fact({ id: 'f2', claim: 'Portfolio at www.tomcandidate.dev' }))).toBe('Contact')
    expect(sectionOf(fact({ id: 'f3', claim: 'Reach me on +1 (555) 234-5678 any time' }))).toBe(
      'Contact',
    )
  })

  it('falls back on claim keywords when no tag matches', () => {
    expect(sectionOf(fact({ id: 'f1', tags: ['cs'], claim: 'B.S. in Computer Science, GPA 3.6' }))).toBe(
      'Education',
    )
    expect(
      sectionOf(fact({ id: 'f2', tags: ['cli'], claim: 'An open-source CLI with 1,200 GitHub stars' })),
    ).toBe('Projects')
    expect(
      sectionOf(fact({ id: 'f3', tags: ['payments'], claim: 'Led the migration of 14 services' })),
    ).toBe('Experience')
  })

  it('sends a fact with no signal to Other', () => {
    expect(sectionOf(fact({ id: 'f1', tags: ['misc'], claim: 'Prefers tea over coffee' }))).toBe('Other')
    expect(sectionOf(fact({ id: 'f2', tags: [], claim: '' }))).toBe('Other')
  })

  it('lets an explicit tag override the claim shape', () => {
    // The claim looks like Contact, but a Skills tag is the stronger, explicit signal.
    expect(sectionOf(fact({ id: 'f1', tags: ['skills'], claim: 'me@example.com' }))).toBe('Skills')
  })

  it('is a total function — always one of the known sections', () => {
    const samples = [
      fact({ id: 'f1', claim: 'anything at all' }),
      fact({ id: 'f2', tags: ['weird'], claim: '???' }),
    ]
    for (const f of samples) expect(SECTION_ORDER).toContain(sectionOf(f))
  })
})

describe('groupFacts', () => {
  const facts: Fact[] = [
    fact({ id: 'f1', tags: ['contact'], claim: 'tom@example.com' }),
    fact({ id: 'f2', tags: ['education'], claim: 'B.S. Computer Science' }),
    fact({ id: 'f3', tags: ['payments'], claim: 'Owns the payments service' }),
    fact({ id: 'f4', tags: ['misc'], claim: 'Prefers tea over coffee' }),
    fact({ id: 'f5', tags: ['education'], claim: 'GPA 3.6' }),
  ]

  it('places every fact in exactly one section', () => {
    const grouped = groupFacts(facts)
    const placed = grouped.flatMap((g) => g.facts.map((f) => f.id))
    expect(placed.sort()).toEqual(['f1', 'f2', 'f3', 'f4', 'f5'])
    // No id appears twice.
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('returns non-empty sections in SECTION_ORDER', () => {
    const order = groupFacts(facts).map((g) => g.section)
    const expectedOrder = SECTION_ORDER.filter((s) => order.includes(s))
    expect(order).toEqual(expectedOrder)
  })

  it('is deterministic', () => {
    expect(groupFacts(facts)).toEqual(groupFacts(facts))
  })

  it('groups the two education facts together', () => {
    const education = groupFacts(facts).find((g) => g.section === 'Education')
    expect(education?.facts.map((f) => f.id)).toEqual(['f2', 'f5'])
  })

  it('returns nothing for no facts', () => {
    expect(groupFacts([])).toEqual([])
  })
})

describe('extractIdentity', () => {
  it('pulls an email out of a claim', () => {
    const id = extractIdentity([fact({ id: 'f1', claim: 'Reachable at tom.candidate@example.com' })])
    expect(id.email).toBe('tom.candidate@example.com')
  })

  it('pulls a website without mistaking an email domain for one', () => {
    const id = extractIdentity([
      fact({ id: 'f1', claim: 'Email tom@example.com' }),
      fact({ id: 'f2', claim: 'Site: https://tomcandidate.dev/projects' }),
    ])
    expect(id.email).toBe('tom@example.com')
    expect(id.website).toBe('https://tomcandidate.dev/projects')
  })

  it('takes a location only from a tagged fact', () => {
    const id = extractIdentity([fact({ id: 'f1', tags: ['location'], claim: 'Portland, Oregon' })])
    expect(id.location).toBe('Portland, Oregon')
  })

  it('takes a name from a tagged fact', () => {
    const id = extractIdentity([fact({ id: 'f1', tags: ['name'], claim: 'Tom Candidate' })])
    expect(id.name).toBe('Tom Candidate')
  })

  it('reads an identity field from a standard answer an ingest wrote', () => {
    const id = extractIdentity([], { email: 'hr@example.com', work_authorization: 'Yes' })
    expect(id.email).toBe('hr@example.com')
  })

  it('ignores an UNKNOWN standard answer', () => {
    const id = extractIdentity([], { phone: 'UNKNOWN' })
    expect(id.phone).toBeUndefined()
  })

  it('omits every field it cannot find', () => {
    expect(extractIdentity([fact({ id: 'f1', claim: 'Backend engineer' })])).toEqual({})
  })
})

describe('factFromGapAnswer + gap clearing', () => {
  const facts: Fact[] = [fact({ id: 'f1' }), fact({ id: 'f2' })]

  it('builds a well-formed fact continuing the id sequence', () => {
    const f = factFromGapAnswer(facts, 'Are you authorized to work in the US?', '  Yes, citizen  ')
    expect(f).toEqual({
      id: 'f3',
      claim: 'Yes, citizen',
      sourceSnippet: 'You answered: Are you authorized to work in the US?',
      tags: ['from-you'],
    })
  })

  it('appends the fact and removes the answered gap (the page-level contract)', () => {
    const gaps = ['Work authorization?', 'Notice period?']
    const index = 0
    const built = factFromGapAnswer(facts, gaps[index], 'Citizen')
    const nextFacts = [...facts, built]
    const nextGaps = gaps.filter((_, i) => i !== index)

    expect(nextFacts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(nextGaps).toEqual(['Notice period?'])
  })
})

describe('nextFactId', () => {
  it('starts at f1 and steps past the highest id', () => {
    expect(nextFactId([])).toBe('f1')
    expect(nextFactId([fact({ id: 'f1' }), fact({ id: 'f7' }), fact({ id: 'f3' })])).toBe('f8')
  })
})

/**
 * The gaps filter has an asymmetric cost: showing a duplicate wastes a row, dropping a real gap
 * loses a question only the candidate can answer. So the cases below pin both directions — the
 * eight standard-answer subjects go, and anything with a whiff of them about it stays.
 */
describe('visibleGaps', () => {
  it('drops a gap the Standard answers section is already asking', () => {
    expect(
      visibleGaps([
        'No work authorization status stated',
        'Right to work in the US is not mentioned',
        'Visa sponsorship requirement is unknown',
        'Willingness to relocate is not stated',
        'No salary expectation given',
        'Expected compensation is missing',
        'Notice period is not stated',
        'No earliest start date',
        'Security clearance status is not mentioned',
        'Remote or on-site preference is missing',
        'Current location is not given',
      ]),
    ).toEqual([])
  })

  it('keeps everything the standard answers do not cover', () => {
    const real = [
      'No dates on the Fintech Co role',
      'The 2021–2022 employment gap is unexplained',
      'No metric for the payments migration',
      'No link to the open-source work',
      'The team size you led is not stated',
    ]
    expect(visibleGaps(real)).toEqual(real)
  })

  it('does not read "relocation" as "location"', () => {
    // `\blocation\b` has no word boundary inside "relocation" — but the two rules must not be
    // allowed to collapse into one that quietly matches more than either.
    expect(visibleGaps(['Relocation preference is missing'])).toEqual([])
    expect(visibleGaps(['You allocated the budget — no figure given'])).toEqual([
      'You allocated the budget — no figure given',
    ])
  })

  it('keeps a gap that only happens to mention a standard-ish word', () => {
    const kept = [
      'No metrics for the remote team you led',
      'The on-site rollout has no dates',
      'No evidence for the claim about starting the guild',
    ]
    expect(visibleGaps(kept)).toEqual(kept)
  })

  it('is order-preserving and total on an empty list', () => {
    expect(visibleGaps([])).toEqual([])
    expect(visibleGaps(['b gap', 'No salary expectation given', 'a gap'])).toEqual(['b gap', 'a gap'])
  })
})

// Type-only guard: Section stays the closed union the UI switches on.
const _sections: Section[] = ['Contact', 'Education', 'Experience', 'Projects', 'Skills', 'Other']
void _sections

/**
 * Entity sub-grouping: within Experience and Projects, which company or project a fact belongs
 * to. The tag is the deliberate statement and always wins; the claim heuristic is the fallback
 * for a bank written before the tag existed, and it is deliberately conservative — one passing
 * mention of a place is not a column, so a name has to be corroborated (tagged somewhere, or
 * said twice) before anything sorts under it.
 */
describe('tagEntity', () => {
  it('reads the name off an entity tag, prefix stripped', () => {
    expect(tagEntity(fact({ id: 'f1', tags: ['backend', 'entity:Fenwick'] }))).toBe('Fenwick')
  })

  it('takes the first entity tag when a fact carries two', () => {
    expect(tagEntity(fact({ id: 'f1', tags: ['entity:Fenwick', 'entity:Acme'] }))).toBe('Fenwick')
  })

  it('tolerates surrounding whitespace and a shouted prefix', () => {
    expect(tagEntity(fact({ id: 'f1', tags: ['  Entity: Fenwick Labs  '] }))).toBe('Fenwick Labs')
  })

  it('is null for a topic tag, and for a prefix with no name after it', () => {
    expect(tagEntity(fact({ id: 'f1', tags: ['backend', 'payments'] }))).toBeNull()
    expect(tagEntity(fact({ id: 'f2', tags: ['entity:'] }))).toBeNull()
  })
})

describe('claimEntity', () => {
  it('reads the proper name a claim says it happened at', () => {
    expect(claimEntity('Owns the payments service at Fenwick')).toBe('Fenwick')
    expect(claimEntity('Owns payments at Fenwick, handling 12,000 requests/day')).toBe('Fenwick')
    expect(claimEntity('Interned at MIT Media Lab in 2023')).toBe('MIT Media Lab')
  })

  it('stops at the first word that is not part of the name', () => {
    expect(claimEntity('Led the platform team at Acme Corp for three years')).toBe('Acme Corp')
  })

  it('is null when "at" is not followed by a name', () => {
    // The whole reason the heuristic is narrow: a metric is not an employer.
    expect(claimEntity('Serves 12,000 requests/day at 210ms p99')).toBeNull()
    expect(claimEntity('Ran the migration at scale')).toBeNull()
    expect(claimEntity('Three years of backend experience')).toBeNull()
  })
})

describe('knownEntities', () => {
  it('takes every name a fact tags with, however few facts mention it', () => {
    const facts = [
      fact({ id: 'f1', tags: ['entity:Fenwick'], claim: 'Owns payments' }),
      fact({ id: 'f2', tags: ['backend'], claim: 'Wrote some Go' }),
    ]
    expect(knownEntities(facts)).toEqual(['Fenwick'])
  })

  it('takes a claim-only name once two claims say it', () => {
    const twice = [
      fact({ id: 'f1', claim: 'Owns the payments service at Fenwick' }),
      fact({ id: 'f2', claim: 'Ran the on-call rotation at Fenwick' }),
    ]
    expect(knownEntities(twice)).toEqual(['Fenwick'])
  })

  it('leaves a name only one claim mentions alone', () => {
    // One mention is a mention. Sorting a section by it would invent a column from a sentence.
    const once = [
      fact({ id: 'f1', claim: 'Spoke at PyCon about the migration' }),
      fact({ id: 'f2', claim: 'Wrote some Go' }),
    ]
    expect(knownEntities(once)).toEqual([])
  })

  it('prefers the tag’s spelling over the claim’s, and never lists one name twice', () => {
    const facts = [
      fact({ id: 'f1', tags: ['entity:Fenwick'], claim: 'Owns payments' }),
      fact({ id: 'f2', claim: 'Ran on-call at FENWICK' }),
      fact({ id: 'f3', claim: 'Mentored two juniors at fenwick' }),
    ]
    expect(knownEntities(facts)).toEqual(['Fenwick'])
  })
})

describe('entityOf', () => {
  const known = ['Fenwick']

  it('takes the tag over the claim, whatever the claim says', () => {
    const f = fact({ id: 'f1', tags: ['entity:Acme'], claim: 'Owns payments at Fenwick' })
    expect(entityOf(f, known)).toBe('Acme')
  })

  it('falls back to the claim when the name is one the bank knows', () => {
    expect(entityOf(fact({ id: 'f1', claim: 'Ran on-call at Fenwick' }), known)).toBe('Fenwick')
    // Case-insensitively, and answering in the known spelling rather than the claim's.
    expect(entityOf(fact({ id: 'f2', claim: 'Ran on-call at FENWICK' }), known)).toBe('Fenwick')
  })

  it('is null for a name nothing corroborates, and for a fact that names none', () => {
    expect(entityOf(fact({ id: 'f1', claim: 'Spoke at PyCon' }), known)).toBeNull()
    expect(entityOf(fact({ id: 'f2', claim: 'Wrote some Go' }), known)).toBeNull()
  })
})

describe('groupByEntity', () => {
  const facts = [
    fact({ id: 'f1', tags: ['entity:Fenwick'], claim: 'Owns the payments service' }),
    fact({ id: 'f2', claim: 'Wrote some Go' }),
    fact({ id: 'f3', tags: ['entity:Acme'], claim: 'Built the billing pipeline' }),
    fact({ id: 'f4', claim: 'Ran the on-call rotation at Fenwick' }),
  ]
  const known = knownEntities(facts)

  it('groups by entity in the order the entities first appear, General last', () => {
    expect(groupByEntity(facts, known).map((g) => g.entity)).toEqual(['Fenwick', 'Acme', GENERAL])
  })

  it('puts a claim-matched fact under the same heading as its tagged sibling', () => {
    const fenwick = groupByEntity(facts, known)[0]
    expect(fenwick.facts.map((f) => f.id)).toEqual(['f1', 'f4'])
  })

  it('keeps every fact, exactly once', () => {
    const grouped = groupByEntity(facts, known).flatMap((g) => g.facts.map((f) => f.id))
    expect(grouped.sort()).toEqual(['f1', 'f2', 'f3', 'f4'])
  })

  it('returns one General group when nothing names an entity — the caller’s cue to render flat', () => {
    const plain = [fact({ id: 'f1', claim: 'Wrote some Go' }), fact({ id: 'f2', claim: 'Three years backend' })]
    expect(groupByEntity(plain, knownEntities(plain))).toEqual([
      { entity: GENERAL, facts: plain },
    ])
  })

  it('omits General entirely when every fact has an entity', () => {
    const all = [facts[0], facts[2]]
    expect(groupByEntity(all, knownEntities(all)).map((g) => g.entity)).toEqual(['Fenwick', 'Acme'])
  })

  it('still honours a tag when it is given no claim-matched names at all', () => {
    // The known list only ever governs the claim fallback. A tag is the deliberate statement
    // and needs no corroboration — which is why a section that must NOT sub-group is a decision
    // the caller makes by not calling this, rather than by passing an empty list.
    expect(groupByEntity(facts, []).map((g) => g.entity)).toEqual(['Fenwick', 'Acme', GENERAL])
    expect(groupByEntity(facts, [])[0].facts.map((f) => f.id)).toEqual(['f1'])
  })
})
