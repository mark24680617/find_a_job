import { describe, it, expect } from 'vitest'
import { planQueries, planTakeHomeQueries } from '@/lib/research/planQueries'
import { roleFamily } from '@/lib/research/roleFamily'

// The queries are deterministic on purpose: the model decides what is relevant, not what to
// search for, so a run is reproducible and a search that turned up nothing can be re-read.

describe('roleFamily', () => {
  it('reads the family off the title', () => {
    expect(roleFamily('Senior Backend Engineer, Payments')).toBe('software engineering')
    expect(roleFamily('Software Developer II')).toBe('software engineering')
    expect(roleFamily('SDE 2')).toBe('software engineering')
    expect(roleFamily('Machine Learning Engineer')).toBe('data science / ML')
    expect(roleFamily('Data Scientist')).toBe('data science / ML')
    expect(roleFamily('Product Manager, Growth')).toBe('product')
    expect(roleFamily('Senior Product Designer')).toBe('design')
    expect(roleFamily('Account Director')).toBe('general')
  })
  it('lets ML win over engineer when both words are there', () => {
    expect(roleFamily('ML Engineer')).toBe('data science / ML')
  })
})

describe('planQueries', () => {
  const qs = planQueries('Marram Systems', 'Senior Backend Engineer', 'software engineering', 2026)
  it('plans exactly five, with stable ids and intents', () => {
    expect(qs.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5'])
    expect(qs.map((q) => q.intent)).toEqual(['process', 'experience', 'questions', 'take-home', 'guide'])
  })
  it('quotes the company and the role so the search stays on this employer', () => {
    expect(qs[0].query).toBe('"Marram Systems" "Senior Backend Engineer" interview process')
    expect(qs[1].query).toBe('"Marram Systems" interview experience software engineering')
    expect(qs[2].query).toBe('"Marram Systems" interview questions software engineering')
    expect(qs[3].query).toBe('"Marram Systems" take home assignment interview')
  })
  it('keeps one query about the role family, dated, for when the company is thin', () => {
    expect(qs[4].query).toBe('software engineering interview loop guide 2026')
  })
  it('strips quotes inside a company name rather than breaking the phrase', () => {
    expect(planQueries('Say "Hi" Inc', 'PM', 'product', 2026)[0].query).toBe('"Say Hi Inc" "PM" interview process')
  })
})

describe('planTakeHomeQueries', () => {
  const qs = planTakeHomeQueries('Marram Systems', 'software engineering', 2026)
  it('plans exactly four, with stable ids and intents', () => {
    expect(qs.map((q) => q.id)).toEqual(['q1', 'q2', 'q3', 'q4'])
    expect(qs.map((q) => q.intent)).toEqual(['take-home', 'experience', 'feedback', 'guide'])
  })
  it('quotes the company so the search stays on this employer, not its product', () => {
    expect(qs[0].query).toBe('"Marram Systems" take home assignment software engineering')
    expect(qs[1].query).toBe('"Marram Systems" take-home interview experience')
    // "take home" is quoted too: unquoted it drifts onto working from home.
    expect(qs[2].query).toBe('"Marram Systems" "take home" feedback rejected')
  })
  it('keeps one query about the role family, dated, for a company nobody has written about', () => {
    expect(qs[3].query).toBe('software engineering take home assignment what reviewers look for 2026')
  })
  it('strips quotes inside a company name rather than breaking the phrase', () => {
    expect(planTakeHomeQueries('Say "Hi" Inc', 'product', 2026)[0].query)
      .toBe('"Say Hi Inc" take home assignment product')
  })
})
