import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BriefInUse, SectionLock } from '@/lib/assignment'
import type { Assignment, InterviewRound } from '@/lib/types'

// A static render reaches the whole of what this section decides before anybody clicks: which of
// the two texts is the brief, how long it is, whether it was cut, whether there is a stored one
// to disclose, what the link is called, and whether the panel may be opened at all. The two mocks
// are the pair every component test here carries — `apiFetch` reaches for the browser's fetch and
// the signed-in user, and importing the Firebase client starts an app.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { AssignmentSection, BriefPanel } from '@/components/interviews/AssignmentSection'

type Props = Parameters<typeof AssignmentSection>[0]

// Lengths chosen to be read straight off the screen: the notice is 324 characters, an added brief
// is 1,280 — long enough that the thousands separator in the line is asserted rather than assumed.
const NOTICE = 'n'.repeat(324)
const BRIEF = 'b'.repeat(1_280)

const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  text: BRIEF,
  source: 'pasted',
  addedAt: '2026-09-05T10:00:00.000Z',
  cut: false,
  ...over,
})
const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r1',
  noticeRaw: NOTICE,
  roundType: 'take-home',
  people: [],
  chat: [],
  createdAt: '2026-09-05T09:00:00.000Z',
  ...over,
})
/** What `briefInUse` would have answered for the round beside it — passed in, never derived here. */
const inUse = (over: Partial<BriefInUse> = {}): BriefInUse => ({
  text: NOTICE,
  identity: 'notice',
  cut: false,
  source: 'notice',
  ...over,
})
const added = (over: Partial<BriefInUse> = {}): BriefInUse =>
  inUse({ text: BRIEF, identity: '2026-09-05T10:00:00.000Z', source: 'pasted', ...over })

const base: Props = {
  appId: 'app-1',
  round: round(),
  brief: inUse(),
  planExists: false,
  lock: null,
  setLock: () => {},
  onRound: () => {},
}
const html = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(AssignmentSection, { ...base, ...over }))

describe('AssignmentSection — which text is the brief', () => {
  it('says the notice is standing in, until one is added', () => {
    const out = html()
    // The section is its own section, eyebrow included — the page mounts it bare, the way it
    // mounts BriefSection, so the heading has to come from here or come from nowhere.
    expect(out).toContain('aria-labelledby="assignment-heading"')
    expect(out).toContain('id="assignment-heading"')
    expect(out).toContain('The assignment')
    expect(out).toContain('The notice is the brief · 324 characters')
  })

  it('names a brief that was pasted', () => {
    const out = html({ round: round({ assignment: assignment() }), brief: added() })
    expect(out).toContain('Pasted · 1,280 characters')
  })

  it('says out loud that a PDF was read by the model, not by us', () => {
    const out = html({
      round: round({ assignment: assignment({ source: 'pdf' }) }),
      brief: added({ source: 'pdf' }),
    })
    expect(out).toContain('PDF, transcribed · 1,280 characters')
  })

  it('links the host of a brief read from a link, and does not follow it with a referrer', () => {
    const url = 'https://docs.google.com/document/d/abc123/edit'
    const out = html({
      round: round({ assignment: assignment({ source: 'url', url }) }),
      brief: added({ source: 'url' }),
    })
    expect(out).toContain(`href="${url}"`)
    expect(out).toContain('rel="noreferrer"')
    expect(out).toContain('>docs.google.com</a>')
    expect(out).toContain('· 1,280 characters')
  })

  it('says when the brief in use was cut, whichever text it is', () => {
    expect(html({ brief: inUse({ cut: true }) })).toContain(
      'The notice is the brief · 324 characters · cut at 20,000 characters',
    )
    const out = html({
      round: round({ assignment: assignment({ cut: true }) }),
      brief: added({ cut: true }),
    })
    expect(out).toContain('Pasted · 1,280 characters · cut at 20,000 characters')
  })
})

describe('AssignmentSection — the disclosure and the way in', () => {
  it('holds the brief as read only once there is one that is not the notice', () => {
    // The notice already stands at the foot of the page under its own disclosure; a second copy
    // of it here would be the same document twice.
    expect(html()).not.toContain('The brief as read')
    const out = html({ round: round({ assignment: assignment() }), brief: added() })
    expect(out).toContain('The brief as read')
    expect(out).toContain(BRIEF)
  })

  it('offers to add a brief, and to replace the one there is', () => {
    expect(html()).toContain('Add the brief')
    expect(html()).not.toContain('Replace the brief')
    const out = html({ round: round({ assignment: assignment() }), brief: added() })
    expect(out).toContain('Replace the brief')
    expect(out).not.toContain('Add the brief')
  })

  it('will not open the panel while a plan is being drawn from the brief', () => {
    const out = html({ lock: 'planning' })
    expect(out).toContain('Wait for the plan to finish before changing the brief.')
    expect(out).toContain('disabled=""')
    // At rest the link is the only control in the section, and it is not disabled.
    expect(html()).not.toContain('Wait for the plan to finish before changing the brief.')
    expect(html()).not.toContain('disabled=""')
  })
})

describe('BriefPanel', () => {
  const panel = (planExists: boolean, lock: SectionLock = null) =>
    renderToStaticMarkup(
      createElement(BriefPanel, {
        appId: 'app-1',
        roundId: 'r1',
        planExists,
        lock,
        setLock: () => {},
        onRead: () => {},
        onCancel: () => {},
      }),
    )

  it('offers the three ways in, and names the one limit a file has', () => {
    const out = panel(false)
    expect(out).toContain('Paste the brief')
    expect(out).toContain('Or a PDF — up to 6 MB')
    expect(out).toContain('accept="application/pdf"')
    expect(out).toContain('Or a public link — Google Docs and GitHub links are read as text')
    expect(out).toContain('Read the brief')
    expect(out).toContain('Cancel')
    // Nothing is filled in, so there is not yet exactly one thing to read.
    expect(out).toContain('disabled=""')
  })

  it('says what a replacement costs, and only when there is something to lose', () => {
    expect(panel(true)).toContain('Replaces the plan you have now.')
    expect(panel(false)).not.toContain('Replaces the plan you have now.')
  })

  it('freezes a panel left open when a plan starts, and says why it is frozen', () => {
    // The panel outlives the click that opened it, so a plan started underneath it would
    // otherwise find all three ways in still live — and a read landing mid-run would clear the
    // lock the plan is holding. One disabled fieldset freezes the lot.
    const out = panel(false, 'planning')
    expect(out).toContain('<fieldset disabled=""')
    expect(out).toContain('Wait for the plan to finish before changing the brief.')
    expect(panel(false)).not.toContain('<fieldset disabled=""')
    expect(panel(false)).not.toContain('Wait for the plan to finish before changing the brief.')
  })
})
