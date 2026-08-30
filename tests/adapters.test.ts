import { readFileSync } from 'node:fs'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { detectAdapter, fetchPosting } from '@/adapters'
import { FetchBlockedError } from '@/adapters/types'
import { htmlToText } from '@/adapters/html'
import { assertReachableAddress } from '@/adapters/http'
import { ashbySlugCandidates, parseAshby } from '@/adapters/ashby'
import { parseGreenhouse } from '@/adapters/greenhouse'
import { parseLever } from '@/adapters/lever'
import { parseGeneric } from '@/adapters/genericFetch'

// The fixtures are real, trimmed payloads recorded from the live endpoints (TRM Labs on
// Ashby, Vercel on Greenhouse, Ro on Lever, a python.org job page for generic). Each keeps
// one posting with its description cut to a few hundred characters, so every assertion
// below is against a shape the vendor actually returns.

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const ashbyBoard = () => JSON.parse(fixture('ashby.json'))
const ASHBY_JOB_ID = 'deae2da1-6f6a-40ed-b64e-6596775a5473'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const stubFetch = (handler: (url: string) => Response) => {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL) => {
    calls.push(String(input))
    return handler(String(input))
  })
  return calls
}

describe('detectAdapter', () => {
  it('reads an Ashby hosted board', () =>
    expect(detectAdapter('https://jobs.ashbyhq.com/trm-labs/abc-123')).toBe('ashby'))

  it('reads an Ashby posting embedded on a company site', () =>
    expect(detectAdapter('https://www.trmlabs.com/careers?ashby_jid=abc-123')).toBe('ashby'))

  it('reads both Greenhouse board hostnames', () => {
    expect(detectAdapter('https://boards.greenhouse.io/vercel/jobs/6136160004')).toBe('greenhouse')
    expect(detectAdapter('https://job-boards.greenhouse.io/vercel/jobs/6136160004')).toBe(
      'greenhouse',
    )
  })

  it('reads a Lever posting', () =>
    expect(detectAdapter('https://jobs.lever.co/ro/f25a6c49')).toBe('lever'))

  it('falls back to generic for anything else, LinkedIn included', () => {
    expect(detectAdapter('https://www.python.org/jobs/8126/')).toBe('generic')
    expect(detectAdapter('not a url')).toBe('generic')
    // LinkedIn has no adapter of its own — fetchPosting is what refuses it.
    expect(detectAdapter('https://www.linkedin.com/jobs/view/123')).toBe('generic')
  })
})

describe('fetchPosting', () => {
  it('refuses LinkedIn without a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    for (const url of [
      'https://www.linkedin.com/jobs/view/123',
      'https://linkedin.com/jobs/view/123',
      'https://uk.linkedin.com/jobs/view/123',
    ]) {
      await expect(fetchPosting(url)).rejects.toThrow(FetchBlockedError)
    }
    await expect(fetchPosting('https://www.linkedin.com/jobs/view/123')).rejects.toThrow(
      /paste the job description text/i,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a string that is not a URL', async () => {
    await expect(fetchPosting('paste the JD here')).rejects.toThrow(FetchBlockedError)
  })
})

describe('parseAshby', () => {
  it('pulls company, role and description out of the board payload', () => {
    const p = parseAshby(ashbyBoard(), ASHBY_JOB_ID)
    expect(p.company).toBe('Trm Labs')
    expect(p.role).toBe('Account Director, Defence and Intel (Canada)')
    expect(p.jdText).toContain('AI-powered intelligence solutions')
    expect(p.jdText).toContain('Canada')
    expect(p.jdText).not.toContain('<p')
  })

  it('blocks when the id is not on the board any more', () => {
    expect(() => parseAshby(ashbyBoard(), 'no-such-id')).toThrow(FetchBlockedError)
  })
})

describe('ashbySlugCandidates', () => {
  it('tries the hosting path segment, then the domain variants', () => {
    const got = ashbySlugCandidates(new URL('https://www.trmlabs.com/careers?ashby_jid=abc'))
    expect(got).toEqual(['careers', 'trmlabs', 'trm-labs', 'trm'])
  })

  it('takes the slug straight from a hosted board URL', () => {
    expect(ashbySlugCandidates(new URL('https://jobs.ashbyhq.com/trm-labs/abc'))).toEqual([
      'trm-labs',
    ])
  })
})

describe('parseGreenhouse', () => {
  it('decodes the double-escaped content field', () => {
    const p = parseGreenhouse(JSON.parse(fixture('greenhouse.json')))
    expect(p.company).toBe('Vercel')
    expect(p.role).toBe('Account Executive, Commercial')
    expect(p.jdText).toContain('agentic infrastructure company')
    expect(p.jdText).toContain('Hybrid - London')
    expect(p.jdText).not.toContain('&lt;')
    expect(p.jdText).not.toContain('<div')
  })
})

describe('parseLever', () => {
  it('joins the description with the requirement lists', () => {
    const p = parseLever(JSON.parse(fixture('lever.json')))
    expect(p.company).toBe('Ro')
    expect(p.role).toBe('Compounding Pharmacy Technician -  Romeoville, IL')
    expect(p.jdText).toContain('direct-to-patient healthcare company')
    expect(p.jdText).toContain("What You'll Do:")
    expect(p.jdText).toContain('Prepare non-sterile hazardous')
    expect(p.jdText).toContain('Romeoville, IL')
    expect(p.jdText).not.toContain('<li>')
  })
})

describe('parseGeneric', () => {
  it('splits the title and keeps only the page body', () => {
    const p = parseGeneric(fixture('generic.html'))
    expect(p.role).toBe('Software Engineer (Remote), Softech Associate')
    expect(p.company).toBe('Python.org')
    expect(p.jdText).toContain('Join Softech Associate to build and ship real software')
    expect(p.jdText).not.toContain('window.jQuery')
    expect(p.jdText).not.toContain('Skip to content')
    expect(p.jdText).not.toContain('Back to Top')
  })

  it('blocks a page that carries almost no text', () => {
    const thin =
      '<html><head><title>Careers | Acme</title></head><body><div id="root"></div></body></html>'
    expect(() => parseGeneric(thin)).toThrow(FetchBlockedError)
    expect(() => parseGeneric(thin)).toThrow(/paste the job description text/i)
  })
})

describe('htmlToText', () => {
  const html =
    '<html><head><style>body{color:red}</style>' +
    '<script>var tracked = 1</script></head><body>' +
    '<nav>Site menu</nav><header>Logo</header>' +
    '<p>Real&nbsp;text &amp; &#39;more&#39;</p>' +
    '<footer>Legal</footer></body></html>'

  it('drops script and style content', () => {
    expect(htmlToText(html)).not.toContain('tracked')
    expect(htmlToText(html)).not.toContain('color:red')
  })

  it('drops chrome elements', () => {
    const text = htmlToText(html)
    expect(text).not.toContain('Site menu')
    expect(text).not.toContain('Logo')
    expect(text).not.toContain('Legal')
  })

  it('decodes entities and collapses whitespace', () => {
    expect(htmlToText(html)).toBe("Real text & 'more'")
  })
})

describe('fetchPosting over the network', () => {
  it('walks the Ashby slug candidates until one board has the posting', async () => {
    const calls = stubFetch((url) =>
      url.includes('/job-board/trm-labs')
        ? new Response(fixture('ashby.json'), { status: 200 })
        : new Response('Not Found', { status: 404 }),
    )

    const p = await fetchPosting(`https://www.trmlabs.com/careers?ashby_jid=${ASHBY_JOB_ID}`)

    expect(p.adapter).toBe('ashby')
    expect(p.company).toBe('Trm Labs')
    expect(calls.map((u) => new URL(u).pathname.split('/').pop())).toEqual([
      'careers',
      'trmlabs',
      'trm-labs',
    ])
  })

  it('blocks when no candidate board exists', async () => {
    stubFetch(() => new Response('Not Found', { status: 404 }))
    await expect(
      fetchPosting('https://www.trmlabs.com/careers?ashby_jid=abc'),
    ).rejects.toThrow(/tried careers, trmlabs, trm-labs, trm/)
  })

  it('keeps walking when a board answers without the posting on it', async () => {
    // /careers is a plausible Ashby slug for some other company; answering 200 must not
    // end the walk before the real board is reached.
    const calls = stubFetch((url) =>
      url.includes('/job-board/trm-labs')
        ? new Response(fixture('ashby.json'), { status: 200 })
        : new Response(JSON.stringify({ jobs: [], apiVersion: '1' }), { status: 200 }),
    )

    const p = await fetchPosting(`https://www.trmlabs.com/careers?ashby_jid=${ASHBY_JOB_ID}`)

    expect(p.company).toBe('Trm Labs')
    expect(calls).toHaveLength(3)
  })

  it('blocks when every board that answered lacks the posting', async () => {
    stubFetch(() => new Response(JSON.stringify({ jobs: [] }), { status: 200 }))
    await expect(
      fetchPosting('https://www.trmlabs.com/careers?ashby_jid=abc'),
    ).rejects.toThrow(/no longer listed/)
  })

  it('blocks when Greenhouse no longer has the posting', async () => {
    stubFetch(() => new Response('', { status: 404 }))
    await expect(fetchPosting('https://boards.greenhouse.io/vercel/jobs/1')).rejects.toThrow(
      FetchBlockedError,
    )
  })

  it('blocks when the host cannot be reached at all', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    await expect(fetchPosting('https://careers.example.com/job/1')).rejects.toThrow(
      /Could not reach careers.example.com/,
    )
  })
})

describe('assertReachableAddress', () => {
  const blocked = [
    'http://169.254.169.254/computeMetadata/v1/',
    'http://metadata.google.internal/',
    'http://10.0.0.5/jobs/1',
    'http://172.16.4.4/jobs/1',
    'http://192.168.1.1/jobs/1',
    'http://127.0.0.1/jobs/1',
    'http://0.0.0.0/jobs/1',
    'http://localhost/jobs/1',
    'http://redis/jobs/1',
    'http://[::1]/jobs/1',
    'http://[fd00::1]/jobs/1',
    'http://[fe80::1]/jobs/1',
    'http://[::ffff:169.254.169.254]/',
    'https://careers.example.com:8080/jobs/1',
    // A trailing dot is the same host, fully qualified: localhost. resolves to ::1.
    'http://metadata.google.internal./',
    'http://localhost./',
    'http://localhost../',
  ]

  it.each(blocked)('refuses %s', (url) => {
    expect(() => assertReachableAddress(new URL(url))).toThrow(FetchBlockedError)
  })

  it('allows a public host on a default port', () => {
    for (const url of [
      'https://careers.example.com/jobs/1',
      'https://careers.example.com:443/jobs/1',
      'http://careers.example.com:80/jobs/1',
      'https://8.8.8.8/jobs/1',
    ]) {
      expect(() => assertReachableAddress(new URL(url))).not.toThrow()
    }
  })
})

describe('generic fetch address guard', () => {
  it('never opens a connection to a blocked address', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(fetchPosting('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /isn't reachable from here/,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('re-checks the address on every redirect hop', async () => {
    const calls = stubFetch((url) =>
      url.startsWith('https://careers.example.com')
        ? new Response('', { status: 302, headers: { location: 'http://10.0.0.1/internal' } })
        : new Response('should never be fetched', { status: 200 }),
    )

    await expect(fetchPosting('https://careers.example.com/jobs/1')).rejects.toThrow(
      /isn't reachable from here/,
    )
    expect(calls).toEqual(['https://careers.example.com/jobs/1'])
  })

  it('gives up on a redirect chain that will not settle', async () => {
    let n = 0
    stubFetch(
      () =>
        new Response('', {
          status: 302,
          headers: { location: `https://careers.example.com/hop/${n++}` },
        }),
    )
    await expect(fetchPosting('https://careers.example.com/jobs/1')).rejects.toThrow(
      /keeps redirecting/,
    )
  })

  it('follows a redirect to another public page and reads it', async () => {
    const calls = stubFetch((url) =>
      url.endsWith('/jobs/1')
        ? new Response('', { status: 301, headers: { location: '/jobs/1/' } })
        : new Response(fixture('generic.html'), { status: 200 }),
    )

    const p = await fetchPosting('https://careers.example.com/jobs/1')

    expect(p.adapter).toBe('generic')
    expect(p.jdText).toContain('Join Softech Associate')
    expect(calls).toEqual([
      'https://careers.example.com/jobs/1',
      'https://careers.example.com/jobs/1/',
    ])
  })
})
