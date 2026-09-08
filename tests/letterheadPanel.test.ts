import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { blankLetterhead } from '@/lib/letter/letterhead'
import type { Letterhead } from '@/lib/types'
import { LetterheadPanel, pendingLetterhead } from '@/components/review/LetterheadPanel'

// The panel shows the header as it will print and then the fields that make it, in that order:
// the preview is drawn from the same `headerLines` the renderer paginates, so what is on screen
// and what is in the PDF cannot drift. What a static render can say is the whole of what that
// claim needs — the lines, in order, with the blanks omitted; the seven capped fields; and the
// save beneath them. Nothing here fetches: the save is the pane's, handed in as a prop.

const letterhead = (over: Partial<Letterhead> = {}): Letterhead => ({
  ...blankLetterhead('Tom Candidate', 'tom@example.test'),
  phone: '(206) 555-0134',
  location: 'Seattle, WA',
  recipient: 'Dana Wu',
  recipientTitle: 'Head of Engineering',
  companyAddress: '1 Main St\nSeattle, WA 98101',
  ...over,
})

const html = (letter: Letterhead, busy = false) =>
  renderToStaticMarkup(
    createElement(LetterheadPanel, {
      letter,
      company: 'Marram Systems',
      today: '2026-09-07',
      busy,
      onSave: () => Promise.resolve(),
      onDirtyChange: () => {},
    }),
  )

describe('LetterheadPanel — the preview', () => {
  it('draws the header as it prints, in order', () => {
    const markup = html(letterhead())
    const at = (s: string) => {
      const i = markup.indexOf(s)
      expect(i, s).toBeGreaterThan(-1)
      return i
    }
    expect(markup).toContain('<p class="font-display text-ink">Tom Candidate</p>')
    expect(at('Tom Candidate')).toBeLessThan(at('tom@example.test · Seattle, WA · (206) 555-0134'))
    expect(at('tom@example.test · Seattle, WA · (206) 555-0134')).toBeLessThan(at('September 7, 2026'))
    expect(at('September 7, 2026')).toBeLessThan(at('Dana Wu'))
    expect(at('Dana Wu')).toBeLessThan(at('Head of Engineering'))
    expect(at('Head of Engineering')).toBeLessThan(at('Marram Systems'))
    expect(at('Marram Systems')).toBeLessThan(at('1 Main St'))
    expect(at('1 Main St')).toBeLessThan(at('Seattle, WA 98101'))
  })

  it('says where the name goes when there is none, and omits the blank lines', () => {
    const markup = html(blankLetterhead())
    expect(markup).toContain('Your name — add it below.')
    // With nothing but the company known, the recipient block is the company and nothing else.
    expect(markup).toContain('Marram Systems')
    expect(markup).toContain('September 7, 2026')
  })

  it('says what the letterhead is not', () => {
    expect(html(letterhead())).toContain(
      'The salutation and the signature are in the letter itself; the letterhead is what goes above it.',
    )
  })
})

describe('LetterheadPanel — the fields', () => {
  it('is a labelled fieldset of seven capped controls', () => {
    const markup = html(letterhead())
    expect(markup).toContain('<legend class="sr-only">Letterhead</legend>')
    for (const label of ['Your name', 'Email', 'Phone', 'Location', 'Recipient', 'Their title', 'Company address']) {
      expect(markup, label).toContain(`>${label}</span>`)
    }
    expect(markup.match(/maxLength="200"/g)).toHaveLength(7)
    expect(markup).toContain('placeholder="City, State"')
    expect(markup).toContain('placeholder="Their full name, if you know it"')
    expect(markup).toContain('placeholder="Optional — one line per row"')
  })

  it('saves them with the letter, and says so', () => {
    const markup = html(letterhead())
    expect(markup).toContain('<button type="button" class="btn btn-quiet">Save letterhead</button>')
    expect(markup).toContain('Saved with the letter. The draft addresses and signs it from here.')
  })

  it('is closed while the pane is busy', () => {
    expect(html(letterhead(), true)).toContain('<fieldset disabled=""')
  })
})

// What the save would write is also what "unsaved" is measured against. The save normalises, so
// the comparison has to normalise too: a letterhead whose only edit is a space around an already
// saved value would otherwise stay unsaved for good — the PATCH stores what is already stored,
// so the prop never changes, the fields are never re-seeded, and every control that waits on a
// clean letterhead stays disabled.
describe('LetterheadPanel — what counts as unsaved', () => {
  it('is clean when the only edit normalises back to what is stored', () => {
    const stored = letterhead()
    const typed = pendingLetterhead({ ...stored, name: `${stored.name} ` }, stored)
    expect(typed.dirty).toBe(false)
    expect(typed.next).toEqual(stored)
  })

  it('is clean when a blank field is given nothing but a space', () => {
    const stored = letterhead({ phone: '' })
    expect(pendingLetterhead({ ...stored, phone: ' ' }, stored).dirty).toBe(false)
  })

  it('is unsaved on a real edit, and writes it normalised', () => {
    const stored = letterhead()
    const typed = pendingLetterhead({ ...stored, recipient: '  Dana Wu Jr.  ' }, stored)
    expect(typed.dirty).toBe(true)
    expect(typed.next.recipient).toBe('Dana Wu Jr.')
  })
})
