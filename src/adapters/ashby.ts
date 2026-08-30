import { htmlToText, humanizeSlug, joinSections } from './html'
import { getJson } from './http'
import { FetchBlockedError, PASTE_INSTEAD, type ParsedPosting } from './types'

/**
 * Ashby publishes a whole board at once — there is no single-posting endpoint — so the
 * posting is found by id inside the board payload.
 */

const boardApi = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`

// A company embedding Ashby on its own site (…/careers?ashby_jid=…) never puts the board
// slug in the URL, and the slug often hyphenates a name the domain runs together
// (trmlabs.com is the board `trm-labs`). These are the suffixes worth one 404 to try.
const NAME_SUFFIXES = ['labs', 'health', 'works', 'tech', 'hq', 'ai']

interface AshbyPosting {
  id?: string
  title?: string
  location?: string
  descriptionHtml?: string
  jobUrl?: string
}

const pathParts = (url: URL) => url.pathname.split('/').filter(Boolean)

/** The posting id: a path segment on a hosted board, a query param on an embedded one. */
export function ashbyJobId(url: URL): string {
  const embedded = url.searchParams.get('ashby_jid')
  if (embedded) return embedded
  return pathParts(url)[1] ?? ''
}

/** Board slugs to try, best guess first. A hosted URL already carries the answer. */
export function ashbySlugCandidates(url: URL): string[] {
  if (url.hostname === 'jobs.ashbyhq.com') return pathParts(url).slice(0, 1)

  const host = url.hostname.replace(/^www\./, '').split('.')
  const secondLevel = host.length > 1 ? host[host.length - 2] : host[0]
  const suffix = NAME_SUFFIXES.find(
    (s) => secondLevel.length > s.length + 1 && secondLevel.endsWith(s),
  )
  const variants = [secondLevel]
  if (suffix) {
    const head = secondLevel.slice(0, -suffix.length)
    variants.push(`${head}-${suffix}`, head)
  }

  return [...new Set([...pathParts(url).slice(0, 1), ...variants])]
}

function findPosting(json: unknown, jobId: string): AshbyPosting | null {
  const jobs = (json as { jobs?: unknown } | null)?.jobs
  const listed = Array.isArray(jobs) ? (jobs as AshbyPosting[]) : []
  return listed.find((j) => j.id === jobId) ?? null
}

function toPosting(posting: AshbyPosting): ParsedPosting {
  return {
    // The board payload has no company name anywhere; the slug in the posting's own URL is
    // the closest thing to one, and the user can correct it before submitting.
    company: humanizeSlug(slugOf(posting.jobUrl)),
    role: posting.title ?? '',
    jdText: joinSections(posting.title, posting.location, htmlToText(posting.descriptionHtml ?? '')),
  }
}

export function parseAshby(json: unknown, jobId: string): ParsedPosting {
  const posting = findPosting(json, jobId)
  if (!posting) {
    throw new FetchBlockedError(
      `That posting is not on the Ashby board we found for this company — ${PASTE_INSTEAD}`,
    )
  }
  return toPosting(posting)
}

function slugOf(jobUrl: string | undefined): string {
  if (!jobUrl) return ''
  try {
    return new URL(jobUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  } catch {
    return ''
  }
}

export async function fetchAshby(url: URL): Promise<ParsedPosting> {
  const jobId = ashbyJobId(url)
  if (!jobId) throw new FetchBlockedError(`That Ashby link has no job id in it — ${PASTE_INSTEAD}`)

  // A candidate that answers is not necessarily the right board — a company's own
  // /careers path segment can be somebody else's Ashby slug — so a board without the
  // posting on it is not the end of the walk.
  const candidates = ashbySlugCandidates(url)
  let boardAnswered = false
  for (const slug of candidates) {
    const { status, json } = await getJson(boardApi(slug))
    if (status !== 200) continue
    boardAnswered = true
    const posting = findPosting(json, jobId)
    if (posting) return toPosting(posting)
  }

  throw new FetchBlockedError(
    boardAnswered
      ? `That posting is no longer listed on this company's Ashby board — ${PASTE_INSTEAD}`
      : `Could not work out which Ashby job board this posting lives on (tried ${candidates.join(', ')}) — ${PASTE_INSTEAD}`,
  )
}
