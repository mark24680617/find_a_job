import { describe, it, expect } from 'vitest'
import { BULLET_NOULS, BULLET_NOUL_IDS, bulletNouls, skillNoul } from '@/ai/nouls'
import { buildBulletState, entryLine } from '@/ai/prompts/nouls'

// The four questions, verbatim — copied from Task A4's committed scripts/jev-probe.ts, the text
// the cut points were measured against (amended 2026-09-24, R5). The denominator in every count
// on the page is this set's length, so adding a fifth is a change to this file and to this test,
// which is what makes it doctrine rather than a number an implementer picked.
//
// Two phrasing rules are asserted rather than trusted, and both come out of measurement:
// JEV answered the literal `instructions` over contradicting `criteria` 20 times out of 20, and
// a pure self-claim scored 0.95 until the criteria said "not merely self-description", which
// dropped it to 0.49.

const VERBATIM: Record<string, { instructions: string; criteria: { true: string; false: string } }> = {
  result: {
    instructions:
      'The line states a measurable result — a number, a quantity, a duration, a rate or a named outcome that was achieved — and not merely a self-description of the candidate.',
    criteria: {
      true: 'The line states a measurable result — a number, a quantity, a duration, a rate or a named outcome that was achieved — and not merely a self-description of the candidate.',
      false:
        'The line states no measurable result. It describes duties or responsibilities, or it is merely a self-description of the candidate.',
    },
  },
  action: {
    instructions:
      'The line states a specific action the candidate took — a thing they did, named as a verb with its object — and not merely a self-description of the candidate.',
    criteria: {
      true: 'The line states a specific action the candidate took — a thing they did, named as a verb with its object — and not merely a self-description of the candidate.',
      false:
        'The line names no specific action the candidate took. It lists a role, a tool or a responsibility, or it is merely a self-description of the candidate.',
    },
  },
  scale: {
    instructions:
      'The line states the scope or scale the work happened at — how many, how large, how often, how long, or for whom — and not merely a self-description of the candidate.',
    criteria: {
      true: 'The line states the scope or scale the work happened at — how many, how large, how often, how long, or for whom — and not merely a self-description of the candidate.',
      false:
        'The line states no scope or scale. It could describe work of any size, or it is merely a self-description of the candidate.',
    },
  },
  'self-description': {
    instructions:
      'The line is more than a self-description of the candidate — it reports something they did or achieved, not only a claim about what kind of worker they are.',
    criteria: {
      true: 'The line is more than a self-description of the candidate — it reports something they did or achieved, not only a claim about what kind of worker they are.',
      false:
        'The line is a self-description of the candidate and nothing more — a claim about what kind of worker they are, with nothing they did or achieved attached.',
    },
  },
}

describe('BULLET_NOULS', () => {
  it('is exactly four questions, in the order the denominator counts them', () => {
    expect(BULLET_NOUL_IDS).toEqual(['result', 'action', 'scale', 'self-description'])
    expect(Object.keys(BULLET_NOULS)).toEqual([...BULLET_NOUL_IDS])
    expect(bulletNouls()).toStrictEqual(BULLET_NOULS)
    const copy = bulletNouls()
    copy.result.criteria.true = 'x'
    expect(BULLET_NOULS.result.criteria.true).not.toBe('x')
  })

  it('carries the four questions verbatim', () => {
    expect(BULLET_NOULS).toStrictEqual(VERBATIM)
  })

  it('says the same thing in instructions and in criteria.true, for every question', () => {
    for (const id of BULLET_NOUL_IDS) {
      expect(BULLET_NOULS[id].criteria.true).toBe(BULLET_NOULS[id].instructions)
    }
  })

  it('carries an explicit clause against self-description on every criterion', () => {
    for (const id of BULLET_NOUL_IDS) {
      expect(BULLET_NOULS[id].criteria.true.toLowerCase()).toMatch(/self-description/)
      expect(BULLET_NOULS[id].criteria.false.toLowerCase()).toMatch(/self-description/)
    }
  })

  it('phrases every question so that true is the good answer', () => {
    // toVerdict maps a high noul to pass; a question whose true was the failure would make the
    // same denominator mean two different things on one row.
    for (const id of BULLET_NOUL_IDS) {
      expect(BULLET_NOULS[id].criteria.false.toLowerCase()).toMatch(/^the line (states no|names no|is a self-description)/)
    }
  })
})

describe('skillNoul', () => {
  it('asks for hands-on evidence, with the negative clause and the skill named on both branches', () => {
    const noul = skillNoul('PostgreSQL')
    expect(noul.criteria.true).toBe(noul.instructions)
    expect(noul.instructions).toMatch(/PostgreSQL/)
    expect(noul.criteria.false).toMatch(/PostgreSQL/)
    expect(noul.instructions.toLowerCase()).toMatch(/not merely listed/)
    expect(noul.instructions.toLowerCase()).toMatch(/self-description/)
    expect(noul.criteria.false.toLowerCase()).toMatch(/self-description/)
    expect(noul.criteria.false.toLowerCase()).toMatch(/does not evidence/)
  })
})

describe('buildBulletState', () => {
  it('is the bullet and its entry’s role and company line, and nothing more', () => {
    expect(entryLine({ role: 'Backend Engineer', org: 'Marram Systems' })).toBe('Backend Engineer, Marram Systems')
    const state = buildBulletState('Cut reconciliation from 4 hours to 18 minutes.', 'Backend Engineer, Marram Systems')
    expect(state).toBe(
      'Role: Backend Engineer, Marram Systems\nLine from the resume: Cut reconciliation from 4 hours to 18 minutes.',
    )
  })

  it('drops the role line rather than sending an empty one', () => {
    expect(buildBulletState('Shipped the ledger.', '')).toBe('Line from the resume: Shipped the ledger.')
    expect(entryLine({ role: '', org: '' })).toBe('')
  })
})
