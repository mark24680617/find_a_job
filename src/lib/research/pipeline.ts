import { humanizeSlug } from '@/adapters/html'
import { runProcessDigest } from '@/ai/flows/processDigest'
import { runProcessGather } from '@/ai/flows/processGather'
import { runProcessSynthesize } from '@/ai/flows/processSynthesize'
import { FlowOutputError } from '@/ai/genkit'
import { summarizeJob } from '@/ai/prompts/prepBrief'
import type { EvidenceDigest, EvidenceNote } from '@/ai/prompts/processSynthesize'
import { readSource, resolveGroundingUrl, searchHackerNews, searchReddit } from '@/lib/research/community'
import { planQueries } from '@/lib/research/planQueries'
import { isStale } from '@/lib/research/quotes'
import { roleFamily } from '@/lib/research/roleFamily'
import {
  capTitle,
  guessCompanyHost,
  hostOf,
  isFetchable,
  mergeSources,
  normalizeUrl,
  rankGuides,
  titledByHost,
  under,
  type SourceCandidate,
} from '@/lib/research/sources'
import type { CommunityGuide, ParsedJob, ProcessMap } from '@/lib/types'

/**
 * Research how one company interviews for one role. Five steps, each tolerant of the one
 * before it losing pieces: plan the searches; ask the model to read the web for each, keeping
 * the pages Google grounded it on; ask two public APIs where people compare notes; read the
 * best few write-ups ourselves and digest them; draw the loop from all of it, guarded.
 *
 * It knows nothing about requests or the database. The route calls it between its guards and
 * its write, and the smoke calls it with a posting it made up — same run, same spend, and no
 * second copy of the orchestration to drift from this one.
 */

const JD_EXCERPT = 3000
const MAX_GUIDES = 6
/** The ceiling on what one run will try to read, however many of them come to nothing. */
const MAX_READS = 12
/** Read this many at once, then look at what landed before spending the next few. */
const READ_BATCH = 3
/** Shorter than this, a supporting segment is a fragment that matches too much to mean much. */
const MIN_SUPPORT_LENGTH = 24

const settled = <T>(results: PromiseSettledResult<T>[]): T[] =>
  results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))

/**
 * What a run did that the finished map cannot carry: one search, whether it came back, the
 * observations it made, and the pages behind its grounding chunks once the redirects are
 * resolved. The smoke prints it to judge a run; the route asks for none of it.
 */
export interface GatherTrace {
  query: string
  ok: boolean
  notes: string[]
  urls: string[]
}

export interface ResearchInput {
  company: string
  role: string
  jdRaw: string
  sourceUrl?: string
  parsed: ParsedJob
  onGathers?: (traces: GatherTrace[]) => void
  /** How many pages the read step tried, and how many became digests. The smoke prints it. */
  onReads?: (counts: { attempted: number; landed: number }) => void
}

/**
 * The map, or a throw. `FlowOutputError` from the synthesis means the model could not draw a
 * loop that passed its guard — the caller decides what that costs the person. Nothing is
 * written anywhere here, so a failed run costs a minute and not a map they already had.
 */
export async function researchProcess(input: ResearchInput): Promise<ProcessMap> {
  const { company, role, jdRaw, sourceUrl, parsed } = input
  const family = roleFamily(role)
  // Two clocks, both taken from the start of the run. `startedAt` gives the searches their
  // year and measures the two-year windows below — which write-ups count as recent, which
  // digests are stale. The map's own stamp is taken at the end, when the research has
  // actually finished.
  const startedAt = new Date().toISOString()
  const queries = planQueries(company, role, family, new Date(startedAt).getFullYear())

  // 1 + 2. The searches, all at once. A gather that fails is a search that found nothing;
  // only when every one of them fails has the web been lost, and the synthesis is told.
  const searched = await Promise.allSettled(
    queries.map((q) => runProcessGather({ company, role, family, query: q.query })),
  )
  const gathers = settled(searched)
  const grounded = gathers.length > 0

  // 3. The community, by its own APIs. Their hits go into the pile before the grounded pages,
  // because `mergeSources` keeps the first title it sees for a URL: Reddit and HN carry the
  // title the thread's author gave it, while grounding often names a page by its bare domain.
  const community = settled(await Promise.allSettled([searchReddit(company), searchHackerNews(company)])).flat()
  const candidates: SourceCandidate[] = [...community]

  // Grounding names pages through Google's redirect; each distinct one is resolved once, so
  // the same thread found by search and by Reddit is one source with two supports rather than
  // two sources — and five searches that all landed on it cost one HEAD, not five. A chunk
  // that could not be read holds its slot with an empty uri, which is not an address to ask
  // Google about.
  const uris = [...new Set(gathers.flatMap((g) => g.chunks).map((c) => c.uri))].filter((u) => u !== '')
  const resolved = await Promise.all(uris.map((uri) => resolveGroundingUrl(uri)))
  const chunkUrls = new Map(uris.map((uri, i) => [uri, resolved[i]]))

  input.onGathers?.(
    searched.map((result, i) => ({
      query: queries[i].query,
      ok: result.status === 'fulfilled',
      notes: result.status === 'fulfilled' ? result.value.notes : [],
      urls:
        result.status === 'fulfilled'
          ? [...new Set(result.value.chunks.map((c) => chunkUrls.get(c.uri) ?? ''))].filter((u) => u !== '')
          : [],
    })),
  )

  // Five searches about one company repeat themselves. An observation two of them made is one
  // note supported by both, folded on its text the way the candidates are folded on their URL:
  // the same sentence five times over would read to the synthesis as five reports.
  const noteUrls = new Map<string, Set<string>>()
  for (const g of gathers) {
    const urlOf = (i: number) => chunkUrls.get(g.chunks[i]?.uri ?? '') ?? ''
    // An empty supporting segment supports nothing, and it has to be dropped rather than
    // merely ignored: `''` is a substring of every note, so one left in the list would tag
    // every observation in this gather with its chunks — and the synthesis would cite them.
    const supports = g.supports.filter((s) => s.text.trim() !== '')
    // A clause, a date, a "Yes" is a substring of half the notes in a run, so a short segment
    // would attach its chunks to all of them — and the synthesis would cite every one. What a
    // reader clicking "12 sources" should find is evidence, not a pile.
    const attaching = supports.filter((s) => s.text.trim().length >= MIN_SUPPORT_LENGTH)
    for (const s of supports) {
      const urls = s.chunkIndices.map(urlOf).filter((u) => u !== '')
      for (const u of urls) {
        const chunk = g.chunks[s.chunkIndices.find((i) => urlOf(i) === u) ?? 0]
        candidates.push({ url: u, title: chunk?.title ?? '', snippet: s.text })
      }
    }
    for (const note of g.notes) {
      // A note is supported by the chunks whose supporting segment it contains, or vice versa.
      const urls = attaching
        .filter((s) => note.includes(s.text) || s.text.includes(note))
        .flatMap((s) => s.chunkIndices.map(urlOf))
        .filter((u) => u !== '')
      const supporting = noteUrls.get(note) ?? new Set<string>()
      for (const u of urls) supporting.add(u)
      noteUrls.set(note, supporting)
    }
  }

  const ctxKinds = {
    postingHost: sourceUrl ? hostOf(sourceUrl) : undefined,
    companyHost: guessCompanyHost(company),
  }
  const sources = mergeSources(candidates, ctxKinds)
  const idByUrl = new Map(sources.map((s) => [s.url, s.id]))
  const idsFor = (urls: string[]) =>
    [...new Set(urls.map((u) => { try { return idByUrl.get(normalizeUrl(u)) } catch { return undefined } }))].filter((x): x is string => !!x)

  // 4. Read the best few ourselves, and digest each. A page that cannot be read, or a digest
  // the model cannot write, is a source that stays a link.
  //
  // Down the ranked list a few at a time rather than taking the top six and hoping: a page
  // that reads to nothing — a link post with no comments under it, a site that refuses us —
  // used to spend one of the six slots and leave the map with nothing read. So the six are
  // digests that landed, not reads attempted, and the list is walked until six have landed or
  // twelve pages have been tried. A batch that lands more than the slots left keeps them all;
  // the reading is already paid for.
  const ranked = rankGuides(sources, company, startedAt).filter(isFetchable)
  const guides: CommunityGuide[] = []
  const digestsForPrompt: EvidenceDigest[] = []
  let attempted = 0
  for (let i = 0; i < ranked.length && guides.length < MAX_GUIDES && attempted < MAX_READS; i += READ_BATCH) {
    const batch = ranked.slice(i, i + READ_BATCH)
    attempted += batch.length
    await Promise.all(
      batch.map(async (source) => {
        const read = await readSource(source)
        if (!read) return
        // Grounding names most pages by a bare domain, and a list of identical domains is
        // not something a reader can check. A page we fetched said what it is called, so it
        // replaces the domain — before the digest, which reads better for having a real title.
        if (read.title && titledByHost(source)) source.title = read.title
        let digest
        try {
          digest = await runProcessDigest({ company, title: source.title, text: read.text })
        } catch (error) {
          if (error instanceof FlowOutputError) return
          throw error
        }
        if (digest.takeaways.length === 0) return
        source.fetched = true
        if (digest.publishedAt && !source.publishedAt) source.publishedAt = digest.publishedAt
        guides.push({
          sourceId: source.id,
          takeaways: digest.takeaways,
          questionsReported: digest.questionsReported,
          quotes: digest.quotes,
          stale: isStale(source.publishedAt, startedAt),
          firstHand: digest.firstHand,
        })
        digestsForPrompt.push({ sourceId: source.id, takeaways: digest.takeaways, questionsReported: digest.questionsReported, quotes: digest.quotes })
      }),
    )
  }
  input.onReads?.({ attempted, landed: guides.length })

  // Whatever is still named by its bare host was never read, and most sources never are. The
  // last path segment is the page's own account of what it is about — "how-we-hire" reads as
  // something a person can decide to click, where a third "vercel.com" in the list does not.
  // A homepage has no such segment and keeps the host, which is all it ever had.
  //
  // Two details about the segment. Medium appends a hex id to every slug it publishes, so the
  // last words of the title would otherwise be a hash — it is cut for medium.com alone, where
  // the shape is the platform's own and known. And the result is capped like every title we
  // read, because a slug is as long as whoever wrote it made it.
  for (const source of sources) {
    if (!titledByHost(source)) continue
    const segments = new URL(source.url).pathname.split('/').filter((p) => p !== '')
    const last = segments[segments.length - 1] ?? ''
    const humanized = capTitle(humanizeSlug(under(source.host, 'medium.com') ? last.replace(/-[0-9a-f]{8,}$/i, '') : last))
    if (humanized !== '') source.title = humanized
  }

  guides.sort((a, b) => Number(a.sourceId.slice(1)) - Number(b.sourceId.slice(1)))
  digestsForPrompt.sort((a, b) => Number(a.sourceId.slice(1)) - Number(b.sourceId.slice(1)))

  // 5. Draw the loop.
  const notes: EvidenceNote[] = [...noteUrls].map(([text, urls]) => ({ sourceIds: idsFor([...urls]), text }))
  const drawn = await runProcessSynthesize({
    jobSummary: summarizeJob(parsed),
    jdExcerpt: jdRaw.slice(0, JD_EXCERPT),
    family,
    grounded,
    notes,
    digests: digestsForPrompt,
    sourceIds: sources.map((s) => s.id),
  })

  // Stamped here rather than at the top: the searching and the reading take a minute between
  // them, and what the record should carry is when the research finished, not when it began.
  const researchedAt = new Date().toISOString()
  return { ...drawn, sources, guides, grounded, researchedAt }
}
