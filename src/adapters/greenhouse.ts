import { decodeEntities, htmlToText, joinSections } from './html'
import { getJson } from './http'
import { FetchBlockedError, PASTE_INSTEAD, type ParsedPosting } from './types'

/** Greenhouse board URLs are `/{board}/jobs/{id}` on either of its two hostnames. */

const jobApi = (board: string, id: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`

interface GreenhouseJob {
  title?: string
  company_name?: string
  location?: { name?: string }
  content?: string
}

export function parseGreenhouse(json: unknown): ParsedPosting {
  const job = (json ?? {}) as GreenhouseJob
  return {
    company: job.company_name ?? '',
    role: job.title ?? '',
    // `content` is HTML that has itself been entity-escaped, so it needs decoding before
    // the markup is even visible to the stripper.
    jdText: joinSections(job.title, job.location?.name, htmlToText(decodeEntities(job.content ?? ''))),
  }
}

export async function fetchGreenhouse(url: URL): Promise<ParsedPosting> {
  const [board, , id] = url.pathname.split('/').filter(Boolean)
  if (!board || !id) {
    throw new FetchBlockedError(`That Greenhouse link has no job id in it — ${PASTE_INSTEAD}`)
  }

  const { status, json } = await getJson(jobApi(board, id))
  if (status !== 200) {
    throw new FetchBlockedError(
      `Greenhouse does not have that posting any more (${status}) — ${PASTE_INSTEAD}`,
    )
  }
  return parseGreenhouse(json)
}
