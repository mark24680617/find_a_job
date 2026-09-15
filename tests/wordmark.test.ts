import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Wordmark } from '@/components/Wordmark'

const html = renderToStaticMarkup(createElement(Wordmark))
const text = html.replace(/<[^>]+>/g, '')

describe('Wordmark', () => {
  it('still reads as the product name, although JOB is drawn', () => {
    expect(text).toBe('Find a Job')
  })

  it('hides the drawing from assistive tech and says Job once, in text', () => {
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<span class="sr-only">Job</span>')
  })

  it('draws the J in the accent and the O and B in the surrounding ink, so it follows the theme', () => {
    const paths = [...html.matchAll(/<path ([^>]+)>/g)].map((m) => m[1])
    expect(paths).toHaveLength(2)
    expect(paths[0]).toContain('class="fill-accent"')
    expect(paths[1]).toContain('fill="currentColor"')
  })
})
