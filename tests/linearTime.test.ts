import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { StoredResume } from '@/lib/resume/types'
import type { Fact, ResearchSource } from '@/lib/types'

// Every reader below runs on the server, over text a person controls or a page they pointed us
// at, before anything meters the request — and a regular expression that stalls stalls every
// request the instance is serving. Each one here was quadratic on some shape of input (security
// review, 2026-10-08): 40,000 "<" kept htmlToText busy for 4 s, 80,000 for 17 s. They are held to
// linear time on those shapes, and to the answers they gave before the rewrite on honest input.

// `readSource` fetches its page, so the page arrives through this mock. The address check in the
// same module stays real: it is one of the readers under test.
const { getGuardedText } = vi.hoisted(() => ({ getGuardedText: vi.fn() }))
vi.mock('@/adapters/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/adapters/http')>()),
  getGuardedText,
}))
vi.mock('@/lib/research/redditAuth', () => ({ redditToken: vi.fn(), REDDIT_UA: 'ua' }))

import { htmlToText, rawTitle } from '@/adapters/html'
import { parseGeneric } from '@/adapters/genericFetch'
import { assertReachableAddress } from '@/adapters/http'
import { digitTokens } from '@/ai/flows/bulletRewrite'
import { contentTokens } from '@/ai/prompts/bulletRewrite'
import { extractIdentity } from '@/lib/profileView'
import { readSource } from '@/lib/research/community'
import { runChecks } from '@/lib/resume/checks'
import { structure } from '@/lib/resume/structure'

const KiB = 1024
const MiB = 1024 * KiB

/**
 * A step is judged only once it takes this long. Under the whole suite every core is busy, and
 * a stall of tens of milliseconds is ordinary: on a step of a few, that is most of the reading.
 * A quadratic reader passes this within a step or two of 4 KiB; a linear one that never reaches
 * it, even at the largest size, is fast enough that its growth does not matter.
 */
const FLOOR_MS = 50
/** One pass grows about 4× a step and a quadratic one about 16×; this sits between, with room. */
const MAX_STEP_GROWTH = 10

async function timed(run: () => unknown): Promise<number> {
  const started = performance.now()
  await run()
  return performance.now() - started
}

/**
 * N against 4N, from 4 KiB up to `max`. Read in one pass, an input four times as long takes about
 * four times as long; a pattern that reads the rest of the input again from every place a match
 * could start takes about sixteen times as long. Each size is the best of three runs, the two
 * sizes taken in turn so that whatever else the machine is doing falls on both alike. The small
 * steps come first, so a reader that has gone quadratic fails here in a second or two instead of
 * holding the run for hours on the large ones.
 */
async function expectLinear<T>(run: (input: T) => unknown, build: (n: number) => T, max = 4 * MiB) {
  let smaller = build(KiB)
  for (let n = 4 * KiB; n <= max; n *= 4) {
    const larger = build(n)
    let small = Infinity
    let large = Infinity
    for (let i = 0; i < 3; i++) {
      small = Math.min(small, await timed(() => run(smaller)))
      large = Math.min(large, await timed(() => run(larger)))
    }
    if (large > FLOOR_MS) {
      expect(large / small, `${n} characters took ${large.toFixed(1)} ms`).toBeLessThan(MAX_STEP_GROWTH)
    }
    smaller = larger
  }
}

/** A ladder takes about a second here; a busy CI box can take several, past the 5 s default. */
const TIMED = { timeout: 30_000 }

/** `unit` repeated to about `n` characters. */
const fill = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length))

// The openers below end in "/" where the review's ended in a space: the patterns take the same
// path either way, and a space in every unit makes a page of a million separate runs of
// whitespace, which htmlToText's whitespace pass collapses with one `replace`. Over that many
// matches V8's `replace` grows faster than linear for reasons of its own heap rather than any
// pattern (measured 2026-10-08: ~n^1.4, 0.36 s at 4 MiB), enough to blur one 4× step. It is
// unchanged by the rewrite, and the fetch cap is what bounds it.

describe('htmlToText — a hostile page reads in linear time, up to 4 MiB', TIMED, () => {
  // 4 MiB is the fetch cap the AI-usage-caps spec plans; today nothing caps a fetched page at all.
  it.each([
    ['"<" with no ">" after it', (n: number) => fill('<', n)],
    ['"<style/" with no ">" after it', (n: number) => fill('<style/', n)],
    ['"<script>" with no closer', (n: number) => fill('<script>', n)],
    ['every chrome element opened, none closed', (n: number) => fill('<script><style><nav><header><footer>', n)],
    ['openers that all reach one ">" at the end', (n: number) => fill('<script/', n) + '>'],
    ['"<!--" with no closer', (n: number) => fill('<!--', n)],
  ])('%s', async (_, build) => {
    await expectLinear(htmlToText, build)
  })
})

describe('a page title — a hostile page reads in linear time, up to 4 MiB', TIMED, () => {
  // Prose ahead of the titles, so parseGeneric has text enough to go on and read the title.
  const prose = fill('Senior engineer, payments. ', 600)
  const shapes = [
    ['"<title>" with no closer', (n: number) => prose + fill('<title>', n)],
    ['"<title/" with no ">" after it', (n: number) => prose + fill('<title/', n)],
  ] as const

  it.each(shapes)('parseGeneric: %s', async (_, build) => {
    await expectLinear(parseGeneric, build)
  })

  it.each(shapes)('readSource: %s', async (_, build) => {
    const source: ResearchSource = {
      id: 's1', title: 't', url: 'https://example.com/post', host: 'example.com', kind: 'community', snippet: '', fetched: false,
    }
    await expectLinear(async (html: string) => {
      getGuardedText.mockResolvedValue({ status: 200, text: html, contentType: 'text/html' })
      await readSource(source)
    }, build)
  })
})

describe('assertReachableAddress — a host made of dots reads in linear time', TIMED, () => {
  // The URL parser takes a host of any number of dots, and the address is checked before the
  // request is made — before anything else limits it.
  it('a run of dots that does not end the host', async () => {
    await expectLinear(
      (url: URL) => {
        try {
          assertReachableAddress(url)
        } catch {
          // Refused or not, only the time matters here.
        }
      },
      (n) => new URL(`http://a${'.'.repeat(n)}b/`),
    )
  })
})

describe('the bullet rewrite — a long number and a long token read in linear time', TIMED, () => {
  it('digitTokens: a number made of separators', async () => {
    await expectLinear(digitTokens, (n) => '1' + fill(',.', n) + '1', MiB)
  })

  it('contentTokens: a token made of full stops', async () => {
    await expectLinear(contentTokens, (n) => 'a' + '.'.repeat(n) + 'b', MiB)
  })
})

describe('extractIdentity — a long claim reads in linear time, up to the 1 MiB a profile can hold', TIMED, () => {
  const claim = (text: string): Fact[] => [{ id: 'f1', claim: text, sourceSnippet: '', tags: [] }]
  it.each([
    ['address characters with no "@"', (n: number) => fill('a', n)],
    ['a hyphenated run with no domain ending', (n: number) => fill('-a', n)],
    ['a dotted run with no domain ending', (n: number) => fill('a.', n)],
    ['a site whose trailing punctuation does not end it', (n: number) => 'www.x' + fill(',.', n) + 'x'],
  ])('%s', async (_, build) => {
    await expectLinear((text: string) => extractIdentity(claim(text)), build, MiB)
  })
})

describe('the resume readers — a long line reads in linear time, up to 256 KiB', TIMED, () => {
  // A resume holds at most 40,000 characters (MAX_RESUME_CHARS); 256 KiB is six times that.
  type Line = StoredResume['lines'][number]
  const at = (y: number, text: string): Line => ({ page: 1, x: 72, y, size: 11, font: 'f1', text })
  const RESUME_MAX = 256 * KiB

  it.each([
    ['a role and org parted by a long run of bars', (n: number) => 'a' + '|'.repeat(n) + 'b 2019 – 2020'],
    ['a role and org parted by a long run of spaces', (n: number) => 'a' + ' '.repeat(n) + 'b 2019 – 2020'],
  ])('structure: %s', async (_, build) => {
    await expectLinear((line: string) => structure([at(720, 'EXPERIENCE'), at(706, line), at(692, '• Did a thing')]), build, RESUME_MAX)
  })

  it('runChecks: address characters with no "@" in the contact band', async () => {
    const body = ['Experience', 'Backend Engineer, Marram Systems — Jan 2020 to Dec 2021', 'Cut reconciliation to 18 minutes.', 'Education', 'BSc, Ardley University, 2019']
      .map((text, i) => at(680 - 16 * i, text))
    const resume = (band: string): StoredResume => {
      const lines = [at(812, band), ...body]
      return {
        addedAt: '2026-09-20T10:00:00.000Z', filename: 'r.pdf', bytes: 1000, text: lines.map((l) => l.text).join('\n'),
        lines, sections: [], entries: [], bullets: [], language: 'en',
      }
    }
    await expectLinear((band: string) => runChecks(resume(band)), (n) => fill('a', n), RESUME_MAX)
  })
})

describe('htmlToText and rawTitle — the answers recorded before the rewrite', () => {
  // Recorded from the code as it stood before the rewrite (tests/fixtures/htmlToText.corpus.json):
  // the repo's fixtures as each adapter feeds them, hand-written pages for scripts, styles,
  // comments, chrome, titles, entities and unclosed tags, and small hostile shapes.
  const corpus = JSON.parse(readFileSync('tests/fixtures/htmlToText.corpus.json', 'utf8')) as {
    name: string
    html: string
    text: string
    title: string | null
  }[]

  it.each(corpus.map((page) => [page.name, page] as const))('%s', (_, page) => {
    expect(htmlToText(page.html)).toBe(page.text)
    expect(rawTitle(page.html)).toBe(page.title)
  })
})

describe('the other readers — answers pinned before the rewrite', () => {
  it('structure parts a role from its org as before, separators doubled or odd', () => {
    const page = (text: string) =>
      structure(['EXPERIENCE', text, '• Did a thing'].map((t, i) => ({ page: 1, x: 72, y: 720 - i * 14, size: 11, font: 'f1', text: t })))
        .entries[0]
    const parts = (text: string) => {
      const entry = page(text)
      return { role: entry.role, org: entry.org }
    }
    // A comma straight after a separator that ended in a space is a split of its own.
    expect(parts('Engineer , , Acme    2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer, , Acme, 2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer – , Acme 2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer | , | Acme | 2019 – 2020')).toEqual({ role: 'Engineer', org: '| Acme' })
    expect(parts('Engineer , at Acme 2019 – 2020')).toEqual({ role: 'Engineer', org: 'at Acme' })
    expect(parts('Engineer   at   Acme 2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer — Acme, Inc. | Remote    2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme, Inc., Remote' })
    expect(parts('Engineer ,Acme 2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer\t,\tAcme\t2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer, Acme ,  2019 – 2020')).toEqual({ role: 'Engineer', org: 'Acme' })
    expect(parts('Engineer |Acme 2019 – 2020')).toEqual({ role: '', org: 'Engineer |Acme' })
    expect(parts('Engineer -- Acme — 2019 – 2020')).toEqual({ role: '', org: 'Engineer -- Acme' })
  })

  it('digitTokens and contentTokens take the trailing separators off as before', () => {
    expect(digitTokens('12,000. 840ms to 210ms. 1,.,.2 3.5, 2019-2020 1.,.,')).toEqual(['12,000', '840', '210', '1,.,.2', '3.5', '2019', '2020', '1'])
    expect(contentTokens('node.js... and c++ .net ...trailing. ..a.. a..b.c... .... x.y')).toEqual(['node.js', 'c++', 'net', 'trailing', 'a..b.c', 'x.y'])
  })

  it('extractIdentity reads an address and a site out of a claim as before', () => {
    const identity = (text: string) => extractIdentity([{ id: 'f1', claim: text, sourceSnippet: '', tags: ['contact'] }])
    expect(identity('Email: jane.doe@example.com, site: https://jane.dev.')).toEqual({ email: 'jane.doe@example.com', website: 'https://jane.dev' })
    expect(identity('jane@acme.io · www.jane.dev')).toEqual({ email: 'jane@acme.io', website: 'www.jane.dev' })
    expect(identity('Portfolio: jane-doe.github.io/projects;')).toEqual({ website: 'jane-doe.github.io/projects' })
    expect(identity('Reach me at j@x.co or x.com')).toEqual({ email: 'j@x.co', website: 'x.com' })
    expect(identity('Contact: (503) 555-0161, jane@acme.io')).toEqual({ email: 'jane@acme.io', phone: '(503) 555-0161' })
    expect(identity('Built example.com and shop.example.co.')).toEqual({ website: 'example.com' })
    expect(identity('Site:example.com')).toEqual({ website: 'example.com' })
    expect(identity('see e.g.example.com')).toEqual({ website: 'e.g.example.com' })
    expect(identity('.example.com')).toEqual({ website: 'example.com' })
    expect(identity('foo..example.com')).toEqual({ website: 'example.com' })
    expect(identity('jane@acme.com.and@other.org')).toEqual({ email: 'jane@acme.com.and', website: 'other.org' })
    expect(identity('www.x,.,.,;')).toEqual({ website: 'www.x' })
    expect(identity('mail jane_doe+jobs@sub.acme-corp.io today')).toEqual({ email: 'jane_doe+jobs@sub.acme-corp.io' })
  })

  it('extractIdentity changed its answer only where an address or a site is glued to what is before it', () => {
    // To read in one pass, an address is read from where its run of address characters starts
    // and a site from where its run of domain labels starts. Before, both could also start partway
    // into such a run. That gave a different answer on these and nothing an honest claim says: a
    // second address glued to the first (before, both were taken out; now the second stays, so its
    // domain reads as a site), and a site whose run starts with "-" or follows "_" (before, the
    // part from the first letter after the "-" was taken).
    const identity = (text: string) => extractIdentity([{ id: 'f1', claim: text, sourceSnippet: '', tags: ['contact'] }])
    expect(identity('a@b.com.c@d.org')).toEqual({ email: 'a@b.com', website: 'd.org' })
    expect(identity('-a.com')).toEqual({})
    expect(identity('_ab-c.com')).toEqual({})
  })
})
