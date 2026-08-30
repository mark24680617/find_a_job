import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ClarifyCards, OTHER, seedCard, toClarifyAnswer } from '@/components/review/ClarifyCards'
import type { ClarifyQuestion } from '@/lib/types'

/**
 * Fix 5: the write-your-own override is available on EVERY positioning card, whatever the model
 * set for `allowOther`. These pin the pure round-trip the DOM only renders — seedCard → CardState
 * → toClarifyAnswer → ClarifyAnswer — with `allowOther: false` throughout, the case that used to
 * throw the free text away.
 */

const single = (over: Partial<ClarifyQuestion> = {}): ClarifyQuestion => ({
  id: 'c1',
  question: 'Which experience should lead?',
  why: '',
  options: [
    { label: 'The payments service', value: 'payments' },
    { label: 'The Kafka migration', value: 'kafka' },
  ],
  recommended: 'payments',
  allowMultiple: false,
  allowOther: false,
  ...over,
})

const multi = (over: Partial<ClarifyQuestion> = {}): ClarifyQuestion =>
  single({ id: 'm1', allowMultiple: true, recommended: 'payments', ...over })

describe('toClarifyAnswer — own answer regardless of allowOther', () => {
  it('single-choice: OTHER + free text becomes the free text alone, even when allowOther is false', () => {
    const q = single({ allowOther: false })
    const answer = toClarifyAnswer(q, { values: [OTHER], other: '  a payments rebuild I led  ' })
    expect(answer).toEqual({ id: 'c1', question: q.question, answer: ['a payments rebuild I led'] })
  })

  it('single-choice: a blank own answer falls back to the recommendation, never dropping the card', () => {
    const q = single({ allowOther: false }) // recommended: 'payments'
    expect(toClarifyAnswer(q, { values: [OTHER], other: '   ' }).answer).toEqual(['payments'])
  })

  it('multi-choice: free text is appended as one more value, even when allowOther is false', () => {
    const q = multi({ allowOther: false })
    const answer = toClarifyAnswer(q, { values: ['payments'], other: 'and on-call ownership' })
    expect(answer.answer).toEqual(['payments', 'and on-call ownership'])
  })

  it('a chosen option round-trips unchanged', () => {
    const q = single({ allowOther: false })
    expect(toClarifyAnswer(q, { values: ['kafka'], other: '' }).answer).toEqual(['kafka'])
  })
})

describe('seedCard round-trip', () => {
  it('re-seeds a single-choice own answer back onto the OTHER sentinel (allowOther false)', () => {
    const q = single({ allowOther: false })
    const stored = toClarifyAnswer(q, { values: [OTHER], other: 'a payments rebuild I led' })
    expect(seedCard(q, stored)).toEqual({ values: [OTHER], other: 'a payments rebuild I led' })
  })

  it('re-seeds a multi-choice own answer as free text beside the real values (allowOther false)', () => {
    const q = multi({ allowOther: false })
    const stored = toClarifyAnswer(q, { values: ['payments'], other: 'and on-call ownership' })
    expect(seedCard(q, stored)).toEqual({ values: ['payments'], other: 'and on-call ownership' })
  })

  it('pre-selects the recommendation when there is no stored answer', () => {
    expect(seedCard(single())).toEqual({ values: ['payments'], other: '' })
  })
})

describe('ClarifyCards render (Fix 5 regression)', () => {
  it('renders the own-answer option on a single-choice card even when allowOther is false', () => {
    const q = single({ allowOther: false })
    const html = renderToStaticMarkup(
      createElement(ClarifyCards, {
        questions: [q],
        selections: { c1: seedCard(q) },
        onChange: () => {},
        busy: false,
      }),
    )
    expect(html).toContain('In my own words')
  })
})
