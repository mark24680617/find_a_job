import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  Changeset,
  Fact,
  FactAdd,
  FactSkip,
  InterviewRound,
  MockDebrief,
  ResearchSource,
} from '@/lib/types'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing rendered here makes a request.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import {
  alreadyCovered,
  AlreadyCovered,
  ClaimToFact,
  focusTargetOnClose,
  focusTargetOnOpen,
} from '@/components/interviews/ClaimToFact'
import { claimSnippet, Debrief } from '@/components/interviews/Debrief'

/**
 * The feedback at rest. What is checked here is the one thing the debrief must never get
 * wrong: which sentences are amber, and whether a person is offered the one move only they
 * can make. A claim that reads as checked when nothing checked it is the failure this whole
 * screen exists to prevent.
 */

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns the payments service', sourceSnippet: 'Owns payments', tags: ['backend'] },
]

const sources: ResearchSource[] = [
  {
    id: 's1',
    title: 'My Marram loop',
    url: 'https://forum.example/marram',
    host: 'forum.example',
    kind: 'community',
    snippet: '',
    fetched: true,
  },
]

const debrief: MockDebrief = {
  overall: 'You gave the shape of the migration but not its numbers.',
  answers: [
    {
      question: 'Tell me about a migration you led.',
      landed: ['You named the decision before the result.'],
      vague: ['The size of the fleet never appeared.'],
      unsupported: [
        { said: 'I cut checkout latency by half in a quarter.', why: 'No fact records a latency result.' },
      ],
    },
  ],
  code: { strengths: ['The parser handles an empty line.'], gaps: ['Nothing covers a trailing comma.'] },
  rehearse: ['Owns the payments service'],
  factsChecked: 2,
}

const round = (over: Partial<MockDebrief> = {}): InterviewRound => ({
  id: 'r1',
  noticeRaw: '',
  roundType: 'technical',
  people: [],
  chat: [
    {
      role: 'model',
      text: 'Tell me about a migration you led.',
      kind: 'question',
      sourceId: 's1',
      at: '2026-09-03T10:00:00.000Z',
    },
    { role: 'user', text: 'I cut checkout latency by half in a quarter.', at: '2026-09-03T10:02:00.000Z' },
  ],
  mock: {
    mode: 'coding',
    startedAt: '2026-09-03T10:00:00.000Z',
    questionsAsked: 1,
    status: 'debriefed',
    previousQuestions: [],
    debrief: { ...debrief, ...over },
    debriefedAt: '2026-09-03T10:20:00.000Z',
  },
  createdAt: '2026-09-01T00:00:00.000Z',
})

const markup = (
  over: { debrief?: Partial<MockDebrief>; profileFailed?: boolean } = {},
): string =>
  renderToStaticMarkup(
    createElement(Debrief, {
      appId: 'app-1',
      round: round(over.debrief),
      sources,
      facts,
      profileFailed: over.profileFailed ?? false,
      company: 'Marram Systems',
      stageName: 'Coding round',
      onRound: () => {},
      onFactsChanged: async () => {},
    }),
  )

const ADD_LINK = 'This is true — add it to my facts'
const EMPTY_BANK = 'Your fact bank is empty, so nothing you said here could be checked against it.'
const UNREAD = 'Your facts couldn’t be read — reload to add this.'

describe('Debrief — what only the candidate can settle', () => {
  it('puts an unsupported sentence in amber, quoted, with the one move that is theirs', () => {
    const html = markup()
    expect(html).toContain('Only you can say whether this is true')
    expect(html).toContain('I cut checkout latency by half in a quarter.')
    expect(html).toContain('No fact records a latency result.')
    expect(html).toContain('border border-amber bg-amber-soft')
    expect(html).toContain(ADD_LINK)
    // The two ids the focus round trip comes back to, pinned where they are rendered.
    expect(html).toContain('id="mock-claim-0-0"')
    expect(html).toContain('id="mock-add-0-0"')
  })

  it('names the sentence each add button is about, since they all read the same', () => {
    // Every button on the screen is "This is true — add it to my facts". A screen reader
    // listing them gets one name repeated; the description is the quoted sentence itself.
    const html = markup()
    expect(html).toContain('aria-describedby="mock-said-0-0"')
    expect(html).toContain('id="mock-said-0-0"')
  })

  it('drops the amber and the link once the claim is in the bank', () => {
    // Added is not a warning any more. The sentence stays — it is what they said — but the
    // one thing amber means here has been settled by the only person who could settle it.
    const html = markup({
      debrief: {
        answers: [
          {
            ...debrief.answers[0],
            unsupported: [{ ...debrief.answers[0].unsupported[0], added: true }],
          },
        ],
      },
    })
    expect(html).toContain('In your facts.')
    expect(html).not.toContain(ADD_LINK)
    expect(html).not.toContain('border-amber')
    // The link is gone, so the item is what focus can come back to — and it is still there.
    expect(html).toContain('id="mock-claim-0-0"')
    expect(html).not.toContain('id="mock-add-0-0"')
  })

  it('says it once when the bank was empty, and leaves the items plain', () => {
    const html = markup({ debrief: { factsChecked: 0 } })
    expect(html).toContain(EMPTY_BANK)
    expect(html).toContain('href="/profile"')
    expect(html).toContain('border-l-2 border-line pl-4')
    expect(html).toContain(ADD_LINK)
    // One amber surface on the whole screen: the line that explains the plain items.
    expect(html.match(/border-amber/g)).toHaveLength(1)
  })

  it('does not offer to add anything when the profile could not be read', () => {
    // A reconcile against a bank we failed to load would propose facts they already hold.
    const html = markup({ profileFailed: true })
    expect(html).toContain(UNREAD)
    expect(html).not.toContain(ADD_LINK)
  })

  it('says both things when the bank was empty and the profile could not be read', () => {
    const html = markup({ profileFailed: true, debrief: { factsChecked: 0 } })
    expect(html).toContain(EMPTY_BANK)
    expect(html).toContain(UNREAD)
    expect(html).not.toContain(ADD_LINK)
  })
})

describe('Debrief — the rest of the feedback', () => {
  it('leads with the overall, and lets the section put focus on it', () => {
    const html = markup()
    expect(html).toContain('You gave the shape of the migration but not its numbers.')
    expect(html).toContain('id="debrief-overall"')
    expect(html).toContain('tabindex="-1"')
  })

  it('keeps the conversation, folded away', () => {
    const html = markup()
    expect(html).toContain('<details')
    expect(html).toContain('The conversation')
    expect(html).toContain('reported by ')
    expect(html).toContain('href="https://forum.example/marram"')
  })

  it('keeps a long line of the archived code inside the page, as the live ledger does', () => {
    // `whitespace-pre-wrap` wraps at a space and not inside a 200-character token, so a URL or
    // a base64 literal in their answer widens the page unless the element scrolls itself.
    const html = markup()
    expect(html).toContain('<pre class="mt-1.5 max-w-[74ch] overflow-x-auto whitespace-pre-wrap font-mono')
  })

  it('renders a list only when it has something in it', () => {
    const html = markup()
    expect(html).toContain('What landed')
    expect(html).toContain('You named the decision before the result.')
    expect(html).toContain('What was vague')
    const bare = markup({
      debrief: { answers: [{ question: 'Tell me about a migration you led.', landed: [], vague: [], unsupported: [] }] },
    })
    expect(bare).not.toContain('What landed')
    expect(bare).not.toContain('What was vague')
    expect(bare).not.toContain('Only you can say whether this is true')
  })

  it('reads the code only when there is a reading of it', () => {
    const html = markup()
    expect(html).toContain('Read, not run')
    expect(html).toContain('The parser handles an empty line.')
    expect(html).toContain('Nothing covers a trailing comma.')
    expect(markup({ debrief: { code: undefined } })).not.toContain('Read, not run')
    // The file's own rule, one level up from where `Compact` applies it: a coding mock whose
    // reader had nothing to say draws no heading either.
    expect(markup({ debrief: { code: { strengths: [], gaps: [] } } })).not.toContain('Read, not run')
  })

  it('hands the rehearsal lines back quoted, as the brief does', () => {
    const html = markup()
    expect(html).toContain('Rehearse')
    expect(html).toContain('border-l-2 border-line-strong pl-4')
    expect(html).toContain('Owns the payments service')
  })
})

describe('Debrief — where focus goes, and where it comes back to', () => {
  // The round trip is two ids and nothing else, which is the whole reason it resolves through
  // pure functions: this suite has no DOM, so the ids are checked here and the `.focus()` calls
  // that use them are checked in the quality run.
  it('opens on the panel’s heading, and on the resting copy’s when no panel arrived', () => {
    expect(focusTargetOnOpen(true)).toBe('reconcile-heading')
    // The failure lands in the same place, so focus has the same distance to travel; without
    // this the click left the keyboard on the add link with the reason rendered off-screen.
    expect(focusTargetOnOpen(false)).toBe('claim-heading')
  })

  it('comes back to the link, and to the item once the link has gone', () => {
    expect(focusTargetOnClose('0-0', false)).toBe('mock-add-0-0')
    expect(focusTargetOnClose('0-0', true)).toBe('mock-claim-0-0')
    // And what it resolves to is what the debrief actually rendered.
    expect(markup()).toContain(`id="${focusTargetOnClose('0-0', false)}"`)
  })
})

describe('ClaimToFact — the states a request cannot be made for', () => {
  // The panel's own surface only exists after a reconcile has answered, and no effect runs in a
  // static render, so what can be reached here is the copy the wait rests in — and, on its own,
  // the branch that shows under a panel proposing nothing.
  const waiting = renderToStaticMarkup(
    createElement(ClaimToFact, {
      said: 'I cut checkout latency by half in a quarter.',
      snippet: 'Said in a mock Coding round for Marram Systems, 2026-09-03: “…”',
      facts,
      onApplied: async () => {},
      onClose: () => {},
    }),
  )

  it('gives the resting copy a heading focus can reach', () => {
    expect(waiting).toContain('id="claim-heading"')
    expect(waiting).toContain('tabindex="-1"')
  })

  it('offers nothing to retry while the first read is still running', () => {
    // "Try again" belongs to a failure. During the wait the only honest control is Cancel.
    expect(waiting).toContain('Cancel')
    expect(waiting).not.toContain('Try again')
  })

  it('lets a claim the bank already covers be settled without writing anything', () => {
    // Every row a skip means Accept is disabled and the amber would never lift: Cancel settles
    // nothing and the next click buys the same round trip.
    const covered = renderToStaticMarkup(
      createElement(AlreadyCovered, { busy: false, onCovered: () => {} }),
    )
    expect(covered).toContain('Your facts already cover this.')
    expect(covered).toContain('Mark it as covered')
  })
})

describe('alreadyCovered', () => {
  const skip: FactSkip = { id: 'f1', reason: 'f1 already says this.' }
  const add: FactAdd = { claim: 'Ran the migration', sourceSnippet: 'said in a mock', tags: [] }
  const changeset = (over: Partial<Changeset> = {}): Changeset => ({
    adds: [],
    updates: [],
    skips: [],
    ...over,
  })

  it('is true only when the reconcile settled the claim by skipping it', () => {
    expect(alreadyCovered(changeset({ skips: [skip] }))).toBe(true)
  })

  it('is false when the reconcile settled nothing and asked instead', () => {
    // Zero adds, zero updates AND zero skips: the panel is showing clarifying questions, and
    // "Your facts already cover this" beside them would offer to mark an item added about a
    // sentence no fact covers.
    expect(alreadyCovered(changeset())).toBe(false)
  })

  it('is false when there is anything to apply', () => {
    expect(alreadyCovered(changeset({ adds: [add], skips: [skip] }))).toBe(false)
  })
})

describe('claimSnippet', () => {
  it('says where the sentence was said, in the words §6 fixes', () => {
    // This is the evidence line the fact carries in the bank for as long as it is held, and it
    // is built only on a click — so this is the only place it can be held to the spec.
    expect(
      claimSnippet('Coding round', 'Marram Systems', '2026-09-03', 'I cut checkout latency by half in a quarter.'),
    ).toBe(
      'Said in a mock Coding round for Marram Systems, 2026-09-03: “I cut checkout latency by half in a quarter.”',
    )
  })
})
