import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Application, Question } from '@/lib/types'

// The story affordance as it is first seen, in each of the three states this pane can be in.
// A static render is the whole of what matters here: whether the invitation is on screen at
// all, whether it opens itself when there is already a telling to read, and whether the box
// is seeded with that telling rather than blank. `apiFetch` is faked only because importing
// it initialises the Firebase client, which has no business in a render test.
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
    }),
  )

const STORY = 'The billing job double-charged 40 accounts. I wrote the idempotency key that Sunday.'

describe('ReviewPane — the story affordance', () => {
  it('offers the invitation, collapsed and marked optional, before there is any draft', () => {
    const markup = html(question())
    expect(markup).toContain('Tell the story behind this answer')
    expect(markup).toContain('Optional')
    // Collapsed means collapsed: no box, no placeholder, nothing to answer yet.
    expect(markup).not.toContain('Rough is fine')
  })

  it('still offers it once there is a draft — the story is what a thin draft is missing', () => {
    const drafted = question({
      draft: { text: 'I own a payments service.', citations: [] },
      status: 'drafted',
    })
    expect(html(drafted)).toContain('Tell the story behind this answer')
  })

  it('opens itself, seeded with the telling, when the question already carries one', () => {
    const markup = html(question({ story: STORY }))
    expect(markup).toContain(STORY)
    expect(markup).toContain('Rough is fine')
    // Already open, so the invitation to open it is not also on screen.
    expect(markup).not.toContain('Tell the story behind this answer')
  })

  it('stays collapsed when the stored telling is only whitespace', () => {
    const markup = html(question({ story: '   \n ' }))
    expect(markup).toContain('Tell the story behind this answer')
    expect(markup).not.toContain('Rough is fine')
  })

  it('dresses the open box in amber — only you know this', () => {
    // Amber means exactly one thing in this product, and this is that thing.
    expect(html(question({ story: STORY }))).toContain('border-amber')
  })

  it('says what telling it does: this draft, and the profile after it', () => {
    const markup = html(question({ story: STORY }))
    expect(markup).toContain('what happened')
    expect(markup).toContain('into your profile')
  })
})

// Not covered here: the unsaved-work signal for a typed-but-undrafted story. It is emitted
// from an effect, which renderToStaticMarkup never runs, and there is no DOM environment in
// this suite to run it in. The predicate itself is `story !== (question.story ?? '')` — a
// comparison with no logic in it to get wrong, unlike ClarifyCards' seed/round-trip helpers,
// which is why those are exported and this is not.
