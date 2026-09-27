import { describe, it, expect, vi } from 'vitest'
import type { Application, BulletJudgement, ParsedJob } from '@/lib/types'

vi.mock('@/lib/resume/onet', () => ({
  ONET_RELEASE: '30.0',
  ONET_ATTRIBUTION: 'O*NET attribution',
  ONET_SKILLS: {},
  ONET_ALIASES: { Postgres: 'PostgreSQL' },
}))

// Stage C owns the Noul's wording and pins it verbatim in tests/prompts.jevNouls.test.ts. What
// is under test here is the batching, so the question body is a stand-in.
vi.mock('@/ai/nouls', () => ({
  skillNoul: (skill: string) => ({
    instructions: `Does the resume evidence hands-on use of ${skill}?`,
    criteria: {
      true: `The resume evidences hands-on use of ${skill}, not merely listing it, and not merely self-description.`,
      false: `The resume does not evidence hands-on use of ${skill}.`,
    },
  }),
}))

import { bucketSkills, demandedSkills, skillQuestionBatches, tier0Terms } from '@/lib/resume/gaps'

// The generated data itself, for the one case that has to hold on the real release.
const { ONET_SKILLS: REAL_ONET_SKILLS } =
  await vi.importActual<typeof import('@/lib/resume/onet')>('@/lib/resume/onet')

const parsed = (over: Partial<ParsedJob> = {}): ParsedJob => ({
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['Owns the ledger write path'],
  gates: [
    { requirement: 'Five years of backend experience', met: 'yes', posture: 'silent', note: '' },
  ],
  themes: ['payments'],
  scope: 'per-application',
  advisory: '',
  ...over,
})

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'a posting',
  adapter: 'manual',
  parsed: parsed(),
  questions: [],
  status: 'applied',
  timeline: [{ event: 'created', at: '2026-09-01T09:00:00.000Z' }],
  createdAt: '2026-09-01T09:00:00.000Z',
  ...over,
})

describe('tier0Terms', () => {
  it('takes the already-parsed role facts and gate requirements, posting by posting', () => {
    expect(tier0Terms([application()])).toEqual({
      terms: ['Owns the ledger write path', 'Five years of backend experience'],
      postingsUsed: 1,
    })
  })

  it('counts a posting once, however many strings it contributed', () => {
    const second = application({
      id: 'app-2',
      parsed: parsed({ roleFacts: ['Runs the ledger on Apache Kafka', 'On call one week in six'] }),
    })
    const { terms, postingsUsed } = tier0Terms([application(), second])
    expect(postingsUsed).toBe(2)
    expect(terms).toHaveLength(5)
    expect(terms).toContain('Runs the ledger on Apache Kafka')
  })

  it('does not count a posting nobody interpreted — it is not a posting we have read', () => {
    expect(tier0Terms([application({ parsed: undefined })])).toEqual({ terms: [], postingsUsed: 0 })
  })

  it('does not count a posting whose parse carried nothing', () => {
    const blank = application({ parsed: parsed({ roleFacts: ['  '], gates: [] }) })
    expect(tier0Terms([blank])).toEqual({ terms: [], postingsUsed: 0 })
    expect(tier0Terms([])).toEqual({ terms: [], postingsUsed: 0 })
  })
})

describe('skillQuestionBatches', () => {
  const names = ['PostgreSQL', 'Kubernetes', 'Apache Kafka', 'Go', 'Terraform']

  it('splits into requests of at most the cap, dropping no skill to fit', () => {
    const batches = skillQuestionBatches(names, 2)
    expect(batches.map((b) => b.ids.length)).toEqual([2, 2, 1])
    expect(batches.flatMap((b) => b.ids.map((i) => i.name))).toEqual(names)
  })

  it('numbers the questions s1…sN across the whole run, not per batch', () => {
    const batches = skillQuestionBatches(names, 2)
    expect(batches.flatMap((b) => Object.keys(b.questions))).toEqual(['s1', 's2', 's3', 's4', 's5'])
    // Every question carries its own skill, and every id maps back to exactly one name.
    expect(batches[1].questions.s3.instructions).toContain('Apache Kafka')
    expect(batches[1].ids).toEqual([
      { id: 's3', name: 'Apache Kafka' },
      { id: 's4', name: 'Go' },
    ])
  })

  it('sends one request when the cap is at or above the skill count, and none for no skills', () => {
    expect(skillQuestionBatches(names, 40)).toHaveLength(1)
    expect(skillQuestionBatches([], 40)).toEqual([])
  })
})

describe('the three buckets', () => {
  // Four O*NET candidates, one user, one resume. Every string here is fictional.
  const candidates = [
    { name: 'PostgreSQL', inDemand: true },
    { name: 'Kubernetes', inDemand: true },
    { name: 'Apache Kafka', inDemand: false },
    { name: 'COBOL', inDemand: false },
  ]
  const postingTerms = ['Runs the ledger on Apache Kafka', 'Five years of backend experience']
  const factClaims = ['Ran the Kubernetes migration for the billing cluster']
  const resumeText = 'Tuned Postgres queries down from 40 seconds to 2.'

  const judged = (verdict: BulletJudgement['verdict']): BulletJudgement => ({
    bulletId: '',
    questionId: 's1',
    noul: 0.91,
    verdict,
    model: 'jev-1.13.0',
    judge: 'jev',
  })

  // The route hands over the visible lines.
  const bucketed = (over: Partial<Parameters<typeof bucketSkills>[0]> = {}) =>
    bucketSkills({
      candidates,
      postingTerms,
      factClaims,
      judgements: { PostgreSQL: judged('pass'), Kubernetes: judged('fail'), 'Apache Kafka': judged('fail') },
      resumeLines: [resumeText],
      ...over,
    })
  const none = { posting: null, resume: null, bank: null }

  it('buckets each demanded skill and drops the ones nobody asked for', () => {
    // R37: every row says whether a posting asked for it and whether the resume names it, apart
    // from the bucket, because the page may only say "in the postings" when a posting did.
    expect(bucketed()).toEqual([
      // In Demand, named in the resume through its alias, and the judge says hands-on.
      {
        name: 'PostgreSQL', bucket: 1, inPostings: false, namedInResume: true, judgement: judged('pass'),
        evidence: { ...none, resume: resumeText },
      },
      // In Demand, in the fact bank, nowhere in the resume — shown as a candidate for a rewrite;
      // the user picks the bullet in Rewrite, and this row is not an input to it (R38).
      {
        name: 'Kubernetes', bucket: 2, inPostings: false, namedInResume: false, judgement: judged('fail'),
        evidence: { ...none, bank: factClaims[0] },
      },
      // Asked for by a posting the user saved, and nowhere else — `Have you done this?`
      {
        name: 'Apache Kafka', bucket: 3, inPostings: true, namedInResume: false, judgement: judged('fail'),
        evidence: { ...none, posting: postingTerms[0] },
      },
      // COBOL is neither In Demand nor in any posting: not a gap, somebody else's job.
    ])
  })

  it('keeps candidates in the order they arrived', () => {
    const reversed = bucketed({ candidates: [...candidates].reverse() })
    expect(reversed.map((s) => s.name)).toEqual(['Apache Kafka', 'Kubernetes', 'PostgreSQL'])
  })

  it('needs both halves for bucket 1: the name in the text and a judge that says hands-on', () => {
    // The judge passed it, but the word is not in the resume. Asserting it would be a claim
    // about a document that does not contain it.
    expect(bucketed({ resumeLines: ['Wrote the billing service.'] })[0]).toEqual({
      name: 'PostgreSQL',
      bucket: 3,
      inPostings: false,
      namedInResume: false,
      judgement: judged('pass'),
      evidence: none,
    })
    // In the text, but the judge read it as a listed skill rather than work done. The resume
    // names it, and the row says so (R37): bucket 3 is not "absent from the resume".
    const listed = bucketed({ judgements: { PostgreSQL: judged('fail') } })[0]
    expect(listed.bucket).toBe(3)
    expect(listed.namedInResume).toBe(true)
  })

  it('treats unjudged and unreached the same as not evidenced — never bucket 1', () => {
    expect(bucketed({ judgements: { PostgreSQL: judged('unjudged') } })[0].bucket).toBe(3)
    expect(bucketed({ judgements: {} })[0]).toEqual({
      name: 'PostgreSQL',
      bucket: 3,
      inPostings: false,
      namedInResume: true,
      judgement: null,
      evidence: { ...none, resume: resumeText },
    })
  })

  it('sends a skill the fact bank knows to bucket 2, whatever the resume shows', () => {
    expect(bucketed({ factClaims: ['Ran PostgreSQL upgrades'], judgements: {} })[0].bucket).toBe(2)
  })

  it('puts an unaliased spelling in bucket 3 rather than reading it as a match', () => {
    // "Postgress" is not in the alias table. The miss is the honest outcome: the product asks.
    expect(bucketed({ resumeLines: ['Tuned Postgress queries'], factClaims: [] })[0]).toEqual({
      name: 'PostgreSQL',
      bucket: 3,
      inPostings: false,
      namedInResume: false,
      judgement: judged('pass'),
      evidence: none,
    })
  })
})

// (F2, final review acceptance-6) The CLAUDE.md thesis: never state a fact about the user that
// cannot be cited. Each flag the page words as a statement about the user carries the text it
// matched, so a false match shows as one instead of reading as a fact.
describe('the evidence each flag cites', () => {
  const judgements = {}
  const run = (over: Partial<Parameters<typeof bucketSkills>[0]>) =>
    bucketSkills({
      candidates: [{ name: 'PostgreSQL', inDemand: true }],
      postingTerms: [],
      factClaims: [],
      resumeLines: [],
      judgements,
      ...over,
    })[0]

  it('records the posting term, the first resume line and the fact claim that matched', () => {
    const lines = [
      'Senior Backend Engineer, Marram Systems',
      'Tuned Postgres queries down from 40 seconds to 2.',
      'Wrote the PostgreSQL runbook.',
    ]
    const row = run({
      postingTerms: ['Five years of backend experience', 'Owns the PostgreSQL fleet'],
      factClaims: ['Led the billing rewrite', 'Ran PostgreSQL upgrades for the ledger'],
      resumeLines: lines,
    })
    expect(row.evidence).toEqual({
      posting: 'Owns the PostgreSQL fleet',
      resume: 'Tuned Postgres queries down from 40 seconds to 2.',
      bank: 'Ran PostgreSQL upgrades for the ledger',
    })
    expect(row.inPostings).toBe(true)
    expect(row.namedInResume).toBe(true)
  })

  it('is null wherever the flag is false', () => {
    expect(run({ resumeLines: ['Wrote the billing service.'] }).evidence)
      .toEqual({ posting: null, resume: null, bank: null })
  })

  it('a name split across two lines is not named', () => {
    // (amended 2026-09-26, F2 fix round) The flag is the quote: with no single visible line to
    // cite, the resume does not name it, and the row asks rather than states.
    const lines = ['Moved the ledger onto Apache', 'Kafka in 2025.']
    const kafka = [{ name: 'Apache Kafka', inDemand: true }]
    const pass: BulletJudgement = { bulletId: '', questionId: 's1', noul: 0.91, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' }
    const row = run({ candidates: kafka, resumeLines: lines, judgements: { 'Apache Kafka': pass } })
    expect(row).toMatchObject({ bucket: 3, namedInResume: false })
    expect(row.evidence.resume).toBeNull()
    const known = run({ candidates: kafka, resumeLines: lines, factClaims: ['Ran Apache Kafka for the ledger'] })
    expect(known).toMatchObject({ bucket: 2, namedInResume: false })
    expect(known.evidence.resume).toBeNull()
  })

  it('does not read go-to-market as Go, so there is nothing to cite', () => {
    const lines = ['Led the go-to-market plan for the ledger.']
    const row = run({
      candidates: [{ name: 'Go', inDemand: true }],
      postingTerms: ['Owns the go-live checklist'],
      factClaims: ['Briefed the C-suite on go-to-market'],
      resumeLines: lines,
    })
    expect(row).toMatchObject({ bucket: 3, inPostings: false, namedInResume: false })
    expect(row.evidence).toEqual({ posting: null, resume: null, bank: null })
  })
})

describe('demandedSkills', () => {
  // (F3, ledger-2, owner decision 2026-09-26) O*NET's In Demand flag, not its Hot Technology
  // flag: In Demand is what this occupation's own postings frequently ask for, Hot what all
  // employers' postings do — which put Adobe tools in front of a backend engineer.
  it('is in scope when a saved posting asks for it, or when O*NET marks it In Demand for the family', () => {
    expect(
      demandedSkills(
        [
          { name: 'Apache Kafka', inDemand: false },
          { name: 'COBOL', inDemand: false },
          { name: 'Kubernetes', inDemand: true },
        ],
        ['Runs the ledger on Apache Kafka'],
      ),
    ).toEqual([
      { name: 'Apache Kafka', inDemand: false },
      { name: 'Kubernetes', inDemand: true },
    ])
  })

  it('is empty when no posting asks for anything and nothing is In Demand', () => {
    expect(demandedSkills([{ name: 'COBOL', inDemand: false }], [])).toEqual([])
  })

  it('leaves out, for Software Developers, the cross-occupation tools no posting asked for', () => {
    // The real release data, not a fixture: Adobe Photoshop is a Hot Technology for the family
    // but not In Demand for it, so with no saved posting naming it, it is not a gap.
    const names = (terms: string[]) =>
      demandedSkills(REAL_ONET_SKILLS['15-1252.00'], terms).map((s) => s.name)
    expect(names([])).not.toContain('Adobe Photoshop')
    expect(names([])).toContain('PostgreSQL')
    expect(names(['Retouched images in Adobe Photoshop'])).toContain('Adobe Photoshop')
  })
})
