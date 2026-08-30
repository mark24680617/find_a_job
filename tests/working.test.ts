import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Working } from '@/components/Working'

/**
 * Two things have to be right before any timer has run, because they are what somebody sees and
 * hears the instant they click: the first stage with an honest expectation beside it, and — the
 * whole reason this is a component rather than a conditional — a status region that was already
 * in the DOM while nothing was happening. A live region that arrives carrying its message is not
 * announced by several screen readers, so a resting render that omits the region is a bug even
 * though it looks identical on screen.
 */

const html = (busy: boolean) =>
  renderToStaticMarkup(
    createElement(
      Working,
      {
        busy,
        stages: [
          { at: 0, text: 'Reading your resume…' },
          { at: 4000, text: 'Finding the facts…' },
        ],
        note: 'Usually takes 10–20 seconds.',
      },
      createElement('p', null, 'Runs once per click.'),
    ),
  )

describe('Working', () => {
  it('opens on the first stage and says nothing about the later ones yet', () => {
    const markup = html(true)
    expect(markup).toContain('Reading your resume…')
    expect(markup).not.toContain('Finding the facts…')
  })

  it('says how long the wait usually is, so nobody has to guess whether it hung', () => {
    expect(html(true)).toContain('Usually takes 10–20 seconds.')
  })

  it('keeps the moving part away from the screen reader', () => {
    const markup = html(true)
    expect(markup).toContain('class="working"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('is a status region at rest too — which is what makes the first stage an announcement', () => {
    expect(html(false)).toContain('role="status"')
    expect(html(true)).toContain('role="status"')
  })

  it('holds the surface’s resting copy until there is something to report', () => {
    expect(html(false)).toContain('Runs once per click.')
    expect(html(false)).not.toContain('Reading your resume…')
    expect(html(false)).not.toContain('Usually takes 10–20 seconds.')
    expect(html(true)).not.toContain('Runs once per click.')
  })
})
