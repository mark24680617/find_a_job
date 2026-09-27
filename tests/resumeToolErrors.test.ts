import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GapsResult, StoredResume } from '@/lib/types'

vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn(), ApiError: class ApiError extends Error {} }))

import { NOTHING_TO_COMPARE } from '@/components/resume/copy'
import { DiagnoseSection } from '@/components/resume/DiagnoseSection'
import { GapsSection } from '@/components/resume/GapsSection'
import { RewriteSection, type RewriteProposal } from '@/components/resume/RewriteSection'
import { ErrorLine, type ToolError } from '@/components/resume/ToolError'
import { UploadCard } from '@/components/resume/UploadCard'

// Final review, page-5: a failed press says so beside the control that was pressed, not in one
// alert above the upload card, screens away from Compare or "Write these again".

const at = (where: NonNullable<ToolError>['at'], text = 'That comparison didn’t finish.'): ToolError => ({ at: where, text })
/** The alert's position, and that it holds the text. */
const alertAt = (out: string, text: string) => {
  const i = out.indexOf('role="alert"')
  expect(i).toBeGreaterThan(-1)
  expect(out.indexOf(text, i)).toBeGreaterThan(i)
  return i
}

const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: '2026-09-21T09:00:00.000Z', filename: 'r.pdf', bytes: 1_024, text: 'x',
  lines: [], sections: [], entries: [], language: 'en',
  bullets: [{ id: 'b1', entryIndex: 0, lines: [4], text: 'Worked on checkout performance.' }],
  diagnose: {
    reviewedFrom: '2026-09-21T09:00:00.000Z', judge: 'jev', ranAt: '2026-09-21T09:05:00.000Z',
    checks: [{ checkId: 'file-size', state: 'pass', source: 'Greenhouse' }], findings: [],
    judgements: [{ bulletId: 'b1', questionId: 'result', noul: 0.06, verdict: 'fail', model: 'jev-1.13.0', judge: 'jev' }],
  },
  ...over,
})

describe('ErrorLine', () => {
  it('draws the sentence only for the control that sent the request', () => {
    const r = (e: ToolError) => renderToStaticMarkup(createElement(ErrorLine, { error: e, at: 'gaps' }))
    expect(r(at('gaps', 'No.'))).toMatch(/^<p role="alert" class="max-w-\[62ch\] text-sm text-danger">No\.<\/p>$/)
    expect(r(at('diagnose', 'No.'))).toBe('')
    expect(r(null)).toBe('')
  })
})

describe('each section draws its own failure beside its trigger', () => {
  it('Diagnose: under Run the checks, above the table, and nowhere for another section', () => {
    const r = (e: ToolError) => renderToStaticMarkup(createElement(DiagnoseSection, {
      resume: resume(), busy: false, error: e, onRun: async () => {}, onAnswerAsk: async () => {},
    }))
    const out = r(at('diagnose', 'That check didn’t finish, and nothing was stored. Try again.'))
    const i = alertAt(out, 'That check didn’t finish')
    expect(i).toBeGreaterThan(out.indexOf('>Check it again<'))
    expect(i).toBeLessThan(out.indexOf('>Who documents this<'))
    expect(r(at('gaps'))).not.toContain('role="alert"')
    expect(r(at('diagnose-asks'))).toContain('role="alert"')
  })
  it('Gaps: R35’s empty-candidates refusal sits under Compare', () => {
    const gaps: GapsResult = {
      reviewedFrom: '2026-09-21T09:00:00.000Z', judge: 'jev', ranAt: '2026-09-21T09:10:00.000Z',
      roleFamily: 'Software Developers', postingsUsed: 0, onetRelease: '29.2',
      skills: [{ name: 'Kubernetes', bucket: 3, inPostings: true, namedInResume: false, judgement: null, evidence: { posting: 'Keeps the Kubernetes clusters patched', resume: null, bank: null } }],
    }
    const r = (e: ToolError) => renderToStaticMarkup(createElement(GapsSection, {
      resume: resume({ gaps }), postingsAvailable: 0, busy: false, error: e,
      onRun: async () => {}, onAnswerAsk: async () => {},
    }))
    const out = r(at('gaps', NOTHING_TO_COMPARE))
    const i = alertAt(out, NOTHING_TO_COMPARE)
    expect(i).toBeGreaterThan(out.indexOf('>Compare again<'))
    expect(i).toBeLessThan(out.indexOf('Kubernetes'))
    const asks = r(at('gaps-asks', 'That answer didn’t save. Try again.'))
    expect(alertAt(asks, 'That answer didn’t save.')).toBeGreaterThan(asks.indexOf('Have you done this? · Kubernetes'))
    expect(r(at('rewrite'))).not.toContain('role="alert"')
  })
  it('Rewrite: under Write these again, and under the Accept of the card that failed', () => {
    const proposal: { rewrites: RewriteProposal[] } = {
      rewrites: [{ bulletId: 'b1', text: 'Cut latency.', citations: [], askHuman: [], skipped: null }],
    }
    const r = (e: ToolError) => renderToStaticMarkup(createElement(RewriteSection, {
      resume: resume(), proposal, facts: [], busy: false, error: e,
      onRun: async () => {}, onAccept: async () => {}, onAnswerAsk: async () => {},
    }))
    const run = r(at('rewrite', 'That rewrite didn’t finish, and nothing was stored. Try again.'))
    const i = alertAt(run, 'That rewrite didn’t finish')
    expect(i).toBeGreaterThan(run.indexOf('>Write these again<'))
    expect(i).toBeLessThan(run.indexOf('>Accept this line<'))
    const accept = r(at('accept-b1', 'That didn’t save, and nothing was changed. Try again.'))
    expect(alertAt(accept, 'That didn’t save')).toBeGreaterThan(accept.indexOf('>Accept this line<'))
    expect(r(at('accept-b2'))).not.toContain('role="alert"')
    expect(r(at('diagnose'))).not.toContain('role="alert"')
  })
  it('Upload: the page’s sentence is the card’s one alert line', () => {
    const r = (error: string) => renderToStaticMarkup(createElement(UploadCard, {
      resume: null, profileFacts: 0, busy: false, error, onUpload: async () => {}, onDelete: async () => {},
    }))
    const out = r('That upload didn’t finish, and nothing was stored. Try again.')
    expect(out.split('role="alert"')).toHaveLength(2)
    expect(alertAt(out, 'That upload didn’t finish')).toBeGreaterThan(out.indexOf('Choose a PDF'))
    expect(r('')).not.toContain('role="alert"')
  })
})
