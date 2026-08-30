import { describe, it, expect } from 'vitest'
import { buildReconcileFactsPrompt } from '@/ai/prompts/reconcileFacts'
import type { Fact, FactAdd } from '@/lib/types'

// The system text is the whole contract of the reconcile step: it is the only place the model is
// told to merge rather than append, to ask rather than guess, and never to shrink a stored claim.
// A well-meaning paraphrase of any of those is a regression, so a copy lives here and the build
// fails if the two drift apart.
const VERBATIM = `You reconcile one fresh extraction against a profile that already exists.

You are given the facts the profile already holds, each with an id, and the facts just extracted from a new document. Work out the smallest honest change to the profile. This is a person's record of their own career: a change you cannot justify is worse than no change.

Account for every extracted fact exactly once, as one of:
- adds — it says something the profile does not hold. Carry its claim and its verbatim sourceSnippet across unchanged.
- updates — it is the same claim as a stored fact, told better: a number the stored one lacks, a date, a scope, a correction. Name the stored fact's id and write the merged claim. The merged claim must keep everything the stored one established and add what is new. Never update a fact into saying less than it said.
- skips — the profile already holds it. Name the id it duplicates, and give one line saying why.

A stored fact belongs to at most one of updates and skips. If you are revising it, that is the whole account of it; do not also skip it.

Nothing may be dropped in silence. If you cannot tell whether an extracted fact is the same claim as a stored one, or which stored fact it revises, do not guess — ask.

questions: at most 4, and only for matches you genuinely cannot settle. Fewer is better; none is normal. Each is a short question, a one-line why it changes the outcome, 2 to 4 concrete options quoting the actual claims in play, and a recommended option — what you would do if the candidate never answered. Number them c1, c2, c3 … in order. An answer you have already been given is settled: apply it and do not ask it again.

tags: 2-4 lowercase topic tags. Where a fact clearly belongs to one named company, school or project, include one further tag "entity:<Name>", the name written as the document writes it — "entity:Fenwick". Only where the documents say so: do not file a fact under a company because it is the only one mentioned. An update is the place to give a stored fact an entity tag it is missing.

When the candidate has said what is wrong with your previous changeset, their words settle it. Redo it their way, even where you would have judged otherwise.

Never write a claim the documents do not support. Do not improve the candidate's story — reconcile it.`

const facts: Fact[] = [
  {
    id: 'f1',
    claim: 'Owns the payments service at Fenwick',
    sourceSnippet: 'Owns payments',
    tags: ['backend', 'entity:Fenwick'],
  },
  { id: 'f2', claim: 'Led a migration to Kafka', sourceSnippet: 'Led migration', tags: ['infra'] },
]

const extracted: FactAdd[] = [
  {
    claim: 'Owns the payments service at Fenwick, handling 12,000 requests/day',
    sourceSnippet: '12,000 requests/day through payments',
    tags: ['backend'],
  },
  { claim: 'Mentors two junior engineers', sourceSnippet: 'mentors two juniors', tags: ['leadership'] },
]

const build = (over: Partial<Parameters<typeof buildReconcileFactsPrompt>[0]> = {}) =>
  buildReconcileFactsPrompt({ facts, extracted, ...over })

const text = (over?: Partial<Parameters<typeof buildReconcileFactsPrompt>[0]>) =>
  build(over)
    .parts.map((p) => ('text' in p ? p.text : ''))
    .join('\n\n')

describe('buildReconcileFactsPrompt system text', () => {
  it('carries the reconcile contract verbatim', () => {
    expect(build().system).toBe(VERBATIM)
  })

  it('is the same text whatever the input is', () => {
    expect(build({ facts: [], guidance: 'you merged too much' }).system).toBe(build().system)
  })

  it('names all three halves of the changeset and forbids a silent drop', () => {
    const system = build().system
    expect(system).toContain('- adds —')
    expect(system).toContain('- updates —')
    expect(system).toContain('- skips —')
    expect(system).toContain('Account for every extracted fact exactly once')
    expect(system).toContain('Nothing may be dropped in silence')
  })

  it('turns an unsettleable match into a question rather than a guess', () => {
    expect(build().system).toContain('do not guess — ask')
    expect(build().system).toContain('at most 4')
  })

  it('states the c1..cN numbering the schema enforces', () => {
    // Belt and braces with ClarifyQuestionSchema's regex, and the flow keys the cards by it.
    expect(build().system).toMatch(/Number them c1, c2, c3/)
  })

  it('forbids an update that shrinks the stored claim', () => {
    expect(build().system).toContain('Never update a fact into saying less than it said.')
  })

  it('asks for an entity tag, and says an update is where a missing one is added', () => {
    const system = build().system
    expect(system).toContain('"entity:<Name>"')
    expect(system).toContain('entity:Fenwick')
    expect(system).toContain('An update is the place to give a stored fact an entity tag it is missing.')
  })

  it('gives the candidate’s own words precedence over its judgment', () => {
    expect(build().system).toContain('their words settle it')
  })
})

describe('buildReconcileFactsPrompt parts', () => {
  it('shows the stored bank with its ids and its tags', () => {
    const body = text()
    expect(body).toContain('f1: Owns the payments service at Fenwick [tags: backend, entity:Fenwick]')
    expect(body).toContain('f2: Led a migration to Kafka [tags: infra]')
  })

  it('says "(none)" for an empty bank rather than sending a bare header', () => {
    expect(text({ facts: [] })).toContain('Facts the profile already holds:\n(none)')
  })

  it('numbers the extraction 1..N and never f1..fN', () => {
    // The extractor numbers its own output from f1 every run, so an f-id here would name a
    // different fact than the bank's f1 — and an update built on it would hit the wrong row.
    const body = text()
    expect(body).toContain('1. Owns the payments service at Fenwick, handling 12,000 requests/day')
    expect(body).toContain('2. Mentors two junior engineers')
    const extractedBlock = body.slice(body.indexOf('Facts just extracted'))
    expect(extractedBlock).not.toMatch(/\bf\d+:/)
  })

  it('tells the model which ids are real', () => {
    expect(text()).toContain('every id in updates and')
    expect(text()).toContain('skips must name a stored fact above')
  })

  it('carries each extracted fact’s source snippet', () => {
    expect(text()).toContain('source: 12,000 requests/day through payments')
  })

  it('sends no answers section when nothing has been settled', () => {
    expect(text()).not.toContain('The candidate has settled these')
    // An unanswered card is still open — feeding it back would settle it on their behalf.
    expect(
      text({ answers: [{ id: 'c1', question: 'Same job?', answer: ['', '  '] }] }),
    ).not.toContain('The candidate has settled these')
  })

  it('carries a settled answer back so it is not asked twice', () => {
    const body = text({
      answers: [{ id: 'c1', question: 'Is that the same payments service?', answer: ['yes'] }],
    })
    expect(body).toContain('The candidate has settled these — apply them and do not ask again')
    expect(body).toContain('Q: Is that the same payments service?')
    expect(body).toContain('Answered: yes')
  })

  it('sends no guidance section when there is none, and puts it last when there is', () => {
    expect(text()).not.toContain('their words take precedence')
    const parts = build({ guidance: '  ' }).parts
    expect(parts).toHaveLength(2)

    const refined = build({ guidance: 'f2 is a different migration, leave it alone' })
    const last = refined.parts.at(-1)
    expect(last).toMatchObject({
      text: expect.stringContaining('f2 is a different migration, leave it alone'),
    })
    expect(last).toMatchObject({ text: expect.stringContaining('their words take precedence') })
  })

  it('refuses to build a prompt with nothing to reconcile', () => {
    // A changeset produced from the bank alone is one invented out of nothing.
    expect(() => build({ extracted: [] })).toThrow(/extracted/i)
  })
})
