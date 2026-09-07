import { describe, it, expect, vi, beforeEach } from 'vitest'

// The one place that decides what a brief behind a link is. The network is faked; the rewrite
// (`@/lib/assignment`), the HTML stripper (`@/adapters/html`) and the error class the route
// matches on with `instanceof` (`@/adapters/types`) are deliberately the real modules, because
// what is under test is the routing between them.
const { getGuardedText } = vi.hoisted(() => ({ getGuardedText: vi.fn() }))
vi.mock('@/adapters/http', () => ({ getGuardedText }))

import { readBrief } from '@/lib/readBrief'
import { FetchBlockedError } from '@/adapters/types'

/** What the guarded fetcher answers with, defaulted so each test names only what it is about. */
const answers = (over: { status?: number; text?: string; contentType?: string } = {}) =>
  getGuardedText.mockResolvedValue({ status: 200, text: '', contentType: '', ...over })

/** The address the fetcher was actually handed — the rewrite is only visible here. */
const fetchedUrl = () => String(getGuardedText.mock.calls[0][0])

beforeEach(() => {
  vi.resetAllMocks()
})

describe('readBrief — what it refuses before spending a request', () => {
  it('refuses something that is not a web address', async () => {
    await expect(readBrief('the brief is in the attachment')).rejects.toThrow(
      'That is not a web address — paste the brief’s text instead',
    )
    expect(getGuardedText).not.toHaveBeenCalled()
  })

  it('refuses LinkedIn, which would only answer with a wall', async () => {
    for (const raw of [
      'https://www.linkedin.com/in/someone',
      'https://linkedin.com/feed/update/1',
      'https://uk.linkedin.com/in/someone',
    ]) {
      await expect(readBrief(raw)).rejects.toThrow(FetchBlockedError)
      await expect(readBrief(raw)).rejects.toThrow(/paste the brief’s text instead$/)
    }
    expect(getGuardedText).not.toHaveBeenCalled()
  })
})

describe('readBrief — the address it fetches', () => {
  it('reads a Google Docs link at its plain-text export', async () => {
    answers({ text: 'Build a scheduler.', contentType: 'text/plain' })

    await readBrief('https://docs.google.com/document/d/1AbC_dEf/edit?usp=sharing')

    expect(fetchedUrl()).toBe('https://docs.google.com/document/d/1AbC_dEf/export?format=txt')
  })

  it('reads a GitHub blob link at its raw address', async () => {
    answers({ text: '# Take-home', contentType: 'text/markdown' })

    await readBrief('https://github.com/acme/take-home/blob/main/README.md')

    expect(fetchedUrl()).toBe('https://raw.githubusercontent.com/acme/take-home/main/README.md')
  })
})

describe('readBrief — what the content type says the body is', () => {
  it('refuses a link that answers with a PDF', async () => {
    answers({ text: 'binary noise', contentType: 'application/pdf' })

    await expect(readBrief('https://example.com/brief.pdf')).rejects.toThrow(
      'that link is a PDF — download it and add it as a file',
    )
  })

  it('refuses a body that begins %PDF- whatever the header claimed', async () => {
    answers({ text: '\n%PDF-1.7\n1 0 obj', contentType: 'application/octet-stream' })

    await expect(readBrief('https://example.com/brief')).rejects.toThrow(
      'that link is a PDF — download it and add it as a file',
    )
  })

  it('strips the markup off a page', async () => {
    answers({
      text: '<html><body><h1>Take-home</h1><p>Build a scheduler.</p></body></html>',
      contentType: 'text/html; charset=utf-8',
    })

    await expect(readBrief('https://example.com/brief')).resolves.toBe(
      'Take-home\n\nBuild a scheduler.',
    )
  })

  it('reads a body with no content type as a page, which is what most of them are', async () => {
    answers({ text: '<p>Build a scheduler.</p>', contentType: '' })

    await expect(readBrief('https://example.com/brief')).resolves.toBe('Build a scheduler.')
  })

  it('keeps a plain-text or markdown body exactly as it was served', async () => {
    const markdown = '# Take-home\n\n- Build a scheduler.\n- Write the tests.'
    for (const contentType of ['text/plain', 'text/markdown']) {
      answers({ text: markdown, contentType })
      await expect(readBrief('https://example.com/brief')).resolves.toBe(markdown)
    }
  })

  it('matches the media type before the parameters, whatever its case', async () => {
    answers({ text: '  Build a scheduler.\n\n', contentType: 'Text/Plain; charset=utf-8' })

    await expect(readBrief('https://example.com/brief')).resolves.toBe('Build a scheduler.')
  })
})

describe('readBrief — the reasons it hands back', () => {
  it('says which host answered with what, in this surface’s words', async () => {
    answers({ status: 404 })

    await expect(readBrief('https://example.com/brief')).rejects.toThrow(
      'example.com answered with 404 — paste the brief’s text instead',
    )
  })

  it('rewords a reason the fetcher threw', async () => {
    getGuardedText.mockRejectedValue(
      new FetchBlockedError('That link keeps redirecting — paste the job description text instead'),
    )

    await expect(readBrief('https://example.com/brief')).rejects.toThrow(
      'That link keeps redirecting — paste the brief’s text instead',
    )
  })

  it('lets a failure that is not the fetcher’s through untouched', async () => {
    getGuardedText.mockRejectedValue(new TypeError('fetch is not a function'))

    await expect(readBrief('https://example.com/brief')).rejects.toThrow(TypeError)
  })

  it('applies no length floor of its own — the route owns that rule', async () => {
    answers({ text: 'Do the job', contentType: 'text/plain' })

    await expect(readBrief('https://example.com/brief')).resolves.toBe('Do the job')
  })
})
