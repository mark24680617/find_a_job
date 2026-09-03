import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, ProcessMap } from '@/lib/types'
import { FlowOutputError } from '@/ai/genkit'

// The pipeline with every seam faked: the three flows, the two APIs, the page reader, the
// redirect resolver, and the db. Under test is the orchestration — what runs, what is
// tolerated, what reaches the synthesis, what is stored.

const { requireUser, getApplication, updateApplication } = vi.hoisted(() => ({
  requireUser: vi.fn(), getApplication: vi.fn(), updateApplication: vi.fn(),
}))
const { runProcessGather, runProcessDigest, runProcessSynthesize } = vi.hoisted(() => ({
  runProcessGather: vi.fn(), runProcessDigest: vi.fn(), runProcessSynthesize: vi.fn(),
}))
const { searchReddit, searchHackerNews, readSource, resolveGroundingUrl } = vi.hoisted(() => ({
  searchReddit: vi.fn(), searchHackerNews: vi.fn(), readSource: vi.fn(), resolveGroundingUrl: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, updateApplication }))
vi.mock('@/ai/flows/processGather', () => ({ runProcessGather }))
vi.mock('@/ai/flows/processDigest', () => ({ runProcessDigest }))
vi.mock('@/ai/flows/processSynthesize', () => ({ runProcessSynthesize }))
vi.mock('@/lib/research/community', () => ({ searchReddit, searchHackerNews, readSource, resolveGroundingUrl }))

import { POST } from '@/app/api/applications/[id]/process/route'

const app = (over: Partial<Application> = {}): Application => ({
  id: 'app-1', company: 'Marram Systems', role: 'Senior Backend Engineer', jdRaw: 'We interview in three rounds. '.repeat(20),
  sourceUrl: 'https://jobs.ashbyhq.com/marram/1', adapter: 'ashby',
  parsed: { company: 'Marram Systems', role: 'Senior Backend Engineer', roleFacts: [], gates: [], themes: [], scope: 'per-application', advisory: '' },
  questions: [], status: 'applied', timeline: [], createdAt: '2026-08-27T00:00:00.000Z', ...over,
})

const post = () => new Request('https://example.test/api/applications/app-1/process', { method: 'POST' })
const ctx = { params: Promise.resolve({ id: 'app-1' }) }

const gathered = (uri: string, title: string, note: string) => ({
  notes: [note], chunks: [{ uri, title }], supports: [{ text: note, chunkIndices: [0] }],
})
const synthesized = {
  stages: [{ order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', whatItProbes: 'fit', tips: [], sourceIds: ['s1'], confidence: 'community' }],
  takeHome: { present: 'unknown', description: '', tips: [], sourceIds: [] }, askRecruiter: [], caveats: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(app())
  updateApplication.mockResolvedValue(undefined)
  runProcessGather.mockResolvedValue(gathered('https://vertexaisearch.cloud.google.com/grounding-api-redirect/A', 'reddit.com', 'The recruiter screen comes first.'))
  resolveGroundingUrl.mockImplementation(async (u: string) => (u.endsWith('/A') ? 'https://www.reddit.com/r/x/comments/1/marram/' : u))
  searchReddit.mockResolvedValue([{ url: 'https://www.reddit.com/r/x/comments/1/marram/', title: 'Marram interview', snippet: 'Marram' }])
  searchHackerNews.mockResolvedValue([])
  readSource.mockResolvedValue({ text: 'The loop is a recruiter screen then a take-home. '.repeat(30) })
  runProcessDigest.mockResolvedValue({ takeaways: ['Recruiter screen first'], questionsReported: [], quotes: ['recruiter screen then a take-home'], firstHand: true })
  runProcessSynthesize.mockResolvedValue(synthesized)
})

describe('POST /api/applications/[id]/process — guards', () => {
  it('401s before reading anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(post(), ctx)).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
  })
  it('404s an application that is not there, 400s one never interpreted', async () => {
    getApplication.mockResolvedValue(null)
    expect((await POST(post(), ctx)).status).toBe(404)
    getApplication.mockResolvedValue(app({ parsed: undefined }))
    expect((await POST(post(), ctx)).status).toBe(400)
    expect(runProcessGather).not.toHaveBeenCalled()
  })
})

describe('POST /api/applications/[id]/process — the pipeline', () => {
  it('runs all five gathers, resolves the grounding redirects, and merges them with the community hits', async () => {
    const res = await POST(post(), ctx)
    expect(res.status).toBe(200)
    expect(runProcessGather).toHaveBeenCalledTimes(5)
    expect(runProcessGather.mock.calls.map((c) => c[0].query)[0]).toBe('"Marram Systems" "Senior Backend Engineer" interview process')
    // One distinct redirect across all five gathers, so one HEAD — not one per gather.
    expect(resolveGroundingUrl).toHaveBeenCalledTimes(1)
    expect(resolveGroundingUrl).toHaveBeenCalledWith('https://vertexaisearch.cloud.google.com/grounding-api-redirect/A')
    const map = (await res.json()) as ProcessMap
    // The redirect resolved to the same thread Reddit search found: one source, not two — and
    // it carries the title the thread's author gave it, not the domain grounding named it by.
    expect(map.sources).toHaveLength(1)
    expect(map.sources[0]).toMatchObject({ id: 's1', host: 'reddit.com', kind: 'community', fetched: true, title: 'Marram interview' })
    expect(map.grounded).toBe(true)
  })
  it('reads the top guides, digests them, keeps their quotes, and marks them fetched', async () => {
    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    expect(readSource).toHaveBeenCalledTimes(1)
    expect(runProcessDigest).toHaveBeenCalledTimes(1)
    expect(map.guides).toEqual([{ sourceId: 's1', takeaways: ['Recruiter screen first'], questionsReported: [], quotes: ['recruiter screen then a take-home'], stale: false, firstHand: true }])
  })
  it('never reads a host on the no-fetch list, and keeps reading until six digests land', async () => {
    searchReddit.mockResolvedValue(
      [...Array(9)].map((_, i) => ({ url: `https://blog${i}.example.com/interview`, title: `Marram interview ${i}`, snippet: 'Marram' })),
    )
    runProcessGather.mockResolvedValue(gathered('https://www.glassdoor.com/Interview/Marram', 'glassdoor.com', 'Glassdoor says three rounds.'))
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    // The first three read to nothing — link posts with no comments under them. A page that
    // comes back empty must cost a read, not one of the six slots.
    let read = 0
    readSource.mockImplementation(async () =>
      read++ < 3 ? null : { text: 'The loop is a recruiter screen then a take-home. '.repeat(30) },
    )
    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    expect(readSource).toHaveBeenCalledTimes(9)
    expect(map.guides).toHaveLength(6)
    expect(readSource.mock.calls.every((c) => c[0].host !== 'glassdoor.com')).toBe(true)
  })
  it('gives up after twelve reads when none of them comes back with anything', async () => {
    searchReddit.mockResolvedValue(
      [...Array(15)].map((_, i) => ({ url: `https://blog${i}.example.com/interview`, title: `Marram interview ${i}`, snippet: 'Marram' })),
    )
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    readSource.mockResolvedValue(null)
    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    expect(readSource).toHaveBeenCalledTimes(12)
    expect(map.guides).toEqual([])
    expect(runProcessDigest).not.toHaveBeenCalled()
  })
  it('hands the synthesis every source id and the notes tagged with their sources', async () => {
    await POST(post(), ctx)
    const input = runProcessSynthesize.mock.calls[0][0]
    expect(input.sourceIds).toEqual(['s1'])
    expect(input.notes).toEqual([{ sourceIds: ['s1'], text: 'The recruiter screen comes first.' }])
    expect(input.digests[0].sourceId).toBe('s1')
    expect(input.grounded).toBe(true)
    expect(input.jobSummary).toContain('Company: Marram Systems')
    expect(input.jdExcerpt.length).toBeLessThanOrEqual(3000)
  })
  it('treats an empty supporting segment as supporting nothing', async () => {
    // Grounding sometimes returns a support whose segment is blank. It is a substring of every
    // note, so left in the list it would tag every observation with its chunks and put a
    // source under the synthesis that never said anything.
    runProcessGather.mockResolvedValue({
      notes: ['The recruiter screen comes first.', 'Something no support mentions.'],
      chunks: [
        { uri: 'https://example.com/empty-support', title: 'Empty' },
        { uri: 'https://example.com/real-support', title: 'Real' },
      ],
      supports: [
        { text: '', chunkIndices: [0] },
        { text: 'The recruiter screen comes first.', chunkIndices: [1] },
      ],
    })
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    searchReddit.mockResolvedValue([])

    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    // The blank support's chunk never became a source.
    expect(map.sources).toHaveLength(1)
    expect(map.sources[0].url).toBe('https://example.com/real-support')
    expect(runProcessSynthesize.mock.calls[0][0].notes).toEqual([
      { sourceIds: ['s1'], text: 'The recruiter screen comes first.' },
      { sourceIds: [], text: 'Something no support mentions.' },
    ])
  })
  it('refuses a supporting segment too short to be about the note it matches', async () => {
    // "in one day" is a substring of half the observations in a run. Attached, it would put
    // every chunk behind it under every one of them, and those ids go straight into the
    // synthesis and out again as a stage's sources — a pile, where a reader expects evidence.
    runProcessGather.mockResolvedValue({
      notes: ['The onsite is four rounds in one day.', 'The take-home is three days.'],
      chunks: [
        { uri: 'https://example.com/short-support', title: 'Short' },
        { uri: 'https://example.com/real-support', title: 'Real' },
      ],
      supports: [
        { text: 'in one day', chunkIndices: [0] },
        { text: 'The take-home is three days.', chunkIndices: [1] },
      ],
    })
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    searchReddit.mockResolvedValue([])

    await POST(post(), ctx)
    expect(runProcessSynthesize.mock.calls[0][0].notes).toEqual([
      { sourceIds: [], text: 'The onsite is four rounds in one day.' },
      { sourceIds: ['s2'], text: 'The take-home is three days.' },
    ])
  })
  it('lets a page it read replace a title that was only the domain', async () => {
    searchReddit.mockResolvedValue([])
    runProcessGather.mockResolvedValue({
      notes: ['The onsite is four rounds in one day.'],
      chunks: [{ uri: 'https://blog.example.com/how-i-got-in', title: 'blog.example.com' }],
      supports: [{ text: 'The onsite is four rounds in one day.', chunkIndices: [0] }],
    })
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    readSource.mockResolvedValue({
      text: 'The loop is a recruiter screen then a take-home. '.repeat(30),
      title: 'How I got in at Marram Systems',
    })

    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    expect(map.sources[0].title).toBe('How I got in at Marram Systems')
    // And it is renamed before the digest, which reads better for having a real title.
    expect(runProcessDigest.mock.calls[0][0].title).toBe('How I got in at Marram Systems')
  })
  it('names an unread source from its path, and leaves a homepage its host', async () => {
    searchReddit.mockResolvedValue([])
    runProcessGather.mockResolvedValue({
      notes: ['The onsite is four rounds in one day.'],
      chunks: [
        { uri: 'https://marram.dev/careers/how-we-hire', title: 'marram.dev' },
        { uri: 'https://marram.dev/', title: 'marram.dev' },
        // Named by a domain it only sits under, which is how three postings in one live run
        // all came back called "ashbyhq.com".
        { uri: 'https://jobs.ashbyhq.com/marram/senior-backend-engineer', title: 'ashbyhq.com' },
      ],
      supports: [{ text: 'The onsite is four rounds in one day.', chunkIndices: [0, 1, 2] }],
    })
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    readSource.mockResolvedValue(null)

    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    expect(map.sources.map((s) => s.title)).toEqual(['How We Hire', 'marram.dev', 'Senior Backend Engineer'])
  })
  it('cuts Medium’s trailing hash out of a path-derived title, and caps a long one', async () => {
    searchReddit.mockResolvedValue([])
    const longSlug = 'why-the-hiring-loop-at-this-company-runs-long-'.repeat(6) + 'end'
    runProcessGather.mockResolvedValue({
      notes: ['The onsite is four rounds in one day.'],
      chunks: [
        // Medium appends a hex id to every slug it publishes, and it would otherwise be the
        // last words of the title.
        { uri: 'https://arpita0412.medium.com/my-interview-at-marram-a-journey-to-the-final-round-19990fa6876a', title: 'medium.com' },
        { uri: `https://blog.example.com/${longSlug}`, title: 'blog.example.com' },
      ],
      supports: [{ text: 'The onsite is four rounds in one day.', chunkIndices: [0, 1] }],
    })
    resolveGroundingUrl.mockImplementation(async (u: string) => u)
    readSource.mockResolvedValue(null)

    const map = (await (await POST(post(), ctx)).json()) as ProcessMap
    expect(map.sources[0].title).toBe('My Interview At Marram A Journey To The Final Round')
    // The same 160 the read path cuts at: a title is stored whole and read aloud whole.
    expect(map.sources[1].title).toHaveLength(160)
  })
  it('tolerates a failed gather, a failed read, and a failed digest — and says when grounding was lost entirely', async () => {
    runProcessGather.mockRejectedValue(new Error('429'))
    readSource.mockResolvedValue(null)
    const res = await POST(post(), ctx)
    expect(res.status).toBe(200)
    const map = (await res.json()) as ProcessMap
    expect(map.grounded).toBe(false)
    expect(runProcessSynthesize.mock.calls[0][0].grounded).toBe(false)
    expect(map.guides).toEqual([])
    expect(map.sources[0].fetched).toBe(false)
  })
  it('persists the map on the application and answers it', async () => {
    const res = await POST(post(), ctx)
    const map = (await res.json()) as ProcessMap
    expect(updateApplication).toHaveBeenCalledWith('user-1', 'app-1', { process: expect.objectContaining({ stages: synthesized.stages, researchedAt: expect.any(String) }) })
    expect(map.researchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
  it('422s with the flow’s reason when the synthesis fails, writing nothing', async () => {
    runProcessSynthesize.mockRejectedValue(new FlowOutputError('the map failed its guard twice'))
    const res = await POST(post(), ctx)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ researchFailed: true })
    expect(updateApplication).not.toHaveBeenCalled()
  })
})
