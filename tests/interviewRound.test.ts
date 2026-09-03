import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { BriefView } from '@/components/interviews/BriefView'
import { RoundCard } from '@/components/interviews/RoundCard'
import type { InterviewRound, PrepBrief } from '@/lib/types'

const brief: PrepBrief = {
  likelyTopics: ['Why this role, and what you know about the ledger rewrite'],
  questionsToPrepare: [
    { q: 'Walk me through your background.', angle: 'f1 — the payments service at 99.95%' },
  ],
  questionsToAsk: ['Who owns reconciliation today, and what breaks most often?'],
  factsToRehearse: ['Cut p99 checkout latency from 840ms to 210ms by batching ledger writes'],
  redFlags: ['Three years against a stated five-year minimum — say so plainly, then say what you did in three.'],
}

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r-1',
  noticeRaw: 'A 30-minute call with our recruiter Ana Reyes.',
  roundType: 'recruiter-screen',
  datetime: '2026-09-03T21:00:00.000Z',
  people: ['Ana Reyes — Recruiting'],
  askHuman: [{ question: 'Is there a take-home after this?', why: 'The notice does not say.' }],
  prepBrief: brief,
  chat: [],
  createdAt: '2026-08-29T10:00:00.000Z',
  ...over,
})

const html = (over: Partial<InterviewRound> = {}, briefFailed = false) =>
  renderToStaticMarkup(
    createElement(RoundCard, { appId: 'app-1', round: round(over), briefFailed }),
  )

describe('RoundCard', () => {
  it('names the round, the time, and who is on it', () => {
    const out = html()
    expect(out).toContain('Recruiter screen')
    expect(out).toContain('Ana Reyes — Recruiting')
    // The visible time is localized to whoever is reading, so the assertion is on the
    // machine-readable one the <time> element carries.
    expect(out).toMatch(/datetime="2026-09-03T21:00:00\.000Z"/i)
  })

  it('opens the round page from a chip that answers the pointer and names itself', () => {
    const out = html()
    expect(out).toContain('href="/applications/app-1/interviews/r-1"')
    // A chip is a label everywhere else in the product, so this one has to say it is a link.
    expect(out).toMatch(/class="[^"]*hover:border-accent[^"]*"/)
    // Two rounds of the same kind would otherwise be two links both named "Recruiter screen".
    expect(out).toMatch(/aria-label="Open Recruiter screen round, [^"]+"/)
  })

  it('names the chip without a time when the notice stated none', () => {
    expect(html({ datetime: undefined })).toContain('aria-label="Open Recruiter screen round"')
  })

  it('says the notice stated no time rather than showing a blank, and hides the export', () => {
    const out = html({ datetime: undefined })
    expect(out).toContain('Time not stated')
    expect(out).not.toContain('Add to calendar')
  })

  it('offers the calendar export when there is a time to export', () => {
    expect(html()).toContain('Add to calendar')
  })

  it('shows what the notice did not say, with why it is being asked', () => {
    const out = html()
    expect(out).toContain('Is there a take-home after this?')
    expect(out).toContain('The notice does not say.')
    // Amber means one thing in this product: only you know this.
    expect(out).toContain('border-amber')
  })

  it('renders all five sections of the brief', () => {
    const out = html()
    expect(out).toContain('What this round probes')
    expect(out).toContain('Questions to prepare')
    expect(out).toContain('Questions to ask back')
    expect(out).toContain('Facts to rehearse')
    expect(out).toContain('Where this could go wrong')

    expect(out).toContain('Why this role, and what you know about the ledger rewrite')
    expect(out).toContain('Walk me through your background.')
    expect(out).toContain('f1 — the payments service at 99.95%')
    expect(out).toContain('Who owns reconciliation today, and what breaks most often?')
    expect(out).toContain('Cut p99 checkout latency from 840ms to 210ms by batching ledger writes')
    expect(out).toContain('Three years against a stated five-year minimum')
  })

  it('says the brief could not be written only for the round that just failed', () => {
    const failed = html({ prepBrief: undefined }, true)
    expect(failed).toContain('The brief couldn’t be written')
    expect(failed).toContain('Recruiter screen')

    // An older round that simply has no brief stays quiet about it.
    const quiet = html({ prepBrief: undefined })
    expect(quiet).not.toContain('couldn’t be written')
  })

  it('renders a round with no interviewers and no open questions', () => {
    const out = html({ people: [], askHuman: undefined })
    expect(out).not.toContain('With ')
    expect(out).toContain('Recruiter screen')
  })
})

describe('BriefView', () => {
  it('renders nothing at all when every section is empty', () => {
    const empty: PrepBrief = {
      likelyTopics: [],
      questionsToPrepare: [],
      questionsToAsk: [],
      factsToRehearse: [],
      redFlags: [],
    }
    expect(renderToStaticMarkup(createElement(BriefView, { brief: empty }))).toBe('')
  })

  it('drops only the sections that are empty', () => {
    const partial: PrepBrief = { ...brief, redFlags: [], questionsToAsk: [] }
    const out = renderToStaticMarkup(createElement(BriefView, { brief: partial }))
    expect(out).toContain('What this round probes')
    expect(out).not.toContain('Where this could go wrong')
    expect(out).not.toContain('Questions to ask back')
  })
})
