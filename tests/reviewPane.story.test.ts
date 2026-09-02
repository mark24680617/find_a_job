import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Application, Question } from '@/lib/types'

// The story affordance as it is first seen, in each of the three states this pane can be in.
// A static render is the whole of what matters here: whether the invitation is on screen at
// all, whether it opens itself when there is already a telling to read, and whether the box
// is seeded with that telling rather than blank. `apiFetch` is faked only because importing
// it initialises the Firebase client, which has no business in a render test.
//
// The same box does two jobs, switched on whether there is a draft yet. Before one it is the
// optional telling that would make a thin draft real; after one it IS the adjustment — the
// only way to say what is wrong with the answer on screen — so it stops being optional and
// gets the primary button.
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

const STORY = 'The billing job double-charged 40 accounts. I wrote the idempotency key that Sunday.'

const drafted = (over: Partial<Question> = {}) =>
  question({
    draft: { text: 'I own a payments service.', citations: [] },
    status: 'drafted',
    ...over,
  })

describe('ReviewPane — the story affordance', () => {
  it('offers the invitation, collapsed and marked optional, before there is any draft', () => {
    const markup = html(question())
    expect(markup).toContain('Tell the story behind this answer')
    expect(markup).toContain('Optional')
    // Collapsed means collapsed: no box, no placeholder, nothing to answer yet.
    expect(markup).not.toContain('Rough is fine')
  })

  it('becomes the primary Adjust button once there is a draft to be wrong', () => {
    const markup = html(drafted())
    expect(markup).toContain('class="btn btn-primary">Adjust<')
    // The quiet invitation has done its job; the same box is now reached by the loud action.
    expect(markup).not.toContain('Tell the story behind this answer')
  })

  it('opens as the adjust box on a drafted question that already carries a telling', () => {
    const markup = html(drafted({ story: STORY }))
    expect(markup).toContain('Adjust this answer')
    expect(markup).toContain('Re-draft with this')
    expect(markup).toContain(STORY)
    // The action has moved into the box, so the button that opens it is gone…
    expect(markup).not.toContain('>Adjust<')
    // …and adjusting a draft is not an optional extra the way telling a story first was.
    expect(markup).not.toContain('Optional')
  })

  it('offers one way back into the positioning: the questions already answered', () => {
    // `Ask different questions` — the fresh round that discards those answers — lives inside
    // the reopened setup panel, which a static render has no way to open.
    const markup = html(
      drafted({
        clarify: [
          {
            id: 'c1',
            question: 'Which angle should this lead with?',
            why: 'Two of your roles fit.',
            options: [
              { label: 'Payments', value: 'payments' },
              { label: 'Ledgers', value: 'ledgers' },
            ],
            recommended: 'payments',
            allowMultiple: false,
            allowOther: false,
          },
        ],
        clarifyAnswers: [{ id: 'c1', question: 'Which angle should this lead with?', answer: ['payments'] }],
      }),
    )
    expect(markup).toContain('Ask me again')
    // The old text link next to it is gone: the only `Adjust` left is the primary button.
    expect(markup.split('>Adjust<')).toHaveLength(2)
    expect(markup).toContain('class="btn btn-primary">Adjust<')
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
//
// Nor is the adjust box's Cancel, which closes the box and puts `story` back to the stored
// telling so the unsaved-work guard stops firing for text that was just discarded. Both halves
// of that are a click handler, and there is no DOM here to click in.
