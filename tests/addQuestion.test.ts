import { describe, it, expect } from 'vitest'
import { newQuestion } from '@/components/review/AddQuestion'
import type { Question } from '@/lib/types'

/**
 * Fix 8: adding a question is append-only. `newQuestion` builds the blank row from the form's
 * fields; the page then PATCHes `[...current, newQ]`. These pin both — the defaults, and that the
 * append leaves every existing draft/final untouched (the whole point of not re-parsing).
 */

describe('newQuestion', () => {
  it('defaults everything but the text a parsed long-text question would default', () => {
    expect(newQuestion('Why do you want to work here?')).toEqual({
      q: 'Why do you want to work here?',
      constraints: { type: 'long-text', required: false },
      askHuman: [],
      status: 'pending',
    })
  })

  it('keeps a positive limit with its unit', () => {
    expect(newQuestion('Cover letter', 200, 'words').constraints).toEqual({
      type: 'long-text',
      required: false,
      limit: 200,
      unit: 'words',
    })
    expect(newQuestion('Tweet-length pitch', 280, 'chars').constraints.unit).toBe('chars')
  })

  it('rounds a fractional limit to a whole number of words/chars', () => {
    expect(newQuestion('Half a word', 12.5, 'words').constraints.limit).toBe(13)
    expect(newQuestion('Just under', 12.4, 'chars').constraints.limit).toBe(12)
  })

  it('drops a non-positive or non-finite limit rather than storing it', () => {
    expect(newQuestion('No cap', 0, 'words').constraints).toEqual({
      type: 'long-text',
      required: false,
    })
    expect(newQuestion('No cap', 0.4, 'words').constraints.limit).toBeUndefined()
    expect(newQuestion('No cap', Number.NaN, 'words').constraints.limit).toBeUndefined()
    expect(newQuestion('No cap', undefined, 'words').constraints.limit).toBeUndefined()
  })
})

describe('append round-trip preserves existing answers', () => {
  it('leaves prior drafts and finals intact when the new question is appended', () => {
    const existing: Question[] = [
      {
        q: 'Self-introduction',
        constraints: { type: 'long-text', required: true, limit: 150, unit: 'words' },
        draft: { text: 'I built LUQ LABS.', citations: [{ claimSpan: 'LUQ LABS', factId: 'f1' }] },
        askHuman: [],
        final: 'I built LUQ LABS, a payments platform.',
        status: 'final',
      },
    ]
    const next = [...existing, newQuestion('Anything else we should know?')]

    expect(next).toHaveLength(2)
    // The existing question object is carried through by reference — untouched.
    expect(next[0]).toBe(existing[0])
    expect(next[0].draft?.text).toBe('I built LUQ LABS.')
    expect(next[0].final).toBe('I built LUQ LABS, a payments platform.')
    expect(next[1].q).toBe('Anything else we should know?')
    expect(next[1].status).toBe('pending')
  })
})
