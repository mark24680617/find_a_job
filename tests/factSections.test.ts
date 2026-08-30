import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Fact } from '@/lib/types'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { FactSections } from '@/components/profile/FactSections'

/**
 * The organized view's sub-grouping. The rules themselves are pinned in profileView.test.ts;
 * what is checked here is which sections get them and what a person actually sees — the entity's
 * name without its tag prefix, and no sub-heading at all where there is nothing to sub-group by.
 */

function fact(partial: Partial<Fact> & { id: string }): Fact {
  return { claim: '', sourceSnippet: '', tags: [], ...partial }
}

const markup = (facts: Fact[]) =>
  renderToStaticMarkup(createElement(FactSections, { facts, standardAnswers: {} }))

describe('FactSections entity sub-grouping', () => {
  const experience = [
    fact({ id: 'f1', tags: ['experience', 'entity:Fenwick'], claim: 'Owns the payments service' }),
    fact({ id: 'f2', tags: ['experience', 'entity:Acme'], claim: 'Built the billing pipeline' }),
    fact({ id: 'f3', tags: ['experience'], claim: 'Led the on-call rotation at Fenwick' }),
    fact({ id: 'f4', tags: ['experience'], claim: 'Mentored two junior engineers' }),
  ]

  it('shows the entity’s name, never the tag it came from', () => {
    const html = markup(experience)
    expect(html).toContain('>Fenwick<')
    expect(html).toContain('>Acme<')
    expect(html).not.toContain('entity:')
  })

  it('counts each entity’s facts, and puts the unattributed ones under General, last', () => {
    const html = markup(experience)
    expect(html.indexOf('>Fenwick<')).toBeLessThan(html.indexOf('>General<'))
    expect(html.indexOf('>Acme<')).toBeLessThan(html.indexOf('>General<'))
    // f1 tagged Fenwick and f3 matched on its claim — two under one heading.
    expect(html).toMatch(/>Fenwick<[\s\S]{0,120}?>2</)
  })

  it('keeps every fact on screen exactly once', () => {
    const html = markup(experience)
    for (const f of experience) expect(html.split(`>${f.id}<`)).toHaveLength(2)
  })

  it('renders a section flat when nothing in it names an entity', () => {
    // A single "General" heading over the same list is a heading that says nothing.
    const html = markup([
      fact({ id: 'f1', tags: ['experience'], claim: 'Three years of backend experience' }),
      fact({ id: 'f2', tags: ['experience'], claim: 'Led a migration to Kafka' }),
    ])
    expect(html).toContain('>Experience<')
    expect(html).not.toContain('>General<')
  })

  it('leaves the short sections alone — only Experience and Projects sub-group', () => {
    // Splitting a five-row section by employer makes it longer to read, not shorter.
    const html = markup([
      fact({ id: 'f1', tags: ['education', 'entity:MIT'], claim: 'B.S. Computer Science' }),
      fact({ id: 'f2', tags: ['skills', 'entity:Fenwick'], claim: 'Go, Postgres, Kafka' }),
      fact({ id: 'f3', tags: ['project', 'entity:Ledger'], claim: 'Built an open-source ledger' }),
    ])
    expect(html).not.toContain('>MIT<')
    expect(html).not.toContain('>Fenwick<')
    // Projects does sub-group, so its entity is on screen.
    expect(html).toContain('>Ledger<')
  })
})
