import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FlowOutputError } from '@/ai/genkit'
import type { TakeHomeSynthesizePromptInput } from '@/ai/prompts/takeHomeSynthesize'
import type { TakeHomeDigestOut } from '@/ai/schemas'
import type { GatherInput, ReadInput } from '@/lib/research/pipeline'
// The guide's own shape, from where it is declared: the flow re-exports it, but the flow is
// mocked below and the guard is the module that owns the type.
import type { SynthesizedGuide } from '@/lib/research/takeHomeGuard'
import type { ParsedJob, ResearchSource } from '@/lib/types'

// The take-home run with its four seams faked: the two pipeline halves Task 4 lifted out of the
// process map, the digest flow and the synthesis. `planTakeHomeQueries`, `roleFamily` and
// `summarizeJob` are the real ones — they are pure, and handing them the right arguments is half
// of what this module is for.
//
// What is under test is everything the finished guide cannot show: that this run asks the
// community about take-homes rather than about interviews, that a write-up which digests to
// nothing leaves its source unread instead of failing the run, that the digests reach the page
// and the synthesis in source order however they landed, and that the guide remembers which
// brief it was drawn from.

const { gatherEvidence, readGuides } = vi.hoisted(() => ({
  gatherEvidence: vi.fn(),
  readGuides: vi.fn(),
}))
const { runTakeHomeDigest, runTakeHomeSynthesize } = vi.hoisted(() => ({
  runTakeHomeDigest: vi.fn(),
  runTakeHomeSynthesize: vi.fn(),
}))

vi.mock('@/lib/research/pipeline', () => ({ gatherEvidence, readGuides }))
vi.mock('@/ai/flows/takeHomeDigest', () => ({ runTakeHomeDigest }))
vi.mock('@/ai/flows/takeHomeSynthesize', () => ({ runTakeHomeSynthesize }))

import { researchTakeHome, type TakeHomeResearchInput } from '@/lib/research/takeHome'

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['Owns the ledger write path'],
  gates: [],
  themes: ['payments'],
  scope: 'per-application',
  advisory: '',
}

const BRIEF =
  'Build a small ledger service that records transfers and reconciles them nightly. ' +
  'Send us a repository link. We suggest spending no more than four hours on it.'

const source = (id: string, over: Partial<ResearchSource> = {}): ResearchSource => ({
  id,
  title: `Write-up ${id}`,
  url: `https://example.com/${id}`,
  host: 'example.com',
  kind: 'community',
  snippet: '',
  fetched: false,
  ...over,
})

const digestOut = (over: Partial<TakeHomeDigestOut> = {}): TakeHomeDigestOut => ({
  task: 'Build a small ledger service.',
  timeGiven: 'Four hours',
  deliverables: ['A repository link'],
  evaluation: ['Tests, and a README that explains the trade-offs'],
  pitfalls: ['Gold-plating the schema'],
  takeaways: ['They ask for a ledger and read the README first.'],
  quotes: ['no more than four hours'],
  publishedAt: null,
  firstHand: true,
  ...over,
})

const drawn: SynthesizedGuide = {
  brief: {
    task: 'A small ledger service, handed in as a repository.',
    timeLimit: { text: 'Four hours is the suggested limit.', quote: 'no more than four hours' },
    deliverables: [],
    constraints: [],
    evaluation: [],
  },
  reported: { tasks: [], evaluation: [], pitfalls: [], time: [] },
  plan: [{ step: 'Read the brief twice and list its deliverables.' }],
  askRecruiter: [],
  caveats: ['Two write-ups, both undated.'],
}

const input = (over: Partial<TakeHomeResearchInput> = {}): TakeHomeResearchInput => ({
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  parsed,
  brief: BRIEF,
  plannedFrom: 'notice',
  sourceUrl: 'https://jobs.marram.dev/senior-backend',
  ...over,
})

/** The synthesis takes its prompt input and nothing else; the guard reads `brief` from it. */
const synthesisCall = (): TakeHomeSynthesizePromptInput =>
  runTakeHomeSynthesize.mock.calls[0][0] as TakeHomeSynthesizePromptInput
const gatherCall = (): GatherInput => gatherEvidence.mock.calls[0][0] as GatherInput
const readCall = (): ReadInput<TakeHomeDigestOut> =>
  readGuides.mock.calls[0][0] as ReadInput<TakeHomeDigestOut>

beforeEach(() => {
  vi.resetAllMocks()
  // A fresh pair of sources every call: the digest callback writes a date onto them, and one
  // shared array would carry that mutation into the next test.
  gatherEvidence.mockImplementation(async () => ({
    sources: [source('s1'), source('s2')],
    notes: [{ sourceIds: ['s1'], text: 'They give four hours for the ledger exercise.' }],
    grounded: true,
  }))
  // A miniature of the real walk: hand every source to the callback, keep what comes back, and
  // return them in landing order — reversed here, so the caller's sort has something to do.
  readGuides.mockImplementation(async (read: ReadInput<TakeHomeDigestOut>) => {
    const landed: { sourceId: string; digest: TakeHomeDigestOut; stale: boolean }[] = []
    for (const s of read.sources) {
      const digest = await read.digest(s, `the write-up behind ${s.id}`)
      if (digest) landed.push({ sourceId: s.id, digest, stale: s.id === 's2' })
    }
    return landed.reverse()
  })
  runTakeHomeDigest.mockImplementation(async ({ title }: { title: string }) =>
    digestOut({ takeaways: [`what ${title} says`] }),
  )
  runTakeHomeSynthesize.mockResolvedValue(drawn)
})

describe('researchTakeHome — what it asks the web', () => {
  it('plans the four take-home searches for this company and role family', async () => {
    await researchTakeHome(input())
    const g = gatherCall()
    expect(g.company).toBe('Marram Systems')
    expect(g.role).toBe('Senior Backend Engineer')
    expect(g.family).toBe('software engineering')
    expect(g.queries.map((q) => q.query)).toEqual([
      '"Marram Systems" take home assignment software engineering',
      '"Marram Systems" take-home interview experience',
      '"Marram Systems" "take home" feedback rejected',
      `software engineering take home assignment what reviewers look for ${new Date().getFullYear()}`,
    ])
    expect(g.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // The posting's address goes through too: a page on that host is classified as the posting
    // rather than as somebody's write-up, exactly as the process map classifies it.
    expect(g.sourceUrl).toBe('https://jobs.marram.dev/senior-backend')
  })

  it('asks the community about take-homes, not about interviews', async () => {
    // The default in `community.ts` is the process map's `interview`. Left at the default, this
    // run would gather threads about the loop and digest them for an assignment nobody in them
    // was given.
    await researchTakeHome(input())
    expect(gatherCall().community).toEqual({
      terms: 'take home',
      titlePattern: /interview|take[- ]?home|assignment/i,
    })
  })

  it('ranks what it reads by take-home words rather than by “interview”', async () => {
    await researchTakeHome(input())
    const r = readCall()
    expect(r.titleTerm).toEqual(/take[- ]?home|assignment|exercise/i)
    expect(r.company).toBe('Marram Systems')
    expect(r.sources.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(r.startedAt).toBe(gatherCall().startedAt)
  })

  it('passes a watcher’s callbacks straight through to the two halves', async () => {
    const onGathers = vi.fn()
    const onReads = vi.fn()
    await researchTakeHome(input({ onGathers, onReads }))
    expect(gatherCall().onGathers).toBe(onGathers)
    expect(readCall().onReads).toBe(onReads)
  })
})

describe('researchTakeHome — the digest callback', () => {
  it('digests each page it was handed, under the source’s own title', async () => {
    await researchTakeHome(input())
    expect(runTakeHomeDigest).toHaveBeenCalledTimes(2)
    expect(runTakeHomeDigest).toHaveBeenNthCalledWith(1, {
      company: 'Marram Systems',
      title: 'Write-up s1',
      text: 'the write-up behind s1',
    })
  })

  it('puts a date the digest found back on the source, and leaves one already known alone', async () => {
    runTakeHomeDigest.mockResolvedValue(digestOut({ publishedAt: '2024-05-01T00:00:00.000Z' }))
    const guide = await researchTakeHome(input())
    expect(guide.sources[0].publishedAt).toBe('2024-05-01T00:00:00.000Z')

    gatherEvidence.mockImplementation(async () => ({
      sources: [source('s1', { publishedAt: '2023-01-01T00:00:00.000Z' })],
      notes: [],
      grounded: true,
    }))
    const second = await researchTakeHome(input())
    expect(second.sources[0].publishedAt).toBe('2023-01-01T00:00:00.000Z')
  })

  it('leaves a source unread when the digest fails its guard, and finishes the run', async () => {
    runTakeHomeDigest.mockRejectedValue(new FlowOutputError('takeaways: required'))
    const guide = await researchTakeHome(input())
    expect(guide.guides).toEqual([])
    expect(synthesisCall().digests).toEqual([])
    // The sources are still in the guide: a page we could not digest is still a link.
    expect(guide.sources).toHaveLength(2)
  })

  it('leaves a source unread when the write-up had no takeaways, and takes no date from it', async () => {
    runTakeHomeDigest.mockResolvedValue(
      digestOut({ takeaways: [], publishedAt: '2024-05-01T00:00:00.000Z' }),
    )
    const guide = await researchTakeHome(input())
    expect(guide.guides).toEqual([])
    expect(guide.sources[0].publishedAt).toBeUndefined()
  })

  it('lets anything that is not a flow failure out — a broken key is not a thin source', async () => {
    runTakeHomeDigest.mockRejectedValue(new Error('403 from the model'))
    await expect(researchTakeHome(input())).rejects.toThrow(/403 from the model/)
  })
})

describe('researchTakeHome — what it hands on', () => {
  it('sorts the digests by source id, however they landed', async () => {
    const guide = await researchTakeHome(input())
    expect(guide.guides.map((g) => g.sourceId)).toEqual(['s1', 's2'])
    expect(synthesisCall().digests.map((d) => d.sourceId)).toEqual(['s1', 's2'])
  })

  it('stores what the page shows and hands the structured fields to the synthesis alone', async () => {
    const guide = await researchTakeHome(input())
    expect(guide.guides[0]).toEqual({
      sourceId: 's1',
      takeaways: ['what Write-up s1 says'],
      quotes: ['no more than four hours'],
      stale: false,
      firstHand: true,
    })
    expect(guide.guides[1].stale).toBe(true)
    expect(synthesisCall().digests[0]).toEqual({
      sourceId: 's1',
      task: 'Build a small ledger service.',
      timeGiven: 'Four hours',
      deliverables: ['A repository link'],
      evaluation: ['Tests, and a README that explains the trade-offs'],
      pitfalls: ['Gold-plating the schema'],
      takeaways: ['what Write-up s1 says'],
      quotes: ['no more than four hours'],
    })
  })

  it('hands the synthesis the job, the brief and every source id it may cite', async () => {
    await researchTakeHome(input())
    const s = synthesisCall()
    expect(s.jobSummary).toContain('Company: Marram Systems')
    expect(s.family).toBe('software engineering')
    // One field, doing both jobs: it is the block the prompt shows the model under "The brief, in
    // its own words", and it is the haystack the flow's guard checks every `Quoted` against.
    expect(s.brief).toBe(BRIEF)
    expect(s.notes).toEqual([
      { sourceIds: ['s1'], text: 'They give four hours for the ledger exercise.' },
    ])
    expect(s.sourceIds).toEqual(['s1', 's2'])
    expect(s.grounded).toBe(true)
  })

  it('says the web was lost when every gather failed', async () => {
    gatherEvidence.mockImplementation(async () => ({
      sources: [source('s1')],
      notes: [],
      grounded: false,
    }))
    const guide = await researchTakeHome(input())
    expect(synthesisCall().grounded).toBe(false)
    expect(guide.grounded).toBe(false)
  })

  it('returns the drawn guide with the run’s own facts on it', async () => {
    const guide = await researchTakeHome(input({ plannedFrom: '2026-09-05T09:00:00.000Z' }))
    expect(guide).toMatchObject(drawn)
    expect(guide.sources.map((s) => s.id)).toEqual(['s1', 's2'])
    // The brief this was drawn from, carried through untouched: the route compares it against
    // the round as it is after the run, and a plan that forgot its brief could not be refused.
    expect(guide.plannedFrom).toBe('2026-09-05T09:00:00.000Z')
    // Stamped when the research finished, not when it began.
    expect(guide.plannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(Number.isNaN(Date.parse(guide.plannedAt))).toBe(false)
    expect(Date.parse(guide.plannedAt)).toBeGreaterThanOrEqual(Date.parse(gatherCall().startedAt))
  })

  it('returns the guide’s own fields and nothing about the request that made it', async () => {
    // A guard against the one refactor that would break the smoke: this module takes a plain
    // input and returns a guide, and the route is the only thing that knows about a round.
    const guide = await researchTakeHome(input())
    expect(guide.plannedFrom).toBe('notice')
    expect(Object.keys(guide).sort()).toEqual(
      [
        'askRecruiter',
        'brief',
        'caveats',
        'grounded',
        'guides',
        'plan',
        'plannedAt',
        'plannedFrom',
        'reported',
        'sources',
      ].sort(),
    )
  })
})
