import { fetchAshby } from './ashby'
import { fetchGeneric } from './genericFetch'
import { fetchGreenhouse } from './greenhouse'
import { fetchLever } from './lever'
import { FetchBlockedError, PASTE_INSTEAD, type FetchedPosting } from './types'

export { FetchBlockedError } from './types'
export type { FetchedPosting, ParsedPosting } from './types'

export type AdapterName = 'ashby' | 'greenhouse' | 'lever' | 'generic'

const FETCHERS = {
  ashby: fetchAshby,
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  generic: fetchGeneric,
}

function toUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * Which source a posting URL belongs to. LinkedIn is not a name here — it has no adapter,
 * because it serves nothing to a non-browser client; `fetchPosting` is what refuses it.
 */
export function detectAdapter(url: string): AdapterName {
  const parsed = toUrl(url)
  return parsed ? adapterFor(parsed) : 'generic'
}

function adapterFor(url: URL): AdapterName {
  const host = url.hostname.toLowerCase()
  if (host === 'jobs.ashbyhq.com' || url.searchParams.has('ashby_jid')) return 'ashby'
  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') return 'greenhouse'
  if (host === 'jobs.lever.co') return 'lever'
  return 'generic'
}

const isLinkedIn = (host: string) => host === 'linkedin.com' || host.endsWith('.linkedin.com')

/**
 * LinkedIn serves nothing to a non-browser client, and "paste the text instead" is the worse
 * of the two ways out of that: almost every posting on LinkedIn carries an "Apply on company
 * website" link, and the address behind it is usually Greenhouse, Ashby or Lever — which this
 * app reads directly, keeps as the source link, and parses the company and role out of. So the
 * refusal names that route first and keeps the paste as the fallback it is.
 */
const LINKEDIN_REFUSAL =
  'LinkedIn serves postings only to a browser. Open it there, follow its “Apply on company ' +
  'website” link, and paste that address here — it is usually Greenhouse, Ashby or Lever, ' +
  `which read cleanly. Or ${PASTE_INSTEAD}.`

export async function fetchPosting(url: string): Promise<FetchedPosting> {
  const parsed = toUrl(url)
  if (!parsed) throw new FetchBlockedError(`That is not a job posting link — ${PASTE_INSTEAD}`)
  if (isLinkedIn(parsed.hostname.toLowerCase())) {
    throw new FetchBlockedError(LINKEDIN_REFUSAL)
  }

  const adapter = adapterFor(parsed)
  return { ...(await FETCHERS[adapter](parsed)), adapter }
}
