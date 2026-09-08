import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { newCoverLetter } from '@/lib/letter/letterhead'
import type { Application, Question } from '@/lib/types'

// The same pane serves the letter, with a dozen strings branched on the kind and the letterhead
// above the draft. A static render is what those claims need: a letter is a question, so the
// proof that it is served like one is that the machinery around it is untouched and only the
// words change. `apiFetch` is faked only because importing it initialises the Firebase client.
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { ReviewPane } from '@/components/review/ReviewPane'

const letterQuestion = (over: Partial<Question> = {}): Question => ({
  ...newCoverLetter('Tom Candidate', 'tom@example.test'),
  ...over,
})

const formQuestion = (): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
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

describe('ReviewPane — a cover letter', () => {
  it('names the role and the company instead of repeating the question', () => {
    const markup = html(letterQuestion())
    expect(markup).toContain('>Cover letter</p>')
    expect(markup).toContain('For the Senior Backend Engineer role at Marram Systems')
    expect(markup).toContain('One page — 200 to 320 words')
    expect(markup).toContain('>Optional</span>')
    expect(markup).not.toContain('No stated limit')
    expect(markup).toContain('Delete cover letter')
  })

  it('says what setting one up will ask for', () => {
    expect(html(letterQuestion())).toContain(
      'No draft yet. Setting up asks which experience should lead and whether to name a gap — then the letter is drafted, every claim cited to a fact, and it asks you for what only you can say: why this company, and the story behind your lead example. Or draft straight from your profile.',
    )
  })

  it('carries the letterhead above the draft, previewed as it prints', () => {
    const markup = html(letterQuestion())
    expect(markup).toContain('<legend class="sr-only">Letterhead</legend>')
    expect(markup).toContain('<p class="font-display text-ink">Tom Candidate</p>')
    expect(markup).toContain('tom@example.test')
    // The recipient block is never empty: the company is always known.
    expect(markup).toContain('Marram Systems')
    expect(markup).toContain('Save letterhead')
  })

  it('invites the story in the same words the box uses', () => {
    const markup = html(letterQuestion())
    expect(markup).toContain('Tell the story behind this letter')
    expect(markup).not.toContain('Tell the story behind this answer')
  })

  it('calls the box the letter, and counts words against no stated limit', () => {
    const markup = html(letterQuestion())
    expect(markup).toContain('Your letter')
    expect(markup).toContain(
      'This is the letter itself, from the salutation to your name. Edit it freely — nothing here is sent anywhere until you save it. The letterhead above goes on the PDF.',
    )
    expect(markup).toContain('Save letter')
    expect(markup).toContain('>0 words</p>')
    expect(markup).not.toContain('0/')
  })

  it('offers the export only once there is a saved letter to export', () => {
    const markup = html(letterQuestion())
    expect(markup).toContain('<button type="button" class="btn btn-quiet" disabled="">Download PDF</button>')
    expect(markup).toContain('Save the letter to export it.')
  })

  it('exports the saved letter without a word about saving it first', () => {
    const markup = html(
      letterQuestion({ final: 'Dear Dana Wu,\n\nI built the ledger.\n\nSincerely,\n\nTom Candidate', status: 'final' }),
    )
    expect(markup).toContain('<button type="button" class="btn btn-quiet">Download PDF</button>')
    expect(markup).not.toContain('Save the letter to export it.')
  })

  it('calls a letter past the ceiling what it is', () => {
    const markup = html(letterQuestion({ final: `Dear Dana Wu, ${'word '.repeat(404)}`, status: 'final' }))
    expect(markup).toContain('>407 words</p>')
    expect(markup).toContain('class="tnum text-sm text-danger"')
    expect(markup).toContain('Over one page — cut it to 400 words or fewer.')
  })
})

describe('ReviewPane — a form question is untouched by any of it', () => {
  it('keeps its own words and grows no letterhead', () => {
    const markup = html(formQuestion())
    expect(markup).toContain('>Question</p>')
    expect(markup).toContain('Describe a backend system you designed end to end.')
    expect(markup).toContain('Limit 100 words')
    expect(markup).toContain('Delete question')
    expect(markup).toContain('Your answer')
    expect(markup).toContain('Save final')
    expect(markup).not.toContain('Letterhead')
    expect(markup).not.toContain('Download PDF')
    expect(markup).not.toContain('Cover letter')
    expect(markup).toContain('Tell the story behind this answer')
  })
})
