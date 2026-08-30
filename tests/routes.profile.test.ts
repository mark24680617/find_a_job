import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Profile } from '@/lib/types'

// The three handlers with everything behind them faked: no Admin SDK, no model call. What
// is under test is the contract Task 6 codes against — status codes, what reaches the db,
// and what a bad body does before it can overwrite someone's vault.

const { requireUser, getProfile, setProfile, runProfileIngest } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProfile: vi.fn(),
  setProfile: vi.fn(),
  runProfileIngest: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getProfile, setProfile }))
vi.mock('@/ai/flows/profileIngest', () => ({ runProfileIngest }))
// The network is faked; `@/adapters/html` (pure) and `@/adapters/types` (the error class the
// route matches on with `instanceof`) are deliberately the real modules.
const { getGuardedText } = vi.hoisted(() => ({ getGuardedText: vi.fn() }))
vi.mock('@/adapters/http', () => ({ getGuardedText }))

import { GET, PUT } from '@/app/api/profile/route'
import { POST } from '@/app/api/profile/ingest/route'
import { FetchBlockedError } from '@/adapters/types'

const stored: Profile = {
  facts: [{ id: 'f1', claim: 'Owns the payments service', sourceSnippet: 'Owns it', tags: ['backend'] }],
  standardAnswers: { work_authorization: 'US citizen' },
  voiceRules: [{ rule: 'Lead with the number', evidence: 'moved 12k up', createdAt: '2026-08-01' }],
  gaps: ['no dates'],
}

const post = (body: unknown) =>
  new Request('https://example.test/api/profile/ingest', { method: 'POST', body: JSON.stringify(body) })

const put = (body: unknown) =>
  new Request('https://example.test/api/profile', { method: 'PUT', body: JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getProfile.mockResolvedValue(stored)
  setProfile.mockResolvedValue(undefined)
})

describe('GET /api/profile', () => {
  it('returns the stored profile', async () => {
    const res = await GET(new Request('https://example.test/api/profile'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(stored)
    expect(getProfile).toHaveBeenCalledWith('user-1')
  })

  it('hands back the guard 401 untouched', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await GET(new Request('https://example.test/api/profile'))).status).toBe(401)
    expect(getProfile).not.toHaveBeenCalled()
  })
})

describe('PUT /api/profile', () => {
  it('saves a well-formed profile verbatim', async () => {
    const res = await PUT(put(stored))
    expect(res.status).toBe(200)
    expect(setProfile).toHaveBeenCalledWith('user-1', stored)
  })

  it('writes only the four profile keys, never anything else the body carried', async () => {
    await PUT(put({ ...stored, isAdmin: true }))
    expect(setProfile).toHaveBeenCalledWith('user-1', stored)
  })

  it('400s on a body that is not a profile, without touching the db', async () => {
    for (const bad of [
      null,
      'a string',
      { ...stored, facts: 'not an array' },
      { ...stored, standardAnswers: { relocation: 42 } },
      { ...stored, gaps: [{ note: 'not a string' }] },
      // A fact without a string id survives storage and then crashes the next merge.
      { ...stored, facts: [{ claim: 'no id here', sourceSnippet: 's', tags: [] }] },
      { ...stored, voiceRules: [{ rule: 'no evidence' }] },
    ]) {
      expect((await PUT(put(bad))).status).toBe(400)
    }
    expect(setProfile).not.toHaveBeenCalled()
  })
})

describe('POST /api/profile/ingest', () => {
  const extracted = {
    facts: [{ id: 'f1', claim: 'Cut p99 to 210ms', sourceSnippet: 'Cut p99', tags: ['perf'] }],
    standardAnswers: { work_authorization: 'UNKNOWN', notice_period: 'two weeks' },
    gaps: ['no links'],
  }

  it('merges the ingest into the stored profile and returns the result', async () => {
    runProfileIngest.mockResolvedValue(extracted)
    const res = await POST(post({ pastedText: 'a resume' }))

    expect(runProfileIngest).toHaveBeenCalledWith({ pdfBase64: undefined, pastedText: 'a resume' })
    const merged = {
      facts: [...stored.facts, { ...extracted.facts[0], id: 'f2' }],
      // 'US citizen' survived the incoming UNKNOWN; the real value was taken.
      standardAnswers: { work_authorization: 'US citizen', notice_period: 'two weeks' },
      voiceRules: stored.voiceRules,
      gaps: ['no links'],
    }
    expect(setProfile).toHaveBeenCalledWith('user-1', merged)
    await expect(res.json()).resolves.toEqual(merged)
  })

  it('passes a PDF through to the flow', async () => {
    runProfileIngest.mockResolvedValue(extracted)
    await POST(post({ pdfBase64: 'JVBERi0=' }))
    expect(runProfileIngest).toHaveBeenCalledWith({ pdfBase64: 'JVBERi0=', pastedText: undefined })
  })

  it('400s when the body carries neither input, without calling the model', async () => {
    for (const bad of [{}, { pastedText: '' }, { pdfBase64: 42 }, null]) {
      expect((await POST(post(bad))).status).toBe(400)
    }
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('401s before spending an API call', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"invalid token"}', { status: 401 }))
    expect((await POST(post({ pastedText: 'a resume' }))).status).toBe(401)
    expect(runProfileIngest).not.toHaveBeenCalled()
  })
})

/**
 * The third way into the vault: an address instead of a document. The page behind it is read
 * as though it had been pasted — same flow, same merge — so what is worth pinning is the
 * boundary around it: what gets fetched, what never does, and that a refusal arrives as a
 * sentence the profile screen can show rather than as a half-written profile.
 */
describe('POST /api/profile/ingest — from a URL', () => {
  const extracted = {
    facts: [{ id: 'f1', claim: 'Built Tessellate', sourceSnippet: 'Built Tessellate', tags: ['projects'] }],
    standardAnswers: {},
    gaps: [],
  }

  // Long enough to clear the "this page is drawn by JavaScript" floor.
  const prose = 'I build small tools for musicians. '.repeat(12)
  const page = `<html><head><title>About</title></head><body><nav>Home</nav><p>${prose}</p></body></html>`

  beforeEach(() => {
    runProfileIngest.mockResolvedValue(extracted)
  })

  it('fetches the page, reads it as pasted text, and merges the result', async () => {
    getGuardedText.mockResolvedValue({ status: 200, text: page })
    const res = await POST(post({ url: 'https://markqiu.dev/about' }))

    expect(res.status).toBe(200)
    // A URL object, not the raw string: `getGuardedText` is what checks the address and every
    // redirect hop after it against the private ranges this server can otherwise reach.
    expect(getGuardedText.mock.calls[0][0]).toBeInstanceOf(URL)
    expect(String(getGuardedText.mock.calls[0][0])).toBe('https://markqiu.dev/about')

    const sent = runProfileIngest.mock.calls[0][0] as { pastedText?: string }
    expect(sent.pastedText).toContain('From https://markqiu.dev/about:')
    expect(sent.pastedText).toContain('I build small tools for musicians.')
    // Chrome is stripped on the way through, so the model never sees the site's navigation.
    expect(sent.pastedText).not.toContain('<p>')
    expect(setProfile).toHaveBeenCalled()
  })

  it('joins pasted notes and the fetched page into one reading', async () => {
    getGuardedText.mockResolvedValue({ status: 200, text: page })
    await POST(post({ pastedText: 'I left a job off my resume.', url: 'https://markqiu.dev/about' }))

    const sent = runProfileIngest.mock.calls[0][0] as { pastedText?: string }
    expect(sent.pastedText).toContain('I left a job off my resume.')
    expect(sent.pastedText).toContain('I build small tools for musicians.')
  })

  it('refuses a LinkedIn profile before spending the request, and says what to do instead', async () => {
    for (const url of [
      'https://www.linkedin.com/in/mark',
      'https://linkedin.com/in/mark',
      'https://uk.linkedin.com/in/mark',
    ]) {
      const res = await POST(post({ url }))
      expect(res.status).toBe(422)
      await expect(res.json()).resolves.toEqual({
        error:
          'LinkedIn blocks reading profiles — paste your About and Experience text into Pasted notes instead.',
      })
    }
    expect(getGuardedText).not.toHaveBeenCalled()
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('turns a blocked address into a 422 worded for this screen, changing nothing', async () => {
    getGuardedText.mockRejectedValue(
      new FetchBlockedError('That address isn’t reachable from here — paste the job description text instead'),
    )
    const res = await POST(post({ url: 'http://169.254.169.254/latest/meta-data' }))

    expect(res.status).toBe(422)
    // The cause is the fetch layer's to state; the instruction is this page's — there is no
    // job description here to paste.
    await expect(res.json()).resolves.toEqual({
      error: 'That address isn’t reachable from here — paste the page’s text into Pasted notes instead',
    })
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('422s on a page that answered with an error, or had nothing readable on it', async () => {
    getGuardedText.mockResolvedValue({ status: 404, text: '' })
    expect((await POST(post({ url: 'https://markqiu.dev/gone' }))).status).toBe(422)

    getGuardedText.mockResolvedValue({ status: 200, text: '<html><body><div id="root"></div></body></html>' })
    const res = await POST(post({ url: 'https://markqiu.dev/app' }))
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('almost no readable text'),
    })

    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('422s on something that is not a web address at all', async () => {
    for (const url of ['markqiu.dev/about', 'file:///etc/passwd', 'not a url']) {
      expect((await POST(post({ url }))).status).toBe(422)
    }
    expect(getGuardedText).not.toHaveBeenCalled()
  })
})
