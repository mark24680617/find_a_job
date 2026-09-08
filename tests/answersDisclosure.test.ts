import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnswersDisclosure } from '@/components/review/AnswersDisclosure'

// Past applying the answers stop being the work and become the record of it, so they fold away
// behind one line. What a static render can check is the whole of that: which stage gets the
// heading at all, what the control says, and — the part that matters most — that collapsing
// hides the body without unmounting it. The pane inside holds the one piece of unsaved work on
// the screen, and a collapse that dropped it would lose an answer somebody was writing.

const html = (props: { collapsible: boolean; open: boolean; answered: number; total: number }) =>
  renderToStaticMarkup(
    // `children` is required on the props, and createElement's types never count a trailing
    // argument towards them. Both forms build the same element.
    // eslint-disable-next-line react/no-children-prop -- see above
    createElement(AnswersDisclosure, {
      ...props,
      onToggle: () => {},
      children: createElement('p', null, 'the questions workspace'),
    }),
  )

describe('AnswersDisclosure', () => {
  it('is nothing but its children before the record has been sent', () => {
    const markup = html({ collapsible: false, open: false, answered: 1, total: 3 })
    expect(markup).toContain('the questions workspace')
    expect(markup).not.toContain('Application answers')
    expect(markup).not.toContain('hidden')
  })

  it('folds the workspace away behind a count and a Show, keeping it mounted', () => {
    const markup = html({ collapsible: true, open: false, answered: 1, total: 3 })
    expect(markup).toContain('Application answers')
    expect(markup).toContain('1 of 3 answered')
    expect(markup).toContain('>Show</button>')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('id="answers-body" hidden')
    expect(markup).toContain('Sent with the application. Open to read or edit them.')
    // Hidden, not gone: the answer being written survives the fold.
    expect(markup).toContain('the questions workspace')
  })

  it('opens onto the workspace, and stops explaining itself once it has', () => {
    const markup = html({ collapsible: true, open: true, answered: 1, total: 3 })
    expect(markup).toContain('>Hide</button>')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).not.toContain('hidden')
    expect(markup).not.toContain('Sent with the application')
  })

  it('is the same element either way, so the flip past applying remounts nothing', () => {
    // "Log an interview" moves the record while the pane below is on screen, flipping
    // `collapsible` under it. React unmounts a subtree whose element type changed, so a
    // different tag per stage would throw away the answer being written at the very moment the
    // record moved — and quietly, since the pane clears the page's unsaved-changes guard as it
    // unmounts. One tag in both branches is what keeps the body in place.
    const rootTag = (markup: string) => /^<([a-z]+)/.exec(markup)?.[1]
    const draft = html({ collapsible: false, open: false, answered: 1, total: 3 })
    const past = html({ collapsible: true, open: false, answered: 1, total: 3 })

    expect(rootTag(draft)).toBe('section')
    expect(rootTag(past)).toBe(rootTag(draft))
  })

  it('says a record with no questions has none, rather than counting to nothing', () => {
    expect(html({ collapsible: true, open: false, answered: 0, total: 0 })).toContain('none recorded')
  })
})
