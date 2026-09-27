import type { Noul } from '@/ai/jev'

/**
 * The questions the judge is asked, as data.
 *
 * Exactly four per bullet in v1, fixed rather than a range: the denominator in every displayed
 * count is this set's length, so it is doctrine and not a number an implementer picks. Adding a
 * fifth is a change here and in tests/prompts.jevNouls.test.ts, like any other doctrine change.
 *
 * Two phrasing rules, both load-bearing and both measured (spec §6.1):
 *   - `instructions` and `criteria.true` say the same thing. JEV answered the literal instruction
 *     and ignored contradicting criteria 20 times out of 20, while returning a perfectly valid
 *     number — so a disagreement between the two is a silent wrong answer, not a visible one.
 *   - every criterion carries an explicit clause against self-description. A pure self-claim
 *     scored 0.95 until the criteria said "not merely self-description", which dropped it to 0.49.
 *
 * The fourth question's sense is inverted from §6.1's shorthand on purpose: `toVerdict` maps a
 * high noul to `pass`, so a question whose true answer was the failure would make one row's
 * denominator mean the opposite of its neighbours'. The clause the spec asks for is in
 * `criteria.false`, which is where a negative belongs.
 */

export const BULLET_NOUL_IDS = ['result', 'action', 'scale', 'self-description'] as const
export type BulletNoulId = (typeof BULLET_NOUL_IDS)[number]

export const BULLET_NOULS: Record<BulletNoulId, Noul> = {
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

/** The four, as the judge takes them. A function so no caller can mutate the shared object. */
export function bulletNouls(): Record<BulletNoulId, Noul> {
  return structuredClone(BULLET_NOULS)
}

/**
 * One Noul per candidate skill, for spec §6.2's buckets. Stage D calls it; it lives here because
 * the questions this product asks a judge live in one file, and because the negative clause is
 * mandatory for the same measured reason as above.
 */
export function skillNoul(skill: string): Noul {
  const question = `The resume evidences hands-on use of ${skill} — the candidate did something with it, not merely listed it among their skills, and not merely a self-description of the candidate.`
  return {
    instructions: question,
    criteria: {
      true: question,
      false: `The resume does not evidence hands-on use of ${skill}. It is listed, implied or claimed as a skill, or it is absent, or the mention is merely a self-description of the candidate.`,
    },
  }
}
