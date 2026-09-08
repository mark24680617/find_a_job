import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { newCoverLetter } from '@/lib/letter/letterhead'
import type { Question } from '@/lib/types'
import { QuestionList } from '@/components/review/QuestionList'

// The list's footer is where a question is added, and now where the letter is written. The
// button is passed only while there is no letter yet — one per application, decided by the page
// — so what a static render can say is exactly what matters: that it sits after `Add a question`
// when it is offered, that it is simply absent when it is not, and that the letter's own row
// draws like every other row without a chip it has no limit to put in.

const question = (over: Partial<Question> = {}): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
  ...over,
})

const html = (questions: Question[], onWriteLetter?: () => void) =>
  renderToStaticMarkup(
    createElement(QuestionList, {
      questions,
      selected: 0,
      onSelect: () => {},
      onAddQuestion: () => {},
      onWriteLetter,
    }),
  )

describe('QuestionList — writing a cover letter', () => {
  it('offers it in the footer after Add a question', () => {
    const markup = html([question()], () => {})
    expect(markup).toContain('Write a cover letter')
    expect(markup.indexOf('Add a question')).toBeLessThan(markup.indexOf('Write a cover letter'))
    expect(markup).toContain('flex flex-wrap items-center gap-x-4 gap-y-1')
    expect(markup).toContain('<button type="button" class="btn-link text-sm">Write a cover letter</button>')
  })

  it('is absent once the application already has one', () => {
    const markup = html([question(), newCoverLetter('Tom Candidate', 'tom@example.test')])
    expect(markup).toContain('Add a question')
    expect(markup).not.toContain('Write a cover letter')
  })

  it('draws the letter as a row with no chip', () => {
    const markup = html([newCoverLetter('Tom Candidate', 'tom@example.test')])
    expect(markup).toContain('Cover letter')
    expect(markup).not.toContain('chip')
  })
})
