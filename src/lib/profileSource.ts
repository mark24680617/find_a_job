import { htmlToText } from '@/adapters/html'
import { getGuardedText } from '@/adapters/http'
import { FetchBlockedError, PASTE_INSTEAD } from '@/adapters/types'

/**
 * What the profile routes are allowed to read: a resume PDF, pasted notes, and the address of a
 * page the candidate points at.
 *
 * A page fetched here is read as if the candidate had pasted it — one prompt, one never-invent
 * rule, one set of citation rules. What the URL adds is a way in for the half of a career that
 * lives on a personal site rather than in a resume, and a way for the fetch to fail out loud:
 * anything the server cannot or will not read comes back as a `FetchBlockedError` whose reason
 * says what to do instead.
 *
 * Both `/api/profile/ingest` (the seeder and story path) and `/api/profile/reconcile` (the
 * screen) read their sources through here, so a page that is refused for one is refused for the
 * other, in the same words.
 */

/** Below this, the page had no prose on it — a shell drawn by JavaScript, or a login wall. */
const MIN_PAGE_CHARS = 200

/** The profile's version of `PASTE_INSTEAD`: there is no job description on this screen. */
const PASTE_HERE_INSTEAD = 'paste the page’s text into Pasted notes instead'

/**
 * The fetch layer words every refusal as `<what happened> — paste the job description text
 * instead`, which is the posting wizard's instruction, not this page's. The cause is the part
 * worth keeping; the instruction is swapped for the one that applies here.
 */
const reword = (reason: string) => reason.replace(PASTE_INSTEAD, PASTE_HERE_INSTEAD)

/** A field the client either sent as a usable string or did not usefully send at all. */
export function readString(body: unknown, key: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const isLinkedIn = (host: string) => host === 'linkedin.com' || host.endsWith('.linkedin.com')

/** The address as a URL, or null for anything that is not one we could fetch over the web. */
function toUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * The readable text of a page the candidate pointed us at. Every failure is a
 * `FetchBlockedError` whose reason is written for the person reading it.
 *
 * LinkedIn is refused before the request rather than after it: it serves nothing to a
 * non-browser client, so the round trip would only spend ten seconds arriving at a wall we
 * already know is there. Everything else goes through `getGuardedText`, which checks the
 * address — and every redirect hop — against the private ranges this server can otherwise
 * reach.
 */
export async function readPage(raw: string): Promise<string> {
  const url = toUrl(raw)
  if (!url) throw new FetchBlockedError(`That is not a web address — ${PASTE_HERE_INSTEAD}`)
  if (isLinkedIn(url.hostname.toLowerCase())) {
    throw new FetchBlockedError(
      'LinkedIn blocks reading profiles — paste your About and Experience text into Pasted notes instead.',
    )
  }

  const { status, text } = await getGuardedText(url).catch((err: unknown) => {
    if (err instanceof FetchBlockedError) throw new FetchBlockedError(reword(err.reason))
    throw err
  })
  if (status !== 200) {
    throw new FetchBlockedError(`${url.hostname} answered with ${status} — ${PASTE_HERE_INSTEAD}`)
  }

  const page = htmlToText(text)
  if (page.length < MIN_PAGE_CHARS) {
    throw new FetchBlockedError(
      `There is almost no readable text on that page — ${PASTE_HERE_INSTEAD}`,
    )
  }
  return page
}

/** The three source fields as the client sent them. */
export interface ProfileSource {
  pdfBase64?: string
  pastedText?: string
  url?: string
}

/** The source fields off a request body, each present only when it is a usable string. */
export function readSource(body: unknown): ProfileSource {
  return {
    pdfBase64: readString(body, 'pdfBase64'),
    pastedText: readString(body, 'pastedText'),
    url: readString(body, 'url'),
  }
}

/**
 * The pasted half of an extraction: the notes and, when a URL was given, the page read from it,
 * joined as one block. Its address leads it so a source snippet taken from it can still be
 * traced back to where it was read from. Throws `FetchBlockedError` if the page cannot be read.
 */
export async function resolvePastedText(source: ProfileSource): Promise<string | undefined> {
  const fetched = source.url ? await readPage(source.url) : undefined
  return (
    [source.pastedText, fetched && `From ${source.url}:\n${fetched}`].filter(Boolean).join('\n\n') ||
    undefined
  )
}
