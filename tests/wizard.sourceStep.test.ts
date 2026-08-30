import { describe, it, expect, vi } from 'vitest'

// The import chain reaches `@/lib/firebase/client`, which builds a real Auth instance at
// module scope and throws outside a browser. Nothing under test touches it.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))

import { ApiError } from '@/lib/apiFetch'
import { isLinkedInSource, pasteRequest, readSource } from '@/components/wizard/SourceStep'

// The wizard's only branch on a failure: 422 + `needPaste` means the route could not fetch
// the posting and wants a paste, which opens the recovery box instead of showing an error.
// Everything else is an error. This is the contract `POST /api/applications` answers with
// (tests/routes.applications.test.ts pins the other side of it), and it is the one piece of
// the recovery path a suite without a DOM can reach.

const apiError = (status: number, body: unknown, message = 'boom') => new ApiError(message, status, body)

describe('pasteRequest', () => {
  it("returns the server's reason for a 422 that asks for a paste", () => {
    const err = apiError(422, { error: 'LinkedIn blocks fetching — paste the job description text instead', needPaste: true })
    expect(pasteRequest(err)).toBe('LinkedIn blocks fetching — paste the job description text instead')
  })

  it('falls back to the message when the 422 body carries no reason', () => {
    expect(pasteRequest(apiError(422, { needPaste: true }, 'could not fetch'))).toBe('could not fetch')
    expect(pasteRequest(apiError(422, { error: '', needPaste: true }, 'could not fetch'))).toBe('could not fetch')
  })

  it('is not a paste request without needPaste, whatever the status says', () => {
    expect(pasteRequest(apiError(422, { error: 'unprocessable' }))).toBeNull()
    expect(pasteRequest(apiError(422, { error: 'x', needPaste: 'yes' }))).toBeNull()
    expect(pasteRequest(apiError(422, 'plain text body'))).toBeNull()
    expect(pasteRequest(apiError(422, null))).toBeNull()
  })

  it('is not a paste request on any other status', () => {
    expect(pasteRequest(apiError(400, { error: 'send a url or jdText', needPaste: true }))).toBeNull()
    expect(pasteRequest(apiError(401, { error: 'unauthenticated' }))).toBeNull()
    expect(pasteRequest(apiError(500, { error: 'boom', needPaste: true }))).toBeNull()
  })

  it('is not a paste request for a failure that never reached the server', () => {
    expect(pasteRequest(new Error('Not signed in'))).toBeNull()
    expect(pasteRequest('422')).toBeNull()
    expect(pasteRequest(null)).toBeNull()
  })
})

// The single box holds either a link or the posting, and getting that wrong is silent: a link
// misread as a posting spends a model call and stores a junk record with no error anywhere.
describe('readSource', () => {
  it('takes anything with a scheme as the link, untouched', () => {
    expect(readSource('https://job-boards.greenhouse.io/vercel/jobs/6136160004')).toEqual({
      url: 'https://job-boards.greenhouse.io/vercel/jobs/6136160004',
      jdText: '',
      addedScheme: false,
    })
    expect(readSource('HTTP://boards.greenhouse.io/x').url).toBe('HTTP://boards.greenhouse.io/x')
  })

  it('finishes a link that was pasted without its scheme', () => {
    expect(readSource('job-boards.greenhouse.io/vercel/jobs/6136160004')).toEqual({
      url: 'https://job-boards.greenhouse.io/vercel/jobs/6136160004',
      jdText: '',
      addedScheme: true,
    })
    expect(readSource('www.linkedin.com/jobs/view/123').addedScheme).toBe(true)
    expect(readSource('jobs.ashbyhq.com/trm-labs/abc?utm=x#frag').url).toBe(
      'https://jobs.ashbyhq.com/trm-labs/abc?utm=x#frag',
    )
  })

  it('takes anything with whitespace in it as the posting', () => {
    const jd = 'Senior Backend Engineer\n\nMinimum 8 years. Based in Canada.'
    expect(readSource(jd)).toEqual({ url: '', jdText: jd, addedScheme: false })
    // A posting that mentions a URL is still a posting.
    expect(readSource('Apply at https://example.com/jobs — 8 years required').url).toBe('')
  })

  it('takes a dotless word as the posting, not a host', () => {
    expect(readSource('localhost').jdText).toBe('localhost')
    expect(readSource('Engineer').jdText).toBe('Engineer')
  })
})

/**
 * The one refusal the wizard can see coming. LinkedIn serves nothing to a non-browser client,
 * so the submit is guaranteed to fail — and the way round it (open the posting, follow "Apply
 * on company website", paste that address) is directions, not an error. Saying it before the
 * round trip is what turns a dead end into a next step, and this is the check that decides.
 */
describe('isLinkedInSource', () => {
  it('recognises a LinkedIn posting however it was pasted', () => {
    expect(isLinkedInSource('https://www.linkedin.com/jobs/view/123')).toBe(true)
    expect(isLinkedInSource('https://linkedin.com/jobs/view/123')).toBe(true)
    // A regional subdomain, and a link pasted without its scheme, are the same wall.
    expect(isLinkedInSource('https://uk.linkedin.com/jobs/view/123')).toBe(true)
    expect(isLinkedInSource('www.linkedin.com/jobs/view/123')).toBe(true)
    // Whitespace is not this function's to handle: it reads what `readSource` reads, and the
    // box is trimmed once before either of them sees it.
  })

  it('is false for every board we can actually read', () => {
    expect(isLinkedInSource('https://job-boards.greenhouse.io/vercel/jobs/1')).toBe(false)
    expect(isLinkedInSource('https://jobs.ashbyhq.com/trm-labs/abc')).toBe(false)
    expect(isLinkedInSource('https://jobs.lever.co/x/y')).toBe(false)
  })

  it('does not fire on a host that merely ends in the same letters', () => {
    // `notlinkedin.com` is somebody else's domain, and `linkedin.com.evil.test` is a trick.
    expect(isLinkedInSource('https://notlinkedin.com/jobs/view/1')).toBe(false)
    expect(isLinkedInSource('https://linkedin.com.evil.test/jobs/view/1')).toBe(false)
  })

  it('is false for a posting that only talks about LinkedIn', () => {
    // Pasted text is never a link, so it never gets the hint — it is already past the fetch.
    expect(isLinkedInSource('Apply via https://www.linkedin.com/jobs/view/1 — 8 years required')).toBe(
      false,
    )
    expect(isLinkedInSource('')).toBe(false)
  })
})
