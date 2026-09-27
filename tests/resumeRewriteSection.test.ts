import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NO_BULLETS_FOUND, NO_TEXT_TO_READ, STALE } from '@/components/resume/copy' // NO_TEXT_TO_READ: amended 2026-09-25, ledger E6
import { REWRITE_SECONDS, secondsNote } from '@/components/resume/timings' // amended 2026-09-25, ledger D8
import type { AcceptedRewrite, Fact, StoredResume } from '@/lib/types'

vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn(), ApiError: class ApiError extends Error {} }))

import {
  liveSelection, openCitation, recheckLine, rewriteAskId, RewriteSection, type RewriteProposal,
} from '@/components/resume/RewriteSection'

const facts: Fact[] = [
  { id: 'f3', claim: 'Cut p95 checkout latency from 900 ms to 540 ms.', sourceSnippet: 'p95 540 ms', tags: ['backend'] },
]
const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: '2026-09-21T09:00:00.000Z', filename: 'r.pdf', bytes: 1_024,
  text: 'Worked on checkout performance.',
  lines: [], sections: [], entries: [],
  bullets: [
    { id: 'b1', entryIndex: 0, lines: [4], text: 'Worked on checkout performance.' },
    { id: 'b2', entryIndex: 0, lines: [5], text: 'Cut p95 checkout latency to 540 ms.' },
  ],
  language: 'en',
  diagnose: {
    reviewedFrom: '2026-09-21T09:00:00.000Z', judge: 'jev', ranAt: '2026-09-21T09:05:00.000Z',
    checks: [], findings: [],
    judgements: [
      { bulletId: 'b1', questionId: 'result', noul: 0.06, verdict: 'fail', model: 'jev-1.13.0', judge: 'jev' },
      { bulletId: 'b2', questionId: 'result', noul: 0.95, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' },
    ],
  },
  ...over,
})
const proposal = (over: Partial<RewriteProposal> = {}): { rewrites: RewriteProposal[] } => ({
  rewrites: [{
    bulletId: 'b1',
    text: 'Cut p95 checkout latency from 900 ms to 540 ms across three services.',
    citations: [
      { claimSpan: 'from 900 ms to 540 ms', factId: 'f3', resumeSpan: null },
      { claimSpan: 'checkout latency', factId: null, resumeSpan: 'checkout performance' },
    ],
    askHuman: [],
    skipped: null,
    ...over,
  }],
})
type Props = Parameters<typeof RewriteSection>[0]
const base: Props = {
  resume: resume(), proposal: null, facts, busy: false,
  onRun: async () => {}, onAccept: async () => {}, onAnswerAsk: async () => {},
}
const html = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(RewriteSection, { ...base, ...over }))

describe('RewriteSection — what there is to rewrite', () => {
  it('offers the lines that failed, and only those', () => {
    const out = html()
    expect(out).toContain('Worked on checkout performance.')
    expect(out).not.toContain('Cut p95 checkout latency to 540 ms.')
  })
  it('says plainly when nothing failed', () => {
    const clean = resume({
      diagnose: {
        reviewedFrom: '2026-09-21T09:00:00.000Z', judge: 'jev', ranAt: '2026-09-21T09:05:00.000Z',
        checks: [], findings: [],
        judgements: [{ bulletId: 'b2', questionId: 'result', noul: 0.95, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' }],
      },
    })
    expect(html({ resume: clean })).toContain(
      'Nothing to rewrite. Every bullet carried a result, an action and a scale.',
    )
  })
  // (amended 2026-09-24, ledger B3) A review that judged no line has no failed line
  // either, and §6.3's sentence would claim every bullet passed.
  it('says no line was judged, rather than that every line passed, when the checks judged none', () => {
    const none = resume({ diagnose: { ...resume().diagnose!, judgements: [] } })
    const out = html({ resume: none })
    expect(out).toContain(NO_BULLETS_FOUND)
    expect(out).not.toContain('Nothing to rewrite.')
  })
  // (amended 2026-09-25, ledger E6) C11's precedence: a document with no text layer has no text,
  // which is a different thing from no bullet lines, and the Diagnose section says the former.
  it('says there is no text to read, rather than no bullet lines, when the text layer failed', () => {
    const image = resume({
      diagnose: {
        ...resume().diagnose!,
        checks: [{ checkId: 'text-layer', state: 'fail', source: 'Oracle Taleo documentation' }],
        judgements: [],
      },
    })
    const out = html({ resume: image })
    expect(out).toContain(NO_TEXT_TO_READ)
    expect(out).not.toContain(NO_BULLETS_FOUND)
    expect(out).not.toContain('Nothing to rewrite.')
  })
  it('asks for the checks first when they have not been run', () => {
    expect(html({ resume: resume({ diagnose: undefined }) })).toContain('Run the checks first')
  })
  // (amended 2026-09-24, R44) A diagnosis of the previous upload names bullet ids allocated over
  // a different document, and the rewrite route refuses every one of them — so it is shown as no
  // diagnosis, with the reason, and nothing is offered to tick.
  it('treats checks run against an earlier upload as not run, and says why', () => {
    const out = html({ resume: resume({ diagnose: { ...resume().diagnose!, reviewedFrom: '2026-09-01T00:00:00.000Z' } }) })
    expect(out).toContain('Run the checks first')
    expect(out).toContain(STALE)
    expect(out).not.toContain('type="checkbox"')
  })
})

// Final review, page-1: a tick outlives its line — a Replace re-allocates the ids, a re-run of
// the checks can pass a ticked line — and a tick that is not drawn cannot be unticked.
describe('RewriteSection — what is ticked', () => {
  it('checks, counts and sends only the ticks that still name a line on offer', () => {
    expect(liveSelection(['b9', 'b2'], ['b1', 'b2'])).toEqual(['b2'])
    expect(liveSelection(['b9'], ['b1', 'b2'])).toEqual([])
    expect(liveSelection([], ['b1'])).toEqual([])
  })
  it('starts the section over on a new upload', () => {
    const page = readFileSync('src/components/resume/ResumePageClient.tsx', 'utf8')
    expect(page).toMatch(/<RewriteSection\s[^>]*key=\{resume\.addedAt\}/)
  })
  it('opens a fact only under a card that still cites it, by fact and span together', () => {
    const rewrite = proposal().rewrites[0]
    const cited = { claimSpan: 'from 900 ms to 540 ms', factId: 'f3' }
    expect(openCitation(rewrite, { bulletId: 'b1', citation: cited })).toEqual(cited)
    // Another card's open citation, a fact this card no longer cites, and the same fact under a
    // different span are all closed here.
    expect(openCitation(rewrite, { bulletId: 'b2', citation: cited })).toBeNull()
    expect(openCitation(rewrite, { bulletId: 'b1', citation: { claimSpan: 'from 900 ms to 540 ms', factId: 'f7' } })).toBeNull()
    expect(openCitation(rewrite, { bulletId: 'b1', citation: { claimSpan: '540 ms', factId: 'f3' } })).toBeNull()
    expect(openCitation(rewrite, null)).toBeNull()
  })
})

describe('RewriteSection — the proposal', () => {
  it('underlines a span whose fact is in the bank, and follows the plain prose', () => {
    const out = html({ proposal: proposal() })
    // CitationText draws the sentence as runs: plain, cited, plain.
    expect(out).toContain('<span>Cut p95 checkout latency </span>')
    expect(out).toContain('>from 900 ms to 540 ms</span>')
    expect(out).toContain('<span> across three services.</span>')
    expect(out).toContain('decoration-accent')
    expect(out).toContain('Show the fact behind')
  })
  it('shows a span taken from the resume as what it is, quoted rather than underlined', () => {
    const out = html({ proposal: proposal() })
    expect(out).toContain('From your resume: “checkout performance”')
  })
  it('carries a skip’s reason rather than dropping the line silently', () => {
    const out = html({ proposal: proposal({ skipped: { reason: 'No fact supports a number here.' } }) })
    expect(out).toContain('No fact supports a number here.')
  })
  // Final review, page-6: every card names the resume line it is about.
  it('names the line a skip left as it was', () => {
    const out = html({ proposal: proposal({ skipped: { reason: 'No fact supports a number here.' } }) })
    expect(out).toContain('Left as it is: “Worked on checkout performance.”')
    expect(out).not.toContain('In place of:')
  })
  it('names the line a proposal would replace, and nothing when the id names no line', () => {
    expect(html({ proposal: proposal() })).toContain('In place of: “Worked on checkout performance.”')
    const orphan = html({ proposal: proposal({ bulletId: 'b9' }) })
    expect(orphan).not.toContain('In place of:')
    expect(orphan).not.toContain('Left as it is:')
  })
  it('offers the accept, which is the only thing here that writes', () => {
    expect(html({ proposal: proposal() })).toContain('>Accept this line<')
    expect(html()).not.toContain('>Accept this line<')
  })
})

describe('RewriteSection — a number only the person has', () => {
  it('asks in amber, and says what shape of answer is enough', () => {
    const out = html({
      proposal: proposal({
        askHuman: [{ askId: 'rewrite-b1-0a1b2c3d', question: 'How much did latency drop?', why: 'The bullet needs a number no fact carries.', shape: 'range' }],
      }),
    })
    expect(out).toContain('border-amber bg-amber-soft')
    expect(out).toContain('How much did latency drop?')
    expect(out).toContain('A range is enough — the smallest number you are sure of.')
    expect(out).toContain('id="rewrite-ask-heading"')
    // (amended 2026-09-24, R31) C11's AskHumanQueue prefixes its input ids with `headingId`, so
    // three queues on one page never share an `ask-0`.
    expect(out).not.toContain('id="ask-0"')
  })
  it('says nothing about shape when the model did not name one', () => {
    const out = html({
      proposal: proposal({ askHuman: [{ askId: 'rewrite-b1-4e5f6a7b', question: 'How many services?', why: 'Nothing states it.', shape: null }] }),
    })
    expect(out).toContain('How many services?')
    expect(out).not.toContain('A range is enough')
  })
  // (amended 2026-09-24, R31) An answered card does not come back on the next run.
  it('leaves out an ask this resume already holds an answer to', () => {
    const out = html({
      resume: resume({ asks: [{ askId: 'rewrite-b1-0a1b2c3d', question: 'How much did latency drop?', answer: 'From 900 to 540 ms.', answeredAt: '2026-09-21T09:40:00.000Z' }] }),
      proposal: proposal({
        askHuman: [{ askId: 'rewrite-b1-0a1b2c3d', question: 'How much did latency drop?', why: 'The bullet needs a number no fact carries.', shape: 'range' }],
      }),
    })
    expect(out).not.toContain('How much did latency drop?')
    expect(out).not.toContain('border-amber bg-amber-soft')
  })
  // (amended 2026-09-24, R31) The id is derived, never minted: the same bullet and question give
  // the same id on every run, which is what lets the asks route's 409 mean "already answered".
  it('gives each ask a stable id from its bullet and the SHA-1 of its question', async () => {
    const question = 'How much did latency drop?'
    const hex = createHash('sha1').update(question).digest('hex').slice(0, 8)
    await expect(rewriteAskId('b1', question)).resolves.toBe(`rewrite-b1-${hex}`)
    await expect(rewriteAskId('b1', question)).resolves.toBe(`rewrite-b1-${hex}`)
    await expect(rewriteAskId('b2', question)).resolves.toBe(`rewrite-b2-${hex}`)
  })
})

describe('RewriteSection — what was accepted', () => {
  const accepted: AcceptedRewrite = {
    reviewedFrom: '2026-09-21T09:00:00.000Z', judge: 'jev', acceptedAt: '2026-09-21T09:30:00.000Z',
    bulletId: 'b1', text: 'Cut p95 checkout latency from 900 ms to 540 ms across three services.',
    citations: [{ claimSpan: 'from 900 ms to 540 ms', factId: 'f3', resumeSpan: null }],
    recheck: [
      { bulletId: 'b1', questionId: 'result', noul: 0.94, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' },
      { bulletId: 'b1', questionId: 'action', noul: 0.91, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' },
      { bulletId: 'b1', questionId: 'scale', noul: 0.88, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' },
      { bulletId: 'b1', questionId: 'self-description', noul: 0.12, verdict: 'fail', model: 'jev-1.13.0', judge: 'jev' },
    ],
  }
  it('counts the re-check against the same four, and names the judge', () => {
    expect(recheckLine(accepted.recheck, 'jev')).toBe('Re-checked: 3 of 4, by TypeSafe’s Jev.')
    expect(recheckLine(accepted.recheck, 'gemini')).toBe('Re-checked: 3 of 4, by Google’s Gemini.')
  })
  it('lists it with its count and a way to take the words', () => {
    const out = html({ resume: resume({ rewrites: [accepted] }) })
    expect(out).toContain('Re-checked: 3 of 4, by TypeSafe’s Jev.')
    expect(out).toContain('>Copy<')
    expect(out).toContain('The app never edits your PDF')
    expect(out).not.toContain(STALE)
  })
  // (amended 2026-09-24, R44) An accepted line stays — it is a record of a decision — but one
  // written against an earlier upload says so beside it.
  it('marks an accepted line written against an earlier upload as stale', () => {
    const out = html({ resume: resume({ rewrites: [{ ...accepted, reviewedFrom: '2026-09-01T00:00:00.000Z' }] }) })
    expect(out).toContain('Re-checked: 3 of 4, by TypeSafe’s Jev.')
    expect(out).toContain(STALE)
  })
  // Final review, page-6: the line it replaces, on the upload it was accepted against only.
  it('names the line it replaces on its own upload, and never a new upload’s line under the old id', () => {
    expect(html({ resume: resume({ rewrites: [accepted] }) })).toContain(
      'In place of: “Worked on checkout performance.”',
    )
    const stale = html({
      resume: resume({
        addedAt: '2026-09-22T09:00:00.000Z',
        bullets: [{ id: 'b1', entryIndex: 0, lines: [4], text: 'Led the move to a new billing system.' }],
        rewrites: [accepted],
      }),
    })
    expect(stale).not.toContain('Led the move to a new billing system.')
    expect(stale).not.toContain('In place of:')
    expect(stale).toContain(STALE)
  })
})

// (amended 2026-09-25, ledger D8) The page's `busy` is set by every tool on it; with no press here,
// this section's regions claim nothing. Its own press drawing the stages needs a click, which a
// static render cannot make.
describe('RewriteSection — another tool’s wait', () => {
  it('keeps its resting note and its queue label while another section’s request runs', () => {
    const out = html({
      busy: true,
      proposal: proposal({
        askHuman: [{ askId: 'rewrite-b1-0a1b2c3d', question: 'How much did latency drop?', why: 'The bullet needs a number no fact carries.', shape: 'range' }],
      }),
    })
    expect(out).toContain(secondsNote(REWRITE_SECONDS))
    expect(out).not.toContain('Reading the lines you chose…')
    expect(out).not.toContain('Writing them again from your own facts…')
    expect(out).toContain('Save answers')
    expect(out).not.toContain('Saving…')
  })
})
