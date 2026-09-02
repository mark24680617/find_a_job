import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Application, Question } from '@/lib/types'

// The same intake serves two jobs on a form that already has questions: re-parse it, which
// replaces the list and takes every draft with it, or add to it, which does not. They differ
// only in what the box says and which button it offers, so what a static render can check is
// exactly what matters — that append mode never shows the replace warning, and that replace
// mode still does. `apiFetch` is faked only because importing it initialises the Firebase
// client, which has no business in a render test.
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { QuestionsIntake } from '@/components/wizard/QuestionsIntake'

const answered: Question[] = [
  {
    q: 'Self-introduction',
    constraints: { type: 'long-text', required: true, limit: 150, unit: 'words' },
    draft: { text: 'I built a payments platform.', citations: [] },
    askHuman: [],
    final: 'I built a payments platform, end to end.',
    status: 'final',
  },
]

const application = (questions: Question[]): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Build a ledger.',
  adapter: 'ashby',
  questions,
  status: 'draft',
  timeline: [],
  createdAt: '2026-08-27T00:00:00.000Z',
})

const html = (questions: Question[], append?: boolean) =>
  renderToStaticMarkup(
    createElement(QuestionsIntake, {
      app: application(questions),
      onParsed: () => {},
      onCancel: () => {},
      append,
    }),
  )

describe('QuestionsIntake — append mode', () => {
  it('adds to the list instead of threatening it', () => {
    const markup = html(answered, true)
    expect(markup).toContain('Add questions')
    expect(markup).toContain('Add the questions')
    expect(markup).toContain('Cancel')
    // The one thing append mode must never say on a form that has drafts in it.
    expect(markup).not.toContain('Re-parsing replaces')
    expect(markup).not.toContain('Replace 1 question')
  })

  it('says where the new questions land and what they leave alone', () => {
    expect(html(answered, true)).toContain('nothing already drafted is touched')
  })

  it('leaves re-parse exactly as it was on the same form', () => {
    const markup = html(answered)
    expect(markup).toContain('Re-parse the form')
    expect(markup).toContain('Re-parsing replaces')
    expect(markup).toContain('Replace 1 question')
    expect(markup).not.toContain('Add the questions')
  })

  it('is the first-parse intake when there is nothing to replace', () => {
    const markup = html([])
    expect(markup).toContain('The form’s questions')
    expect(markup).toContain('Read the questions')
    expect(markup).not.toContain('Re-parsing replaces')
  })
})
