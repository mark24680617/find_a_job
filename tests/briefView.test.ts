import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BriefView } from '@/components/interviews/BriefView'
import type { PrepBrief, ResearchSource } from '@/lib/types'

// BriefView imports nothing but types, so this file needs none of the module mocks the other
// component tests carry. What it is here to hold is the one rule the citation has: a sourceId
// is shown only when we are holding the source it names.

const sources: ResearchSource[] = [
  {
    id: 's1',
    title: 'My Stripe onsite, start to finish',
    url: 'https://www.reddit.com/r/cscareerquestions/comments/abc/',
    host: 'reddit.com',
    kind: 'community',
    snippet: '',
    fetched: true,
  },
]

const brief = (questionsToPrepare: PrepBrief['questionsToPrepare']): PrepBrief => ({
  likelyTopics: ['How you reason about money movement'],
  questionsToPrepare,
  questionsToAsk: ['Who owns reconciliation today?'],
  factsToRehearse: ['Cut p99 checkout latency from 840ms to 210ms'],
  redFlags: [],
})

const html = (b: PrepBrief, s?: ResearchSource[]) =>
  renderToStaticMarkup(createElement(BriefView, { brief: b, sources: s }))

describe('BriefView — who reported the question', () => {
  it('names the guide that reported a cited question, and links to it', () => {
    const out = html(
      brief([{ q: 'Walk me through a payment that failed.', angle: 'f1 — the ledger rewrite', sourceId: 's1' }]),
      sources,
    )
    expect(out).toContain('Walk me through a payment that failed.')
    expect(out).toContain('reported by reddit.com')
    expect(out).toContain('href="https://www.reddit.com/r/cscareerquestions/comments/abc/"')
    // The link leaves the product, so it says so to the browser as every other outbound one does.
    expect(out).toContain('rel="noreferrer"')
  })

  it('says nothing when the id names a source we are not holding', () => {
    const out = html(
      brief([{ q: 'Walk me through a payment that failed.', angle: 'f1', sourceId: 's9' }]),
      sources,
    )
    expect(out).toContain('Walk me through a payment that failed.')
    expect(out).not.toContain('reported by')
    expect(out).not.toContain('<a')
  })

  it('says nothing when no sources were handed down at all', () => {
    const out = html(brief([{ q: 'Walk me through a payment that failed.', angle: 'f1', sourceId: 's1' }]))
    expect(out).not.toContain('reported by')
    expect(out).not.toContain('<a')
  })

  it('says nothing for a question the model wrote itself', () => {
    const out = html(brief([{ q: 'Why this team?', angle: 'f2 — the migration' }]), sources)
    expect(out).toContain('Why this team?')
    expect(out).not.toContain('reported by')
  })

  it('renders nothing at all when every section is empty', () => {
    const empty: PrepBrief = {
      likelyTopics: [],
      questionsToPrepare: [],
      questionsToAsk: [],
      factsToRehearse: [],
      redFlags: [],
    }
    expect(html(empty, sources)).toBe('')
  })
})
