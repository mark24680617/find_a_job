import { describe, it, expect } from 'vitest'
import { FAQ } from '@/lib/landing/faq'

// The questions are data so the page and the tests read the same list. What is pinned is the
// shape the spec fixed — eight, each with a question and an answer, no two alike, and the
// register: nothing on the landing page shouts.

describe('FAQ', () => {
  it('holds the eight questions the spec names, in its order', () => {
    expect(FAQ).toHaveLength(8)
    expect(FAQ.map((f) => f.q)).toEqual([
      'Does it submit applications for me?',
      'What does “cited” mean here?',
      'What happens when it doesn’t know something?',
      'Which job sites work with a link?',
      'Where is my data, and who can see it?',
      'Is it free? Is it open source?',
      'Which model writes the drafts, and why should I trust it?',
      'Does it learn how I write?',
    ])
  })

  it('answers every one, and never with an exclamation mark', () => {
    for (const { q, a } of FAQ) {
      expect(a.trim().length).toBeGreaterThan(40)
      expect(q).not.toContain('!')
      expect(a).not.toContain('!')
    }
    expect(new Set(FAQ.map((f) => f.q)).size).toBe(8)
  })
})
