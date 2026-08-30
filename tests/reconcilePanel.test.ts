import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Changeset, ClarifyQuestion, Fact } from '@/lib/types'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { ReconcilePanel } from '@/components/profile/ReconcilePanel'

/**
 * The moment between reading a document and believing it. What is checked here is that the
 * panel is honest at rest: every proposed row is on screen, a revision shows what it is
 * replacing rather than only what it would say, the skips are reachable rather than dropped,
 * and the three ways out are all offered.
 */

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns the payments service', sourceSnippet: 'Owns payments', tags: ['backend'] },
  { id: 'f4', claim: 'Led a migration to Kafka', sourceSnippet: 'Led migration', tags: ['infra'] },
]

const changeset: Changeset = {
  adds: [
    {
      claim: 'Mentors two junior engineers',
      sourceSnippet: 'mentors two juniors on the platform team',
      tags: ['leadership'],
    },
  ],
  updates: [
    {
      id: 'f1',
      claim: 'Owns the payments service handling 12,000 requests/day',
      tags: ['backend', 'entity:Fenwick'],
    },
  ],
  skips: [{ id: 'f4', reason: 'Already stated word for word.' }],
}

const question: ClarifyQuestion = {
  id: 'c1',
  question: 'Is that the same payments service?',
  why: 'One is a revision, the other is a second service.',
  options: [
    { label: 'The same one — merge the number in', value: 'merge' },
    { label: 'A different service — add it', value: 'add' },
  ],
  recommended: 'merge',
  allowMultiple: false,
  allowOther: false,
}

const markup = (over: Partial<Parameters<typeof ReconcilePanel>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ReconcilePanel, {
      round: 1,
      changeset,
      questions: [],
      facts,
      busy: null,
      error: '',
      onAccept: () => {},
      onCancel: () => {},
      onReconcile: () => {},
      ...over,
    }),
  )

describe('ReconcilePanel — the diff', () => {
  it('says nothing is saved yet, and counts all three kinds', () => {
    const html = markup()
    expect(html).toContain('Nothing is saved yet.')
    expect(html).toContain('1 new fact, 1 revised, 1 already known.')
  })

  it('shows each new fact with the fragment it came from', () => {
    const html = markup()
    expect(html).toContain('Mentors two junior engineers')
    expect(html).toContain('mentors two juniors on the platform team')
  })

  it('shows a revision as what it replaces as well as what it would say', () => {
    // Only what it WOULD say is a change nobody can check. The old claim is the other half.
    const html = markup()
    expect(html).toContain('Owns the payments service handling 12,000 requests/day')
    expect(html).toContain('Owns the payments service')
    expect(html).toContain('Replacing: ')
    expect(html).toContain('f1')
  })

  it('says so plainly when a revision points at a fact that is no longer there', () => {
    const html = markup({ facts: [] })
    expect(html).toContain('That fact is no longer in your profile.')
  })

  it('does not dress a re-filing up as a rewording', () => {
    // The model's commonest revision is a stored fact gaining an entity tag, its claim
    // untouched. "was X → now X" would read as a change that is not one.
    const html = markup({
      changeset: {
        ...changeset,
        updates: [{ id: 'f1', claim: facts[0].claim, tags: ['backend', 'entity:Fenwick'] }],
      },
    })
    expect(html).toContain('Same wording — this only changes how it is filed.')
    expect(html).not.toContain('Replacing: ')
  })

  it('keeps the skips collapsed but always reachable, counted in the summary', () => {
    // A claim decided to be already-known is the one decision that would otherwise be
    // invisible, which is exactly what this screen exists to stop.
    const html = markup()
    expect(html).toContain('what it skipped')
    expect(html).toContain('1 already known')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Already stated word for word.')
  })

  it('says so rather than showing an empty list when the document held nothing new', () => {
    const html = markup({ changeset: { adds: [], updates: [], skips: changeset.skips } })
    expect(html).toContain('Nothing here is new to your profile.')
    expect(html).toContain('1 already known.')
  })
})

describe('ReconcilePanel — the ways out', () => {
  it('offers Accept, Cancel and the escape hatch, and says Cancel changes nothing', () => {
    const html = markup()
    expect(html).toContain('>Accept</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('Describe what’s wrong')
    expect(html).toContain('Cancel changes nothing')
  })

  it('will not let Accept apply a changeset with nothing in it to apply', () => {
    const html = markup({ changeset: { adds: [], updates: [], skips: changeset.skips } })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Accept<\/button>/)
  })

  it('shows a failure where the click was, in place of the resting line', () => {
    const html = markup({ error: 'That didn’t save, and nothing was changed. Try again.' })
    expect(html).toContain('That didn’t save, and nothing was changed. Try again.')
    expect(html).not.toContain('Cancel changes nothing')
  })
})

describe('ReconcilePanel — the questions', () => {
  const asked = () => markup({ questions: [question] })

  it('puts the cards in amber and says why they are the candidate’s to answer', () => {
    const html = asked()
    expect(html).toContain('Is that the same payments service?')
    expect(html).toContain('only you know which')
    expect(html).toContain('border-amber')
  })

  it('pre-selects the recommendation, so the fast path is to glance and go', () => {
    const html = asked()
    // One radio checked, and it is the one wearing the "recommended" tag. The cards render no
    // `value` attribute — the option's own label is what identifies it — so the assertion is
    // that the checked input and the tag are in the same label.
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(html.slice(html.indexOf('<label'), html.indexOf('recommended</span>'))).toContain(
      'checked=""',
    )
  })

  it('makes answering the primary move, with accepting-as-is still offered beside it', () => {
    // Answering re-runs the model; accepting takes what it already decided under its own
    // recommendation. Both are real choices, so both are on screen, weighted differently.
    const html = asked()
    expect(html).toContain('>Use my answers</button>')
    expect(html).toContain('>Accept as it stands</button>')
    expect(html).not.toContain('>Accept</button>')
  })

  it('asks nothing when there is nothing it could not settle', () => {
    const html = markup()
    expect(html).not.toContain('Before I change anything')
    expect(html).not.toContain('>Use my answers</button>')
  })
})

describe('ReconcilePanel — the wait', () => {
  it('stays inside the two type families the rest of the product uses', () => {
    // The marker chips are "+" and "~", which a mono face would have been the obvious reach
    // for. Two families, no third — a third would read as a different product.
    expect(markup()).not.toContain('font-mono')
  })

  it('narrates a reconcile and a save differently', () => {
    expect(markup({ busy: 'reconciling' })).toContain('Comparing with what I know…')
    expect(markup({ busy: 'saving' })).toContain('Adding these to your profile…')
  })

  it('freezes every control under it while a request is in flight', () => {
    // One `<fieldset disabled>` rather than a prop on each control: a click landing mid-request
    // would otherwise answer a round that is already being replaced.
    expect(markup({ busy: 'reconciling' })).toContain('<fieldset disabled')
    expect(markup()).not.toContain('<fieldset disabled')
  })
})
