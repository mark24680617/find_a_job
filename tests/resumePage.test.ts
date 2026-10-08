import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StoredResume } from '@/lib/types'

// The pair every component test here carries: `apiFetch` reaches for the browser's fetch and
// the signed-in user, and importing the Firebase client starts an app.
vi.mock('@/lib/firebase/client', () => ({ auth: {}, watchUser: vi.fn(), signOutUser: vi.fn(), readAdminClaim: vi.fn() }))
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { navItems } from '@/components/AppShell'
import { ResumePageClient } from '@/components/resume/ResumePageClient'
import { readFileSync } from 'node:fs'
import { UploadCard, fileProblem, takeFile } from '@/components/resume/UploadCard'

const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: '2026-09-21T09:00:00.000Z',
  filename: 'nadia-okonkwo-resume.pdf',
  bytes: 184_320,
  text: 'Nadia Okonkwo\nBackend engineer\n• Cut checkout latency by 40 percent.',
  lines: [], sections: [], entries: [], bullets: [],
  language: 'en',
  ...over,
})
type Props = Parameters<typeof UploadCard>[0]
const base: Props = {
  resume: null, profileFacts: 0, busy: false,
  onUpload: async () => {}, onDelete: async () => {},
}
const card = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(UploadCard, { ...base, ...over }))

describe('the Resume page in the frame', () => {
  it('puts Resume in the nav, after Profile', () => {
    expect(navItems(false)).toContainEqual({ href: '/profile/resume', label: 'Resume' })
  })
  it('opens with the line that says the document is being fetched, not that there is none', () => {
    // No effect runs in a static render, so this is the page exactly as it paints before the
    // GET lands — and an empty state painted there would be a claim the page cannot yet make.
    const markup = renderToStaticMarkup(createElement(ResumePageClient))
    expect(markup).toContain('Opening your resume…')
    expect(markup).not.toContain('No resume here yet.')
  })
  it('says what the page does in one sentence under the heading', () => {
    // Drawn only once the GET lands, which a static render never reaches, so the source is read.
    const page = readFileSync('src/components/resume/ResumePageClient.tsx', 'utf8')
    expect(page).toMatch(
      /Resume<\/h1>\s*<p[^>]*>\s*Upload your resume to check it, see what it’s missing, and rewrite the lines that fall short\.\s*<\/p>/,
    )
  })
})

describe('UploadCard — what it says when there is nothing stored', () => {
  it('asks for the PDF the person actually sends to employers', () => {
    expect(card()).toContain('No resume here yet. Upload the PDF you actually send to employers.')
  })
  it('says so when there are facts on file but no document behind them', () => {
    const out = card({ profileFacts: 15 })
    expect(out).toContain('No resume here yet. Upload the PDF you actually send to employers.')
    expect(out).toContain('You have a profile already, but no document here to check it against.')
  })
  it('keeps that second sentence off an account with no facts, and off one with a resume', () => {
    expect(card()).not.toContain('You have a profile already')
    expect(card({ resume: resume(), profileFacts: 15 })).not.toContain('You have a profile already')
  })
  it('offers no delete until there is something to delete', () => {
    expect(card()).not.toContain('Delete this resume')
    expect(card({ resume: resume() })).toContain('Delete this resume')
  })
})

describe('UploadCard — the disclosure', () => {
  it('says the resume is private to the account and can be deleted, stored or not', () => {
    const both = [card(), card({ resume: resume() })]
    for (const out of both) {
      expect(out).toContain('Your resume is private to your account, and you can delete it at any time.')
    }
  })
})

describe('UploadCard — the file the browser will not post', () => {
  it('says PDF only before anything is chosen, stored or not', () => {
    for (const out of [card(), card({ resume: resume() })]) expect(out).toContain('>PDF only.</p>')
  })
  it('refuses anything that is not a PDF', () => {
    expect(fileProblem({ type: 'application/msword', size: 1_000 })).toBe(
      'That isn’t a PDF. Export your resume as PDF and upload that.',
    )
  })
  it('refuses a PDF over the same cap the server enforces', () => {
    expect(fileProblem({ type: 'application/pdf', size: 6 * 1024 * 1024 + 1 })).toBe(
      'That PDF is over 6 MB. Try a smaller export.',
    )
    expect(fileProblem({ type: 'application/pdf', size: 6 * 1024 * 1024 })).toBe('')
  })
})

// Final review, ledger-1: the input stays mounted, and a browser fires no change for a choice at
// the path it already holds, so the same file chosen again (a re-export, a retry) did nothing.
describe('UploadCard — the same file chosen twice', () => {
  it('takes the file and empties the input behind it', () => {
    const file = new File(['%PDF-1.7'], 'r.pdf', { type: 'application/pdf' })
    const input = { files: [file], value: 'C:\\fakepath\\r.pdf' }
    expect(takeFile(input)).toBe(file)
    expect(input.value).toBe('')
    const none = { files: null, value: '' }
    expect(takeFile(none)).toBeUndefined()
  })
  it('is what the file input’s change handler reads through', () => {
    const source = readFileSync('src/components/resume/UploadCard.tsx', 'utf8')
    expect(source).toContain('onChange={(e) => choose(takeFile(e.target))}')
  })
})

describe('UploadCard — the stored document and its facts', () => {
  it('names the file and its size', () => {
    const out = card({ resume: resume() })
    expect(out).toContain('nadia-okonkwo-resume.pdf')
    expect(out).toContain('180 KB')
  })
  it('counts the facts it could find in this document, and the ones it could not', () => {
    const out = card({
      resume: resume({
        snippetCheck: {
          reviewedFrom: '2026-09-21T09:00:00.000Z',
          located: 31, total: 34,
          missing: ['led the migration off the monolith'],
        },
      }),
    })
    expect(out).toContain('31 of 34 of your facts can be found in this resume. 3 could not.')
    expect(out).toContain('led the migration off the monolith')
  })
  it('says so plainly when every fact is there, rather than counting to nothing', () => {
    const out = card({
      resume: resume({
        snippetCheck: { reviewedFrom: '2026-09-21T09:00:00.000Z', located: 34, total: 34, missing: [] },
      }),
    })
    expect(out).toContain('All 34 of your facts can be found in this resume.')
    expect(out).not.toContain('0 could not.')
  })
  it('says when that count was taken against an earlier upload', () => {
    const out = card({
      resume: resume({
        addedAt: '2026-09-22T09:00:00.000Z',
        snippetCheck: { reviewedFrom: '2026-09-21T09:00:00.000Z', located: 31, total: 34, missing: [] },
      }),
    })
    expect(out).toContain('Reviewed against an earlier upload.')
  })
})
