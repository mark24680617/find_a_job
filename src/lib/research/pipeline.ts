import { humanizeSlug } from '@/adapters/html'
import { runProcessDigest, type ProcessDigest } from '@/ai/flows/processDigest'
import { runProcessGather } from '@/ai/flows/processGather'
import { runProcessSynthesize } from '@/ai/flows/processSynthesize'
import { FlowOutputError } from '@/ai/genkit'
import { summarizeJob } from '@/ai/prompts/prepBrief'
import type { EvidenceDigest, EvidenceNote } from '@/ai/prompts/processSynthesize'
import { readSource, resolveGroundingUrl, searchHackerNews, searchReddit } from '@/lib/research/community'
import { planQueries, type PlannedQuery } from '@/lib/research/planQueries'
import { isStale } from '@/lib/research/quotes'
import { roleFamily, type RoleFamily } from '@/lib/research/roleFamily'
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
import type { CommunityGuide, ParsedJob, ProcessMap, ResearchSource } from '@/lib/types'

/**
 * The research pipeline: ask the web about one company, then read the best of what it says.
 *
 * Two runs need it — the interview process map and the take-home guide — and they differ only
 * in the words they search with and in what they ask the model to take from a page. So the
 * walk itself lives here once, in two halves. `gatherEvidence` runs the planned searches, asks
 * the two community APIs, resolves Google's grounding redirects, and folds all of it into one
 * numbered list of sources with the observations tagged onto it. `readGuides` walks that list
 * a few at a time, reads the best pages, and hands each to a digest the caller supplies —
 * which is the only place the two runs differ. `researchProcess` is the first caller and is
 * now nothing more than those two halves with the process map's words in them.
 *
 * Neither half knows anything about requests or the database. A route calls them between its
 * guards and its write, and the smoke calls them with a posting it made up — same run, same
 * spend, and no second copy of the orchestration to drift from this one.
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
 * What a run did that the finished record cannot carry: one search, whether it came back, the
 * observations it made, and the pages behind its grounding chunks once the redirects are
 * resolved. The smoke prints it to judge a run; the routes ask for none of it.
 */
export interface GatherTrace {
  query: string
  ok: boolean
  notes: string[]
  urls: string[]
}

export interface GatherInput {
  company: string
  role: string
  family: RoleFamily
  queries: PlannedQuery[]
  /**
   * What to ask the two community APIs. `terms` replaces the word appended to the quoted
   * company name and `titlePattern` replaces the Hacker News title filter, because a run about
   * take-homes is looking for the threads a run about the loop would throw away.
   */
  community: { terms: string; titlePattern: RegExp }
  sourceUrl?: string
  /**
   * The run's one clock, taken before the first search. Nothing in this half measures with it
   * — the reading half does — but both are handed the same one, so a run cannot end up judging
   * its sources against two different moments.
   */
  startedAt: string
  onGathers?: (traces: GatherTrace[]) => void
}

/**
 * Steps 1 to 3 of a run: the searches, the community, and the sources they agree on. The
 * observations come back tagged with the ids of the pages that support them, which is what
 * lets a synthesis cite anything at all. `grounded` is false only when every search failed —
 * one that found nothing is a search, not a lost web.
 */
export async function gatherEvidence(
  input: GatherInput,
): Promise<{ sources: ResearchSource[]; notes: EvidenceNote[]; grounded: boolean }> {
  const { company, role, family, queries, community: ask, sourceUrl } = input

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
  const community = settled(
    await Promise.allSettled([
      searchReddit(company, { terms: ask.terms }),
      searchHackerNews(company, { terms: ask.terms, titlePattern: ask.titlePattern }),
    ]),
  ).flat()
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

  // Several searches about one company repeat themselves. An observation two of them made is
  // one note supported by both, folded on its text the way the candidates are folded on their
  // URL: the same sentence five times over would read to the synthesis as five reports.
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

  const notes: EvidenceNote[] = [...noteUrls].map(([text, urls]) => ({ sourceIds: idsFor([...urls]), text }))
  return { sources, notes, grounded }
}

export interface ReadInput<D> {
  sources: ResearchSource[]
  company: string
  startedAt: string
  /** The word this run is looking for in a title — see `rankGuides`. */
  titleTerm: RegExp
  /**
   * What to take from one page. The only part of the read step the two runs do not share, so
   * it is the caller's: it may set `source.publishedAt` from a date it found in the text, and
   * it returns `null` for a page that gave it nothing — a failed digest included, which is why
   * `FlowOutputError` is caught there and not here.
   */
  digest: (source: ResearchSource, text: string) => Promise<D | null>
  /** How many pages this step tried, and how many became digests. The smoke prints it. */
  onReads?: (counts: { attempted: number; landed: number }) => void
}

/**
 * Step 4: read the best few sources ourselves and digest each. A page that cannot be read, or
 * a digest the caller will not take, is a source that stays a link.
 *
 * Down the ranked list a few at a time rather than taking the top six and hoping: a page that
 * reads to nothing — a link post with no comments under it, a site that refuses us — used to
 * spend one of the six slots and leave the record with nothing read. So the six are digests
 * that landed, not reads attempted, and the list is walked until six have landed or twelve
 * pages have been tried. A batch that lands more than the slots left keeps them all; the
 * reading is already paid for.
 *
 * The sources are mutated in place — retitled, marked fetched, sometimes dated — because they
 * are the same records the caller is about to store. Results come back in landing order, which
 * is whatever order a batch resolved in; the caller sorts them.
 */
export async function readGuides<D>(
  input: ReadInput<D>,
): Promise<{ sourceId: string; digest: D; stale: boolean }[]> {
  const { sources, company, startedAt, titleTerm } = input
  const ranked = rankGuides(sources, company, startedAt, titleTerm).filter(isFetchable)
  const landed: { sourceId: string; digest: D; stale: boolean }[] = []
  let attempted = 0
  for (let i = 0; i < ranked.length && landed.length < MAX_GUIDES && attempted < MAX_READS; i += READ_BATCH) {
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
        const digest = await input.digest(source, read.text)
        if (digest === null) return
        source.fetched = true
        // After the digest, deliberately: the callback may have found a date in the page that
        // the source did not carry, and that is the date staleness should be measured from.
        landed.push({ sourceId: source.id, digest, stale: isStale(source.publishedAt, startedAt) })
      }),
    )
  }
  input.onReads?.({ attempted, landed: landed.length })

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

  return landed
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
 * Research how one company interviews for one role: the two halves above with the process
 * map's words in them, then the synthesis.
 *
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

  const { sources, notes, grounded } = await gatherEvidence({
    company,
    role,
    family,
    queries,
    community: { terms: 'interview', titlePattern: /interview/i },
    sourceUrl,
    startedAt,
    onGathers: input.onGathers,
  })

  const read = await readGuides<ProcessDigest>({
    sources,
    company,
    startedAt,
    titleTerm: /interview/i,
    digest: async (source, text) => {
      let digest
      try {
        digest = await runProcessDigest({ company, title: source.title, text })
      } catch (error) {
        // A page the model could not digest twice is a source that stays a link; anything
        // else — a network fault, a bug — is not this run's to swallow.
        if (error instanceof FlowOutputError) return null
        throw error
      }
      if (digest.takeaways.length === 0) return null
      if (digest.publishedAt && !source.publishedAt) source.publishedAt = digest.publishedAt
      return digest
    },
    onReads: input.onReads,
  })

  // Landing order is whatever order the batches resolved in; the record reads by source id.
  read.sort((a, b) => Number(a.sourceId.slice(1)) - Number(b.sourceId.slice(1)))
  const guides: CommunityGuide[] = read.map(({ sourceId, digest, stale }) => ({
    sourceId,
    takeaways: digest.takeaways,
    questionsReported: digest.questionsReported,
    quotes: digest.quotes,
    stale,
    firstHand: digest.firstHand,
  }))
  const digestsForPrompt: EvidenceDigest[] = read.map(({ sourceId, digest }) => ({
    sourceId,
    takeaways: digest.takeaways,
    questionsReported: digest.questionsReported,
    quotes: digest.quotes,
  }))

  // 5. Draw the loop.
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
