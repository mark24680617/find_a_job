import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AskHumanQueue } from '@/components/review/AskHumanQueue'
import type { AskHuman } from '@/lib/types'

// Answering the asks and re-drafting is a draft like any other, so whatever holds a draft back
// holds this back too. Being held is not being busy: the answers are still worth typing, and the
// button says what it always says — it just cannot be pressed, and the reason is beside it.

const asks: AskHuman[] = [
  { question: 'Why this company?', why: 'The letter cannot say it without you.', answer: 'A friend works there.' },
]

const html = (held?: string) =>
  renderToStaticMarkup(
    createElement(AskHumanQueue, { asks, busy: false, held, onSubmit: () => {} }),
  )

describe('AskHumanQueue — held back', () => {
  it('submits when nothing is holding it', () => {
    const markup = html()
    expect(markup).toContain('>Answer &amp; re-draft</button>')
    expect(markup).not.toContain('disabled=""')
    expect(markup).toContain('Your answers are kept and folded into the next draft.')
  })

  it('cannot be pressed while something is, and says what', () => {
    const markup = html('Save the letterhead first — the draft addresses and signs the letter from it.')
    expect(markup).toContain('disabled="">Answer &amp; re-draft</button>')
    expect(markup).toContain(
      'Save the letterhead first — the draft addresses and signs the letter from it.',
    )
    // The inputs stay open: what is typed into them is not what is being held back.
    expect(markup).not.toContain('<fieldset disabled=""')
  })
})
