import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ResearchSource } from '@/lib/types'

// The two public APIs and the page reader, with the network faked at the one seam every
// adapter already uses. Under test: what a hit becomes, how a thread flattens to text a model
// can digest, which sources are read how, and that Google's grounding redirect resolves to the
// page behind it.

const { getJson, getGuardedText } = vi.hoisted(() => ({ getJson: vi.fn(), getGuardedText: vi.fn() }))
vi.mock('@/adapters/http', () => ({ getJson, getGuardedText, BROWSER_UA: 'ua' }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// Reddit is reachable only with an OAuth token, and whether there is one is an environment
// question answered in `redditAuth`. Here it is a switch: a token, or none.
const { redditToken } = vi.hoisted(() => ({ redditToken: vi.fn() }))
vi.mock('@/lib/research/redditAuth', () => ({ redditToken, REDDIT_UA: 'find-a-job-research/0.1' }))

import {
  flattenHnItem, flattenRedditThread, readSource, resolveGroundingUrl, searchHackerNews, searchReddit,
} from '@/lib/research/community'

const fixture = (name: string) => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8')) as unknown

beforeEach(() => {
  vi.resetAllMocks()
  redditToken.mockResolvedValue('tok')
})

const redditOk = (json: unknown) => fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => json })

describe('searchReddit', () => {
  it('searches through the OAuth host with the token, keeping permalinks, dates, and the post text', async () => {
    redditOk(fixture('reddit-search'))
    const hits = await searchReddit('Marram Systems')
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://oauth.reddit.com/search?q=%22Marram%20Systems%22%20interview&sort=relevance&t=all&limit=10&raw_json=1',
    )
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      authorization: 'Bearer tok',
      'user-agent': 'find-a-job-research/0.1',
    })
    expect(getJson).not.toHaveBeenCalled()
    expect(hits).toHaveLength(3)
    expect(hits[0]).toEqual({
      url: 'https://www.reddit.com/r/cscareerquestions/comments/abc123/marram_systems_interview/',
      title: 'Marram Systems interview experience (backend)',
      snippet: 'Recruiter screen, then a take-home, then a 4-round onsite.',
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(hits[1].snippet).toBe('')
  })
  it('keeps a hit whose timestamp is out of range, dateless, rather than losing the search', async () => {
    redditOk(fixture('reddit-search'))
    const hits = await searchReddit('Marram Systems')
    expect(hits[2].title).toBe('Marram Systems onsite loop')
    expect(hits[2].publishedAt).toBeUndefined()
    expect(hits[0].publishedAt).toBe('2026-01-01T00:00:00.000Z')
  })
  it('returns nothing on a refusal or a malformed body, never throws', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => null })
    await expect(searchReddit('X')).resolves.toEqual([])
    fetchMock.mockRejectedValue(new Error('down'))
    await expect(searchReddit('X')).resolves.toEqual([])
  })
  it('reads no Reddit at all when there is no token, without a request', async () => {
    redditToken.mockResolvedValue(null)
    await expect(searchReddit('Marram Systems')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getJson).not.toHaveBeenCalled()
  })
})

describe('searchHackerNews', () => {
  it('points a link post at the page it links to, and an answered Ask HN at its discussion', async () => {
    getJson.mockResolvedValue({ status: 200, json: fixture('hn-search') })
    const hits = await searchHackerNews('Marram Systems')
    expect(getJson.mock.calls[0][0]).toBe(
      'https://hn.algolia.com/api/v1/search?query=%22Marram%20Systems%22%20interview&tags=story&hitsPerPage=10',
    )
    expect(hits).toEqual([
      // The write-up itself, under the title HN gave it — not the comment page above it.
      {
        url: 'https://blog.example.com/marram-interview',
        title: 'How I interviewed at Marram Systems',
        snippet: '',
        publishedAt: '2026-02-14T09:00:00.000Z',
      },
      {
        url: 'https://news.ycombinator.com/item?id=39000001',
        title: 'Ask HN: Interviewing at Marram Systems?',
        snippet: '',
        publishedAt: '2025-11-02T10:00:00.000Z',
      },
      // A personal blog on someone's own github.io — the write-up the channel exists for.
      {
        url: 'https://someone.github.io/marram-interview',
        title: 'My Marram Systems interview, start to finish',
        snippet: '',
        publishedAt: '2026-04-01T10:00:00.000Z',
      },
    ])
  })
  it('drops a Show HN and the link posts that point at a page with no prose on it', async () => {
    getJson.mockResolvedValue({ status: 200, json: fixture('hn-search') })
    const urls = (await searchHackerNews('Marram Systems')).map((h) => h.url)
    // Somebody's interview-prep side project, not an account of anybody's loop.
    expect(urls).not.toContain('https://prep.example.com/marram')
    // A demo platform and a video page both read to their own chrome: below the 800-character
    // floor, and each one costs a read slot to find that out.
    expect(urls).not.toContain('https://marram-sim.vercel.app/')
    expect(urls).not.toContain('https://www.youtube.com/watch?v=abc123')
  })
  it('drops an Ask HN nobody answered, a press interview, and a story about the funding', async () => {
    getJson.mockResolvedValue({ status: 200, json: fixture('hn-search') })
    const urls = (await searchHackerNews('Marram Systems')).map((h) => h.url)
    // One comment is a headline and a shrug; there is nothing under it to digest.
    expect(urls).not.toContain('https://news.ycombinator.com/item?id=39000003')
    // "Co-Founder … Interviewed in Depth" is the other sense of the word entirely.
    expect(urls).not.toContain('https://podcast.example.com/marram')
    expect(urls).not.toContain('https://techcrunch.com/marram')
  })
  it('returns nothing on a refusal or a malformed body, never throws', async () => {
    getJson.mockResolvedValue({ status: 503, json: null })
    await expect(searchHackerNews('X')).resolves.toEqual([])
    getJson.mockResolvedValue({ status: 200, json: { hits: 'not an array' } })
    await expect(searchHackerNews('X')).resolves.toEqual([])
    getJson.mockRejectedValue(new Error('down'))
    await expect(searchHackerNews('X')).resolves.toEqual([])
  })
})

describe('flatteners', () => {
  it('flattens a Reddit thread to title, post, and the top comments by score, skipping deleted ones', () => {
    const text = flattenRedditThread(fixture('reddit-thread'))
    expect(text).toContain('Marram Systems interview experience (backend)')
    expect(text).toContain('The take-home was a small ledger service.')
    expect(text.indexOf('idempotent payments')).toBeLessThan(text.indexOf('How long did they give you'))
    expect(text).not.toContain('[deleted]')
  })
  it('flattens an HN item and its children to plain text', () => {
    const text = flattenHnItem(fixture('hn-item'))
    expect(text).toContain('Has anyone done their loop?')
    expect(text).toContain('Yes — recruiter call, take-home, then onsite.')
    expect(text).toContain('Take-home was 3 days.')
    expect(text).not.toContain('<p>')
  })
})

describe('readSource', () => {
  const src = (url: string): ResearchSource => ({ id: 's1', title: 't', url, host: new URL(url).hostname.replace(/^www\./, ''), kind: 'community', snippet: '', fetched: false })
  it('reads a Reddit thread through the OAuth host, not its HTML', async () => {
    redditOk(fixture('reddit-thread'))
    const read = await readSource(src('https://www.reddit.com/r/cscareerquestions/comments/abc123/marram_systems_interview'))
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth.reddit.com/r/cscareerquestions/comments/abc123/marram_systems_interview?raw_json=1')
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(read?.text).toContain('ledger service')
    // The title the poster wrote, which is what the evidence list should say instead of a host.
    expect(read?.title).toBe('Marram Systems interview experience (backend)')
    expect(getGuardedText).not.toHaveBeenCalled()
  })
  it('reads no Reddit thread when there is no token, without a request', async () => {
    redditToken.mockResolvedValue(null)
    await expect(readSource(src('https://www.reddit.com/r/cscareerquestions/comments/abc123/x'))).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reads an HN discussion through Algolia', async () => {
    getJson.mockResolvedValue({ status: 200, json: fixture('hn-item') })
    await readSource(src('https://news.ycombinator.com/item?id=39000001'))
    expect(getJson.mock.calls[0][0]).toBe('https://hn.algolia.com/api/v1/items/39000001')
  })
  it('carries the HN item’s own title back with the thread', async () => {
    getJson.mockResolvedValue({
      status: 200,
      json: { title: 'Ask HN: Interviewing at Marram Systems?', text: `<p>${'Detail. '.repeat(200)}</p>`, children: [] },
    })
    const read = await readSource(src('https://news.ycombinator.com/item?id=39000001'))
    expect(read?.title).toBe('Ask HN: Interviewing at Marram Systems?')
  })
  it('refuses a Reddit URL that is not a thread, without reaching the network', async () => {
    // `..` is normalised away by the URL parser, so the path that would be interpolated is
    // `/etc/passwd` — a real address on a real host, and not a thread.
    await expect(readSource(src('https://www.reddit.com/r/x/../../../etc/passwd'))).resolves.toBeNull()
    // Already percent-encoded, so the parser leaves it alone and the slug has to refuse it:
    // decoded on Reddit's side this would be `/r/x/comments/abc/../../api/v1/me`.
    await expect(readSource(src('https://www.reddit.com/r/x/comments/abc/%2e%2e%2f%2e%2e%2fapi%2fv1%2fme'))).resolves.toBeNull()
    await expect(readSource(src('https://www.reddit.com/r/cs/comments/abc123/title/extra'))).resolves.toBeNull()
    await expect(readSource(src('https://www.reddit.com/user/somebody'))).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('refuses an HN id that is not digits, without reaching the network', async () => {
    await expect(readSource(src('https://news.ycombinator.com/item?id=%2F..%2F..%2F..%2Fsettings'))).resolves.toBeNull()
    await expect(readSource(src('https://news.ycombinator.com/item?id=1%3Fx%3Dy'))).resolves.toBeNull()
    expect(getJson).not.toHaveBeenCalled()
  })
  it('reads anything else through the guarded fetcher and strips the HTML', async () => {
    getGuardedText.mockResolvedValue({ status: 200, text: `<html><body><h1>How I got in</h1><p>${'Detail. '.repeat(200)}</p></body></html>` })
    const read = await readSource(src('https://blog.example.com/how-i-got-in'))
    expect(getGuardedText.mock.calls[0][0]).toBeInstanceOf(URL)
    expect(read?.text).toContain('How I got in')
    expect(read?.text).not.toContain('<p>')
  })
  it('takes the page’s own title from the head, decoded and on one line', async () => {
    getGuardedText.mockResolvedValue({
      status: 200,
      text: `<html><head><title>\n  How I got in at\n  Marram &amp; Co\n</title></head><body><p>${'Detail. '.repeat(200)}</p></body></html>`,
    })
    const read = await readSource(src('https://blog.example.com/how-i-got-in'))
    expect(read?.title).toBe('How I got in at Marram & Co')
  })
  it('caps a page title at 160 characters, and has none when the head has none', async () => {
    const body = `<body><p>${'Detail. '.repeat(200)}</p></body>`
    getGuardedText.mockResolvedValue({ status: 200, text: `<html><head><title>${'t'.repeat(300)}</title></head>${body}</html>` })
    expect((await readSource(src('https://blog.example.com/a')))?.title).toHaveLength(160)
    getGuardedText.mockResolvedValue({ status: 200, text: `<html><head><title>   </title></head>${body}</html>` })
    expect((await readSource(src('https://blog.example.com/b')))?.title).toBeUndefined()
    getGuardedText.mockResolvedValue({ status: 200, text: `<html>${body}</html>` })
    expect((await readSource(src('https://blog.example.com/c')))?.title).toBeUndefined()
  })
  it('returns null for a thin page, a non-200, or a refusal', async () => {
    getGuardedText.mockResolvedValue({ status: 200, text: '<p>short</p>' })
    await expect(readSource(src('https://blog.example.com/a'))).resolves.toBeNull()
    getGuardedText.mockResolvedValue({ status: 404, text: 'x'.repeat(2000) })
    await expect(readSource(src('https://blog.example.com/b'))).resolves.toBeNull()
    getGuardedText.mockRejectedValue(new Error('blocked'))
    await expect(readSource(src('https://blog.example.com/c'))).resolves.toBeNull()
  })
  it('caps what it returns at 12,000 characters', async () => {
    getGuardedText.mockResolvedValue({ status: 200, text: `<p>${'word '.repeat(5000)}</p>` })
    const read = await readSource(src('https://blog.example.com/long'))
    expect(read?.text).toHaveLength(12_000)
  })
})

describe('resolveGroundingUrl', () => {
  it('follows Google’s redirect once and returns the page behind it', async () => {
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: 'https://www.reddit.com/r/x/1/' }) })
    await expect(resolveGroundingUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC')).resolves.toBe('https://www.reddit.com/r/x/1/')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual', method: 'HEAD' })
    // One of these runs per grounding URI, all at once: an untimed HEAD would hold the run.
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it('returns the input for a non-redirect host, a missing location, or a failure', async () => {
    await expect(resolveGroundingUrl('https://blog.example.com/x')).resolves.toBe('https://blog.example.com/x')
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue({ status: 200, headers: new Headers() })
    await expect(resolveGroundingUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/X')).resolves.toBe('https://vertexaisearch.cloud.google.com/grounding-api-redirect/X')
    fetchMock.mockRejectedValue(new Error('net'))
    await expect(resolveGroundingUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/Y')).resolves.toBe('https://vertexaisearch.cloud.google.com/grounding-api-redirect/Y')
  })
  it('resolves a relative Location against the redirect it came from', async () => {
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: '/elsewhere/page' }) })
    await expect(resolveGroundingUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC'))
      .resolves.toBe('https://vertexaisearch.cloud.google.com/elsewhere/page')
  })
  it('keeps the redirect when Location is not a page a browser would open', async () => {
    const uri = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC'
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: 'javascript:alert(1)' }) })
    await expect(resolveGroundingUrl(uri)).resolves.toBe(uri)
    fetchMock.mockResolvedValue({ status: 302, headers: new Headers({ location: 'file:///etc/passwd' }) })
    await expect(resolveGroundingUrl(uri)).resolves.toBe(uri)
  })
})
