import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CitationText, segment } from '@/components/review/CitationText'
import type { Citation, Fact } from '@/lib/types'

/**
 * `segment` is the pure core the DOM only renders: it splits the answer into plain and cited
 * runs, and Fix 6 (rendering a cited run as an inline span rather than a `<button>`) must NOT
 * change what it returns — the citation matching depends on the spans staying verbatim.
 *
 * The screenshot bug — ". Through LUQ LABS" on its own centred line, and a lone "." — was a
 * `<button>`'s `text-align: center` acting on a wrapped span. The data shape it wrapped is what
 * these pin: the punctuation that touches a cited span lives in the ADJACENT plain run, never
 * inside the cited run, so once the run flows inline the sentence reads as one line of prose.
 */

const cite = (claimSpan: string, factId = 'f1'): Citation => ({ claimSpan, factId })

describe('segment', () => {
  it('keeps trailing punctuation in the adjacent plain run, not the cited run', () => {
    const text = 'I built LUQ LABS. Through it I shipped payments.'
    const segs = segment(text, [cite('LUQ LABS')])
    expect(segs).toEqual([
      { text: 'I built ' },
      { text: 'LUQ LABS', citation: cite('LUQ LABS') },
      { text: '. Through it I shipped payments.' },
    ])
    // The cited run is exactly the claim span — no punctuation swept in.
    expect(segs.find((s) => s.citation)?.text).toBe('LUQ LABS')
  })

  it('returns the text verbatim when concatenated, so nothing is mutated', () => {
    const text = 'Led 14 services from RabbitMQ to Kafka, then owned reliability.'
    const segs = segment(text, [cite('14 services'), cite('reliability', 'f2')])
    expect(segs.map((s) => s.text).join('')).toBe(text)
  })

  it('matches each distinct span at its first occurrence and keeps order', () => {
    const text = 'payments, payments, payments'
    const segs = segment(text, [cite('payments')])
    // Only the first "payments" is cited; the later verbatim repeats stay plain.
    expect(segs[0]).toEqual({ text: 'payments', citation: cite('payments') })
    expect(segs.slice(1).every((s) => !s.citation)).toBe(true)
    expect(segs.map((s) => s.text).join('')).toBe(text)
  })

  it('drops a later span that overlaps an earlier one', () => {
    const text = 'reliability engineering work'
    const segs = segment(text, [cite('reliability engineering'), cite('engineering work', 'f2')])
    expect(segs.filter((s) => s.citation)).toHaveLength(1)
    expect(segs.find((s) => s.citation)?.text).toBe('reliability engineering')
  })

  it('leaves a span that is not present as plain text', () => {
    const text = 'nothing here matches'
    const segs = segment(text, [cite('absent phrase')])
    expect(segs).toEqual([{ text: 'nothing here matches' }])
  })
})

describe('CitationText render (Fix 6 regression)', () => {
  it('renders a resolved citation as an inline span, not a button', () => {
    const factsById = new Map<string, Fact>([
      ['f1', { id: 'f1', claim: 'Founded LUQ LABS', sourceSnippet: '', tags: [] }],
    ])
    const html = renderToStaticMarkup(
      createElement(CitationText, {
        text: 'I built LUQ LABS. Through it I shipped payments.',
        citations: [cite('LUQ LABS')],
        factsById,
        active: null,
        onSelect: () => {},
      }),
    )
    // A `<button>`'s UA text-align:center is what centred the wrapped span; an inline
    // `<span role="button">` flows as prose. Guard against a revert to `<button>`.
    expect(html).not.toContain('<button')
    expect(html).toContain('role="button"')
  })
})
