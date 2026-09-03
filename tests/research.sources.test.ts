import { describe, it, expect } from 'vitest'
import { guessCompanyHost, hostOf, isFetchable, mergeSources, normalizeUrl, rankGuides, sourceKind, titledByHost } from '@/lib/research/sources'
import type { ResearchSource } from '@/lib/types'

describe('hostOf / normalizeUrl', () => {
  it('reads the host without www and lowercased', () => {
    expect(hostOf('https://WWW.Reddit.com/r/cscareerquestions/x')).toBe('reddit.com')
    expect(hostOf('not a url')).toBe('')
  })
  it('normalises away the noise that makes one page look like two', () => {
    const a = normalizeUrl('https://www.example.com/post/?utm_source=x&id=3#top')
    const b = normalizeUrl('https://example.com/post?id=3')
    expect(a).toBe(b)
    expect(a).toBe('https://example.com/post?id=3')
  })
  it('drops a trailing slash from a path, and leaves a bare origin the one slash it has', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/')
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a')
  })
})

describe('guessCompanyHost', () => {
  it('slugs a company name into a host, and gives up on a name with no letters in it', () => {
    expect(guessCompanyHost('Marram Systems')).toBe('marramsystems.com')
    expect(guessCompanyHost('!!!')).toBeUndefined()
  })
})

describe('sourceKind', () => {
  const ctx = { postingHost: 'jobs.ashbyhq.com', companyHost: 'marram.dev' }
  it('knows the posting, the company, the communities, and calls the rest guides', () => {
    expect(sourceKind('https://jobs.ashbyhq.com/marram/123', ctx)).toBe('posting')
    expect(sourceKind('https://www.marram.dev/careers/interviewing', ctx)).toBe('company')
    expect(sourceKind('https://www.reddit.com/r/x/y', ctx)).toBe('community')
    expect(sourceKind('https://www.teamblind.com/post/z', ctx)).toBe('community')
    expect(sourceKind('https://www.glassdoor.com/Interview/x', ctx)).toBe('community')
    expect(sourceKind('https://www.glassdoor.de/Interview/x', ctx)).toBe('community')
    expect(sourceKind('https://news.ycombinator.com/item?id=1', ctx)).toBe('community')
    expect(sourceKind('https://someone.substack.com/p/how-i-got-in', ctx)).toBe('guide')
  })
})

describe('mergeSources', () => {
  const ctx = { postingHost: 'jobs.ashbyhq.com', companyHost: 'marram.dev' }
  it('dedupes on the normalised url, keeps the first title, unions the snippets, numbers ids', () => {
    const merged = mergeSources(
      [
        { url: 'https://www.reddit.com/r/a/1/?utm_source=g', title: 'Thread', snippet: 'first' },
        { url: 'https://reddit.com/r/a/1', title: 'Thread (dup)', snippet: 'second' },
        { url: 'https://blog.example.com/x', title: 'Blog', snippet: 'blog', publishedAt: '2025-03-01' },
      ],
      ctx,
    )
    expect(merged.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(merged[0].title).toBe('Thread')
    expect(merged[0].snippet).toBe('first … second')
    expect(merged[0].kind).toBe('community')
    expect(merged[0].fetched).toBe(false)
    expect(merged[1].publishedAt).toBe('2025-03-01')
  })
  it('drops candidates whose url does not parse', () => {
    expect(mergeSources([{ url: 'nope', title: 't', snippet: 's' }], ctx)).toEqual([])
  })
  it('drops every scheme but http and https, which the rest of the pipeline would trust', () => {
    const hostile = [
      { url: 'file:///etc/passwd', title: 'f', snippet: '' },
      { url: 'javascript:alert(1)', title: 'j', snippet: '' },
      { url: 'data:text/plain,x', title: 'd', snippet: '' },
    ]
    expect(mergeSources(hostile, ctx)).toEqual([])
    const web = mergeSources(
      [
        { url: 'http://plain.example.com/a', title: 'h', snippet: '' },
        { url: 'https://secure.example.com/b', title: 's', snippet: '' },
      ],
      ctx,
    )
    expect(web.map((s) => s.url)).toEqual(['http://plain.example.com/a', 'https://secure.example.com/b'])
  })
  it('names an untitled candidate by its host, and caps a long title at 160', () => {
    // A URL is not a name. The host at least says who is talking, and `titledByHost` reads it
    // as the absence it is, so a page with a path can still be named from that path later.
    const merged = mergeSources(
      [{ url: 'https://blog.example.com/', title: '   ', snippet: '' }, { url: 'https://a.com/1', title: 'x'.repeat(300), snippet: '' }],
      ctx,
    )
    expect(merged[0].title).toBe('blog.example.com')
    expect(titledByHost(merged[0])).toBe(true)
    expect(merged[1].title).toHaveLength(160)
  })
  it('caps a unioned snippet at 600 characters', () => {
    const long = 'x'.repeat(500)
    const merged = mergeSources(
      [{ url: 'https://a.com/1', title: 'a', snippet: long }, { url: 'https://a.com/1', title: 'a', snippet: long }],
      ctx,
    )
    expect(merged[0].snippet.length).toBeLessThanOrEqual(600)
  })
})

describe('isFetchable', () => {
  const src = (url: string): ResearchSource => ({ id: 's', title: '', url, host: hostOf(url), kind: 'guide', snippet: '', fetched: false })
  it('refuses the hosts that serve challenge pages, including subdomains', () => {
    for (const u of ['https://www.glassdoor.com/x', 'https://uk.glassdoor.co.uk/x', 'https://www.glassdoor.de/x', 'https://www.glassdoor.com.au/x', 'https://www.teamblind.com/x', 'https://www.linkedin.com/x', 'https://www.levels.fyi/x', 'https://www.indeed.com/x']) {
      expect(isFetchable(src(u))).toBe(false)
    }
    expect(isFetchable(src('https://www.reddit.com/r/x/1'))).toBe(true)
    expect(isFetchable(src('https://blog.example.com/x'))).toBe(true)
  })
})

describe('titledByHost', () => {
  const src = (title: string, url: string): ResearchSource =>
    ({ id: 's', title, url, host: hostOf(url), kind: 'guide', snippet: '', fetched: false })
  it('knows a title that is only a domain the page sits under', () => {
    expect(titledByHost(src('', 'https://blog.example.com/x'))).toBe(true)
    expect(titledByHost(src('blog.example.com', 'https://blog.example.com/x'))).toBe(true)
    // How grounding named three different postings in one run, and one Medium page in another.
    expect(titledByHost(src('ashbyhq.com', 'https://jobs.ashbyhq.com/trm/1'))).toBe(true)
    expect(titledByHost(src('medium.com', 'https://arpita0412.medium.com/my-interview'))).toBe(true)
    expect(titledByHost(src('https://blog.example.com/x', 'https://blog.example.com/x'))).toBe(true)
  })
  it('leaves a real title alone, including one that reads like a name', () => {
    expect(titledByHost(src('How I got in at Marram', 'https://blog.example.com/x'))).toBe(false)
    expect(titledByHost(src('Vercel', 'https://vercel.com/careers'))).toBe(false)
    // A domain, but not this page's: somebody wrote it, so it is a title.
    expect(titledByHost(src('stripe.com', 'https://blog.example.com/x'))).toBe(false)
  })
})

describe('rankGuides', () => {
  const s = (over: Partial<ResearchSource>): ResearchSource => ({
    id: 's', title: '', url: 'https://x.com/', host: 'x.com', kind: 'guide', snippet: '', fetched: false, ...over,
  })
  it('puts a recent community thread naming the company first, the posting last', () => {
    const ranked = rankGuides(
      [
        s({ id: 'posting', kind: 'posting', title: 'Senior Backend Engineer' }),
        s({ id: 'blog', kind: 'guide', title: 'How I prepared for backend interviews', snippet: 'general advice', publishedAt: '2025-06-01' }),
        s({ id: 'reddit', kind: 'community', host: 'reddit.com', title: 'Marram Systems interview experience', snippet: 'Marram', publishedAt: '2026-01-10' }),
        s({ id: 'old', kind: 'community', host: 'reddit.com', title: 'Marram Systems interview', snippet: '', publishedAt: '2021-01-01' }),
      ],
      'Marram Systems',
      '2026-09-02T00:00:00.000Z',
    )
    expect(ranked.map((r) => r.id)).toEqual(['reddit', 'old', 'blog', 'posting'])
  })
  it('reads the company’s own interviewing page before a thread about it', () => {
    const ranked = rankGuides(
      [
        s({ id: 'reddit', kind: 'community', host: 'reddit.com', title: 'reddit.com', snippet: 'Marram Systems loop', publishedAt: '2026-01-10' }),
        s({ id: 'board', kind: 'guide', host: 'bebee.com', title: 'Marram Systems interview', snippet: 'Marram Systems' }),
        // Grounding names a page by its bare domain, so the path is what says what it is.
        s({ id: 'company', kind: 'company', host: 'marramsystems.com', url: 'https://marramsystems.com/careers/interviewing', title: 'marramsystems.com' }),
      ],
      'Marram Systems',
      '2026-09-02T00:00:00.000Z',
    )
    expect(ranked[0].id).toBe('company')
  })
  it('weighs the company’s own writing like a guide, even when it is not the process page', () => {
    const ranked = rankGuides(
      [
        // Named by its bare domain, which is how grounding names most of what it returns.
        s({ id: 'bare', kind: 'guide', host: 'jobsearcher.com', title: 'jobsearcher.com' }),
        // Not `/interviewing`, so it gets none of the process page's lead — only its own
        // account of the team, which is still nobody's paraphrase.
        s({ id: 'blog', kind: 'company', host: 'marramsystems.com', url: 'https://marramsystems.com/blog/engineering-culture', title: 'Engineering at Marram Systems' }),
      ],
      'Marram Systems',
      '2026-09-02T00:00:00.000Z',
    )
    expect(ranked.map((r) => r.id)).toEqual(['blog', 'bare'])
  })
  it('ranks a prep aggregator below a personal blog carrying the same signals', () => {
    // Both say "interview", both name the company, both are dated the same week. The only
    // difference is that one of them generates a page per company and invents the specifics.
    const same = { title: 'Marram Systems interview process', snippet: 'Marram Systems rounds', publishedAt: '2026-06-01' }
    const ranked = rankGuides(
      [
        s({ id: 'aggregator', host: 'designgurus.io', ...same }),
        s({ id: 'blog', host: 'someone.github.io', ...same }),
      ],
      'Marram Systems',
      '2026-09-02T00:00:00.000Z',
    )
    expect(ranked.map((r) => r.id)).toEqual(['blog', 'aggregator'])
  })
  it('does not mutate its input', () => {
    const input = [s({ id: 'a' }), s({ id: 'b', kind: 'community' })]
    rankGuides(input, 'X', '2026-09-02T00:00:00.000Z')
    expect(input.map((x) => x.id)).toEqual(['a', 'b'])
  })
})
