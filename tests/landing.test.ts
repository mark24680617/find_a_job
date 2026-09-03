import { describe, it, expect, vi } from 'vitest'
import { createElement, type ImgHTMLAttributes } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The landing as a visitor first sees it: one thesis, four steps, a specimen with three
// citations, four plates, a poster and no iframe, eight questions, and two ways in. A static
// render is the whole of what can be checked without a DOM; the hover, the observer and the
// YouTube swap are handlers and are not run here.
//
// `next/image` is replaced by a plain <img> so the static imports (which vitest resolves to
// path strings) render; `@/lib/firebase/client` is mocked because the header links into the
// shell's world and importing it initialises Firebase.
vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { src: string | { src: string }; priority?: boolean }) => {
    const { src, ...rest } = props
    // `priority` is a next/image directive, not an <img> attribute; left in, React would put it
    // in the markup the assertions read.
    delete rest.priority
    return createElement('img', { ...rest, src: typeof src === 'string' ? src : src.src })
  },
}))
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { Landing } from '@/components/landing/Landing'
import { Specimen } from '@/components/landing/Specimen'

const page = () => renderToStaticMarkup(createElement(Landing))

describe('Landing — the record', () => {
  it('says the thesis once, as the page’s one h1', () => {
    const markup = page()
    expect(markup.match(/<h1[^>]*>/g)).toHaveLength(1)
    expect(markup.split('Your story is unique. AI helps you tell it — it doesn’t replace it.')).toHaveLength(2)
  })

  it('offers two ways in: sign in, and get started on the sign-up half', () => {
    const markup = page()
    expect(markup).toContain('href="/sign-in"')
    expect(markup.split('href="/sign-in?mode=sign-up"').length).toBeGreaterThanOrEqual(3)
  })

  it('walks the four steps in order', () => {
    const markup = page()
    const order = ['Read your resume once', 'Read the posting honestly', 'Draft each answer, cited', 'You review, paste, submit']
    const positions = order.map((h) => markup.indexOf(h))
    expect(positions.every((p) => p > -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('mounts the illustration as a plate with its exhibit label', () => {
    const markup = page()
    expect(markup).toContain('Fig. 1 — a claim, and the card it came from.')
    expect(markup).toContain('An index-card drawer with one card pulled out')
  })

  it('never uses amber — that colour means something else in this product', () => {
    // The class attributes only: the first plate's alt text names the amber card on screen,
    // which is the honest description of that screenshot, not a use of the colour here.
    expect(page().match(/class="[^"]*amber[^"]*"/g)).toBeNull()
  })
})

describe('Specimen — the citation, live', () => {
  it('underlines exactly three phrases and starts with the source panel empty', () => {
    const markup = renderToStaticMarkup(createElement(Specimen))
    expect(markup.match(/data-fact="f\d+"/g)).toHaveLength(3)
    expect(markup).toContain('Select an underlined phrase to see the fact it’s drawn from.')
    expect(markup).toContain('Tell us about a system you own.')
    expect(markup).toContain('handles 12,000 requests a day at a 99.95% success rate')
  })
})

describe('Landing — plates, demo, questions', () => {
  it('shows the four plates with their captions, in the spec’s order', () => {
    const markup = page()
    const order = ['Grounded drafting.', 'The clarify loop.', 'Hard gates, judged honestly.', 'The pipeline.']
    const positions = order.map((h) => markup.indexOf(h))
    expect(positions.every((p) => p > -1)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(markup).toContain('alt="The review workspace:')
    expect(markup).toContain('alt="The pipeline board:')
  })

  it('renders the plates visible in the server HTML — the observer hides nothing before it runs', () => {
    expect(page()).not.toContain('data-reveal="pending"')
  })

  it('loads nothing from YouTube until the demo is played', () => {
    const markup = page()
    expect(markup).not.toContain('<iframe')
    expect(markup).toContain('demo-poster')
    expect(markup).toContain('aria-label="Play the demo video"')
    expect(markup).toContain('href="https://youtu.be/8R0M3HLGvAE"')
  })

  it('asks the eight questions as native disclosures, the first one open', () => {
    const markup = page()
    expect(markup.match(/<details/g)).toHaveLength(8)
    expect(markup.match(/<details[^>]*\sopen/g)).toHaveLength(1)
    expect(markup).toContain('Does it submit applications for me?')
    expect(markup).toContain('Does it learn how I write?')
  })

  it('says where the code is, once, at the bottom', () => {
    const markup = page()
    expect(markup).toContain('href="https://github.com/mark24680617/find_a_job"')
    expect(markup).toContain('Built with Gemini 3.7 Flash')
  })
})
