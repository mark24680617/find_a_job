import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { blankContact } from '@/lib/profileMerge'
import type { Fact, ProfileContact } from '@/lib/types'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { FactBank } from '@/components/profile/FactBank'
import { FactSections } from '@/components/profile/FactSections'

/**
 * The organized view's sub-grouping. The rules themselves are pinned in profileView.test.ts;
 * what is checked here is which sections get them and what a person actually sees — the entity's
 * name without its tag prefix, and no sub-heading at all where there is nothing to sub-group by.
 */

function fact(partial: Partial<Fact> & { id: string }): Fact {
  return { claim: '', sourceSnippet: '', tags: [], ...partial }
}

const markup = (facts: Fact[], contact: ProfileContact = blankContact()) =>
  renderToStaticMarkup(
    createElement(FactSections, { facts, standardAnswers: {}, contact, onChange: () => {} }),
  )

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

/**
 * The contact block: four inputs the person owns, and the facts offered as a suggestion rather
 * than written in for them. It is the letterhead's first source, so what is stored here is only
 * ever what somebody typed.
 */
describe('FactSections contact', () => {
  const contact: ProfileContact = {
    name: 'Tom Candidate',
    email: 'tom.candidate@example.test',
    phone: '',
    location: 'Portland, OR',
  }

  const located = fact({ id: 'f1', tags: ['contact', 'location'], claim: 'Seattle, WA' })

  it('renders the four fields with what is stored in them', () => {
    const html = markup([located], contact)
    expect(html).toContain('>Contact<')
    expect(html).toContain('Goes on your cover letter’s letterhead. Blank is fine — nothing is guessed.')
    expect(html).toContain('value="Tom Candidate"')
    expect(html).toContain('value="tom.candidate@example.test"')
    expect(html).toContain('value="Portland, OR"')
    // Lower-cased on the way in: the static renderer keeps React's own spelling of the prop.
    for (const attr of ['name', 'address-level2', 'email', 'tel']) {
      expect(html.toLowerCase()).toContain(`autocomplete="${attr}"`)
    }
  })

  it('offers what the facts say for a blank field, as a placeholder and never as a value', () => {
    // A suggestion the person accepts by typing it. Nothing about them is written down here
    // that they did not write themselves.
    const html = markup([located], { ...contact, location: '' })
    expect(html).toContain('placeholder="From your facts: Seattle, WA"')
    expect(html).not.toContain('value="Seattle, WA"')
  })

  it('leaves a filled field’s placeholder off — there is nothing to suggest', () => {
    expect(markup([located], contact)).not.toContain('From your facts: Seattle, WA')
  })

  it('is on screen even when the facts say nothing about who you are', () => {
    // It used to disappear with no identity rows, which is exactly the profile that needs it.
    const html = markup([fact({ id: 'f1', tags: ['skills'], claim: 'Go, Postgres' })])
    expect(html).toContain('>Contact<')
  })

  it('renders what is in the field verbatim, trailing space and all', () => {
    // These are controlled inputs, so whatever the page hands down is what the browser shows. The
    // sanitiser therefore runs where a profile enters the page and never here: trimmed on the
    // render path, `Portland, ` comes back `Portland,` between two keystrokes and the space can
    // never be typed at all — which is `Portland, OR` and every two-word name.
    const html = markup([], { ...blankContact(), name: 'Tom ', location: 'Portland, ' })
    expect(html).toContain('value="Tom "')
    expect(html).toContain('value="Portland, "')
  })

  it('keeps the website as a read-only row off the facts', () => {
    // The letterhead has no website line, so there is nothing here to type into.
    const html = markup([fact({ id: 'f1', tags: ['contact'], claim: 'tomcandidate.dev' })], contact)
    expect(html).toContain('tomcandidate.dev')
    expect(html).not.toContain('value="tomcandidate.dev"')
  })
})

/**
 * The gate in front of the block. `FactSections` draws the contact fields; `FactBank` decides
 * whether it is drawn at all, and an empty bank used to answer that with a placeholder — on
 * exactly the profile that has nothing else to say who the candidate is, and nothing for the
 * letterhead to read either.
 */
describe('FactBank with an empty bank', () => {
  const html = () =>
    renderToStaticMarkup(
      createElement(FactBank, {
        facts: [],
        standardAnswers: {},
        contact: blankContact(),
        onChange: () => {},
        onContactChange: () => {},
      }),
    )

  it('still puts the contact block on screen', () => {
    expect(html()).toContain('>Contact<')
  })

  it('still says there is nothing in the bank yet', () => {
    expect(html()).toContain('No facts yet.')
  })
})
