import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Application, Question } from '@/lib/types'

// The answer is written to be pasted somewhere else, so getting it out of the box has to be one
// click rather than a select-all. It copies what is on screen, not what was saved — which is why
// it sits beside Save final rather than replacing it — and it has nothing to copy on an empty
// box. `apiFetch` is faked only because importing it initialises the Firebase client.
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

// Only the answer section — the pane has other quiet buttons above it, and the claim being made
// here is about where this one sits.
const finalSection = (q: Question) => {
  const markup = renderToStaticMarkup(
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
  return markup.slice(markup.indexOf('id="final-heading"'))
}

describe('ReviewPane — copying the answer', () => {
  it('offers it beside Save final once the box is seeded from a draft', () => {
    const markup = finalSection(
      question({ draft: { text: 'I own a payments service.', citations: [] }, status: 'drafted' }),
    )
    expect(markup).toContain('<button type="button" class="btn btn-quiet">Copy</button>')
    expect(markup.indexOf('Save final')).toBeLessThan(markup.indexOf('>Copy<'))
  })

  it('is disabled when there is neither a draft nor a final to copy', () => {
    const markup = finalSection(question())
    expect(markup).toContain('<button type="button" class="btn btn-quiet" disabled="">Copy</button>')
  })
})

// Not covered here: "Copied" for two seconds and the failure line. Both need a click and a
// clipboard, and this suite has no DOM to dispatch one in — faking a window to assert on a
// two-line handler would test the fake.
