import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ResearchSource } from '@/lib/types'

// The two halves of the research orchestration, on their own. Both runs — the process map and
// the take-home guide — are these two functions with different words in them, so what is under
// test here is the walk itself: which searches ran and in whose words, what became one source,
// which observations kept which ids, how far down the ranked list a run reads before it stops,
// and what a page that reads to nothing costs. The seams are faked at the two module boundaries
// the route test already fakes them at, so nothing here reaches the network or the model.

const { runProcessGather } = vi.hoisted(() => ({ runProcessGather: vi.fn() }))
const { searchReddit, searchHackerNews, readSource, resolveGroundingUrl } = vi.hoisted(() => ({
  searchReddit: vi.fn(), searchHackerNews: vi.fn(), readSource: vi.fn(), resolveGroundingUrl: vi.fn(),
}))
vi.mock('@/ai/flows/processGather', () => ({ runProcessGather }))
vi.mock('@/lib/research/community', () => ({ searchReddit, searchHackerNews, readSource, resolveGroundingUrl }))

import { gatherEvidence, readGuides, type GatherInput, type GatherTrace } from '@/lib/research/pipeline'
import type { PlannedQuery } from '@/lib/research/planQueries'

/** One clock for every run in this file, so a source's date can be read against it by eye. */
const STARTED_AT = '2026-09-05T00:00:00.000Z'

const queries: PlannedQuery[] = [
  { id: 'q1', query: '"Marram Systems" take home assignment software engineering', intent: 'take-home' },
  { id: 'q2', query: '"Marram Systems" take-home interview experience', intent: 'experience' },
]

const gathered = (uri: string, title: string, note: string) => ({
  notes: [note], chunks: [{ uri, title }], supports: [{ text: note, chunkIndices: [0] }],
})

const gatherInput = (over: Partial<GatherInput> = {}): GatherInput => ({
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  family: 'software engineering',
  queries,
  community: { terms: 'take home', titlePattern: /interview|take[- ]?home|assignment/i },
  startedAt: STARTED_AT,
  ...over,
})

const source = (over: Partial<ResearchSource> = {}): ResearchSource => ({
  id: 's1', title: 'The Marram Systems take-home', url: 'https://blog.example.com/a',
  host: 'blog.example.com', kind: 'guide', snippet: '', fetched: false, ...over,
})

/** Long enough to be a page rather than a fragment; the reader's own floor is elsewhere. */
const page = (title?: string) => ({
  text: 'The take-home was a small ledger service. '.repeat(30),
  ...(title ? { title } : {}),
})

beforeEach(() => {
  vi.resetAllMocks()
  runProcessGather.mockResolvedValue(
    gathered('https://blog.example.com/how-i-got-in', 'blog.example.com', 'The take-home is a small ledger service.'),
  )
  searchReddit.mockResolvedValue([])
  searchHackerNews.mockResolvedValue([])
  resolveGroundingUrl.mockImplementation(async (u: string) => u)
  readSource.mockResolvedValue(null)
})

describe('gatherEvidence', () => {
  it('runs one gather per planned query and asks the community in this run’s own words', async () => {
    const out = await gatherEvidence(gatherInput())
    expect(runProcessGather).toHaveBeenCalledTimes(2)
    expect(runProcessGather.mock.calls.map((c) => c[0].query)).toEqual(queries.map((q) => q.query))
    expect(runProcessGather.mock.calls[0][0]).toMatchObject({
      company: 'Marram Systems', role: 'Senior Backend Engineer', family: 'software engineering',
    })
    expect(searchReddit).toHaveBeenCalledWith('Marram Systems', { terms: 'take home' })
    expect(searchHackerNews).toHaveBeenCalledWith('Marram Systems', {
      terms: 'take home', titlePattern: /interview|take[- ]?home|assignment/i,
    })
    expect(out.grounded).toBe(true)
  })

  it('folds the community hits and the grounded pages into one numbered list', async () => {
    searchReddit.mockResolvedValue([
      { url: 'https://www.reddit.com/r/x/comments/1/marram/', title: 'Marram take-home', snippet: 'Marram' },
    ])
    runProcessGather.mockResolvedValue(
      gathered('https://vertexaisearch.cloud.google.com/grounding-api-redirect/A', 'reddit.com', 'The take-home is a small ledger service.'),
    )
    resolveGroundingUrl.mockImplementation(async (u: string) =>
      u.endsWith('/A') ? 'https://www.reddit.com/r/x/comments/1/marram/' : u,
    )
    const out = await gatherEvidence(gatherInput())
    // One distinct redirect across both gathers, so one HEAD — not one per gather.
    expect(resolveGroundingUrl).toHaveBeenCalledTimes(1)
    // The redirect resolved to the thread Reddit search already found: one source, not two, and
    // it keeps the title the thread's author gave it rather than the domain grounding named.
    expect(out.sources).toHaveLength(1)
    expect(out.sources[0]).toMatchObject({
      id: 's1', host: 'reddit.com', kind: 'community', title: 'Marram take-home', fetched: false,
    })
  })

  it('folds one observation two searches made into a single note carrying both sources', async () => {
    const note = 'The take-home is a small ledger service, and reviewers read the tests first.'
    runProcessGather
      .mockResolvedValueOnce(gathered('https://blog.example.com/a', 'blog.example.com', note))
      .mockResolvedValueOnce(gathered('https://blog.example.com/b', 'blog.example.com', note))
    const out = await gatherEvidence(gatherInput())
    expect(out.notes).toEqual([{ sourceIds: ['s1', 's2'], text: note }])
  })

  it('is not grounded when every gather fails, and keeps what the community found anyway', async () => {
    runProcessGather.mockRejectedValue(new Error('429'))
    searchReddit.mockResolvedValue([
      { url: 'https://www.reddit.com/r/x/comments/1/marram/', title: 'Marram take-home', snippet: 'Marram' },
    ])
    const out = await gatherEvidence(gatherInput())
    expect(out.grounded).toBe(false)
    expect(out.notes).toEqual([])
    expect(out.sources.map((s) => s.id)).toEqual(['s1'])
  })

  it('reports each search’s own trace, with the pages behind its grounding chunks resolved', async () => {
    runProcessGather
      .mockResolvedValueOnce(
        gathered('https://vertexaisearch.cloud.google.com/grounding-api-redirect/A', 'blog.example.com', 'A note about the take-home.'),
      )
      .mockRejectedValueOnce(new Error('429'))
    resolveGroundingUrl.mockResolvedValue('https://blog.example.com/how-i-got-in')
    const traces: GatherTrace[] = []
    await gatherEvidence(gatherInput({ onGathers: (t) => traces.push(...t) }))
    expect(traces).toEqual([
      { query: queries[0].query, ok: true, notes: ['A note about the take-home.'], urls: ['https://blog.example.com/how-i-got-in'] },
      { query: queries[1].query, ok: false, notes: [], urls: [] },
    ])
  })
})

describe('readGuides', () => {
  const many = (n: number) =>
    [...Array(n)].map((_, i) =>
      source({ id: `s${i + 1}`, url: `https://blog${i}.example.com/take-home`, host: `blog${i}.example.com` }),
    )

  it('walks three at a time until six digests land, however many pages read to nothing', async () => {
    // The first three read to nothing — link posts with no comments under them. A page that
    // comes back empty must cost a read, not one of the six slots.
    let read = 0
    readSource.mockImplementation(async () => (read++ < 3 ? null : page()))
    const counts: { attempted: number; landed: number }[] = []
    const landed = await readGuides({
      sources: many(9),
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => ({ ok: true }),
      onReads: (c) => counts.push(c),
    })
    expect(readSource).toHaveBeenCalledTimes(9)
    expect(landed).toHaveLength(6)
    expect(counts).toEqual([{ attempted: 9, landed: 6 }])
  })

  it('gives up after twelve reads when none of them comes back with anything', async () => {
    readSource.mockResolvedValue(null)
    const landed = await readGuides({
      sources: many(15),
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => ({ ok: true }),
    })
    expect(readSource).toHaveBeenCalledTimes(12)
    expect(landed).toEqual([])
  })

  it('leaves a source unread when the digest comes back null', async () => {
    const s = source()
    readSource.mockResolvedValue(page())
    const landed = await readGuides({
      sources: [s],
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => null,
    })
    expect(landed).toEqual([])
    expect(s.fetched).toBe(false)
  })

  it('lets the page it read rename a source that was only its domain, before the digest sees it', async () => {
    const s = source({ title: 'blog.example.com' })
    readSource.mockResolvedValue(page('How I did the Marram take-home'))
    const seen: string[] = []
    const landed = await readGuides({
      sources: [s],
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async (src, text) => {
        seen.push(src.title)
        return { chars: text.length }
      },
    })
    expect(seen).toEqual(['How I did the Marram take-home'])
    expect(s.title).toBe('How I did the Marram take-home')
    expect(landed[0].digest.chars).toBeGreaterThan(800)
  })

  it('marks a landed source fetched, and calls a digest stale by the source’s own date', async () => {
    const fresh = source({ id: 's1', url: 'https://blog1.example.com/a', host: 'blog1.example.com', publishedAt: '2026-01-01T00:00:00.000Z' })
    const old = source({ id: 's2', url: 'https://blog2.example.com/a', host: 'blog2.example.com', publishedAt: '2019-01-01T00:00:00.000Z' })
    readSource.mockResolvedValue(page())
    const landed = await readGuides({
      sources: [fresh, old],
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => ({ ok: true }),
    })
    expect([fresh.fetched, old.fetched]).toEqual([true, true])
    expect(landed.find((l) => l.sourceId === 's1')?.stale).toBe(false)
    expect(landed.find((l) => l.sourceId === 's2')?.stale).toBe(true)
  })

  it('takes a date the digest found in the page, and measures staleness with it', async () => {
    const s = source()
    readSource.mockResolvedValue(page())
    const landed = await readGuides({
      sources: [s],
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async (src) => {
        src.publishedAt = '2019-05-01T00:00:00.000Z'
        return { ok: true }
      },
    })
    expect(s.publishedAt).toBe('2019-05-01T00:00:00.000Z')
    expect(landed[0].stale).toBe(true)
  })

  it('names an unread source from its path, and leaves a homepage its host', async () => {
    const sources = [
      source({ id: 's1', title: 'marram.dev', url: 'https://marram.dev/careers/how-we-hire', host: 'marram.dev' }),
      source({ id: 's2', title: 'marram.dev', url: 'https://marram.dev/', host: 'marram.dev' }),
    ]
    readSource.mockResolvedValue(null)
    await readGuides({
      sources,
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => ({ ok: true }),
    })
    expect(sources.map((s) => s.title)).toEqual(['How We Hire', 'marram.dev'])
  })

  it('never reads a host that answers a server with a challenge page', async () => {
    const sources = [
      source({ id: 's1', title: 'Marram Systems interview', url: 'https://www.glassdoor.com/Interview/Marram', host: 'glassdoor.com', kind: 'community' }),
      source({ id: 's2', url: 'https://blog.example.com/a' }),
    ]
    readSource.mockResolvedValue(page())
    await readGuides({
      sources,
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => ({ ok: true }),
    })
    expect(readSource).toHaveBeenCalledTimes(1)
    expect(readSource.mock.calls[0][0].host).toBe('blog.example.com')
  })

  it('returns what landed in the order it landed, and leaves the sorting to the caller', async () => {
    // The take-home write-up outscores the bare domain under this title term, so it is read
    // first and lands first — and it comes back first, ahead of s1. Both callers sort what
    // comes back by source id, because only they know what the numbering beside it has to
    // agree with; a sort in here would quietly make both of those look redundant.
    const sources = [
      source({ id: 's1', title: 'blog1.example.com', url: 'https://blog1.example.com/a', host: 'blog1.example.com' }),
      source({ id: 's2', title: 'The Marram Systems take-home', url: 'https://blog2.example.com/a', host: 'blog2.example.com' }),
    ]
    readSource.mockResolvedValue(page())
    const landed = await readGuides({
      sources,
      company: 'Marram Systems',
      startedAt: STARTED_AT,
      titleTerm: /take[- ]?home/i,
      digest: async () => ({ ok: true }),
    })
    expect(landed.map((l) => l.sourceId)).toEqual(['s2', 's1'])
  })
})
