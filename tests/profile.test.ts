import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { GapAnswers } from '@/components/profile/GapAnswers'
import { VoiceRules } from '@/components/profile/VoiceRules'

/**
 * Two sections of the vault that a person is allowed to ignore, and used not to say so: the
 * open questions and the learned voice rules. Both now carry the word in a chip beside the
 * heading rather than in a sentence underneath, because a sentence explaining that a section is
 * optional is itself something to read before you can skip it.
 *
 * The heading is pinned too. "What an application **will** ask" read as a list of things the
 * candidate was on the hook for; "may ask" is what it actually is.
 */

describe('GapAnswers render', () => {
  const markup = (gaps: string[]) =>
    renderToStaticMarkup(createElement(GapAnswers, { gaps, onAnswer: () => {} }))

  const gaps = ['No dates on the Fintech Co role', 'No metric for the payments migration']

  it('asks what an application may ask, not what it will', () => {
    expect(markup(gaps)).toContain('What an application may ask')
    expect(markup(gaps)).not.toContain('What an application will ask')
  })

  it('marks the section optional in a chip rather than a sentence', () => {
    const html = markup(gaps)
    expect(html).toMatch(/class="chip[^"]*"[^>]*>Optional</)
    // The sentence that used to carry it — leaving a gap unanswered is the section's whole
    // posture, and the chip is now where that is said.
    expect(html).not.toContain('leave it and it stays a question')
  })

  it('still says whose answers these are, and counts what is open', () => {
    const html = markup(gaps)
    expect(html).toContain('Only you know these')
    expect(html).toContain('2 open')
  })

  it('renders nothing at all when there is nothing left to ask', () => {
    expect(markup([])).toBe('')
  })

  it('gives every answer box a label naming its own question', () => {
    // They all read "Your answer — only you know this"; the question is what tells them apart.
    expect(markup(gaps)).toContain('Your answer to: No dates on the Fintech Co role')
  })
})

describe('VoiceRules render', () => {
  const markup = () =>
    renderToStaticMarkup(createElement(VoiceRules, { rules: [], onChange: () => {} }))

  it('marks itself optional — there is nothing here to fill in', () => {
    expect(markup()).toMatch(/class="chip[^"]*"[^>]*>Optional</)
  })

  it('still teaches the empty state instead of reporting it', () => {
    expect(markup()).toContain('Rewrite a draft answer')
  })
})
