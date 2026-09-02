import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Application, Question } from '@/lib/types'

// A question the form does not actually ask has to be removable, and removing one takes its
// draft and the answer written under it. So the affordance is offered in every state — a
// wrongly parsed question is usually spotted before anything is written on it — and it is
// dressed as what it is: danger, the colour reserved here for destruction. `apiFetch` is faked
// only because importing it initialises the Firebase client.
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { ReviewPane } from '@/components/review/ReviewPane'

const question = (over: Partial<Question> = {}): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
  ...over,
})

const application = (q: Question): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Build a ledger.',
  adapter: 'ashby',
  questions: [q],
  status: 'draft',
  timeline: [],
  createdAt: '2026-08-27T00:00:00.000Z',
})

const html = (q: Question) =>
  renderToStaticMarkup(
    createElement(ReviewPane, {
      app: application(q),
      index: 0,
      factsById: new Map(),
      onQuestionChange: () => {},
      onAppChange: () => {},
      onFactsChanged: () => {},
      onDirtyChange: () => {},
      onDelete: () => Promise.resolve(),
    }),
  )

const drafted = question({
  draft: { text: 'I own a payments service.', citations: [] },
  status: 'drafted',
})

describe('ReviewPane — deleting the question', () => {
  it('offers it against the question, in red, before anything is drafted', () => {
    const markup = html(question())
    expect(markup).toContain('Delete question')
    expect(markup).toContain('btn-danger')
  })

  it('still offers it once there is a draft to lose', () => {
    const markup = html(drafted)
    expect(markup).toContain('Delete question')
    expect(markup).toContain('btn-danger')
  })
})

// Not covered here: the confirm, the `Deleting…` state and the failure line. All three need a
// click and a rejected promise, and this suite has no DOM to dispatch one in. The sentence the
// confirm asks with is the contract that matters, and it is a literal in the component.
