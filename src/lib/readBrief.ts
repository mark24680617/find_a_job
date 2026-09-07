import { htmlToText } from '@/adapters/html'
import { getGuardedText } from '@/adapters/http'
import { FetchBlockedError, PASTE_INSTEAD } from '@/adapters/types'
import { assignmentUrl } from '@/lib/assignment'

/**
 * The brief behind a public link, read as text.
 *
 * This is `profileSource`'s `readPage` with three differences, and they are the reason it is a
 * second function rather than a flag on the first. It rewrites the address before fetching, so
 * a Google Docs link and a GitHub blob link are read where their text actually lives. It reads
 * the content type the fetcher now reports, because a Docs export and a raw README are text
 * already and putting them through an HTML stripper would only cost them their shape. And it
 * applies no length floor of its own: how short is too short for a brief is the assignment
 * route's one rule, applied to pasted text, a transcribed PDF and a page alike, and a second
 * copy of it down here is how the three paths start disagreeing.
 *
 * Every refusal is a `FetchBlockedError` whose reason is written for the person reading it and
 * ends with what to do instead.
 */

/** This surface's version of `PASTE_INSTEAD`: what we were trying to read is the brief. */
const PASTE_BRIEF_INSTEAD = 'paste the brief’s text instead'

/**
 * The fetch layer words every refusal as `<what happened> — paste the job description text
 * instead`, which is the posting wizard's instruction, not this one. The cause is the part
 * worth keeping; the instruction is swapped for the one that applies here.
 */
const reword = (reason: string) => reason.replace(PASTE_INSTEAD, PASTE_BRIEF_INSTEAD)

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

export async function readBrief(raw: string): Promise<string> {
  // Trimmed before the rewrite, so a link pasted with a stray newline around it still matches
  // the two shapes `assignmentUrl` knows how to redirect.
  const url = toUrl(assignmentUrl(raw.trim()))
  if (!url) throw new FetchBlockedError(`That is not a web address — ${PASTE_BRIEF_INSTEAD}`)
  // Refused before the request rather than after it: LinkedIn serves nothing to a non-browser
  // client, so the round trip would only spend ten seconds arriving at a wall we already know
  // is there.
  if (isLinkedIn(url.hostname.toLowerCase())) {
    throw new FetchBlockedError(`LinkedIn blocks reading pages — ${PASTE_BRIEF_INSTEAD}`)
  }

  const { status, text, contentType } = await getGuardedText(url).catch((err: unknown) => {
    if (err instanceof FetchBlockedError) throw new FetchBlockedError(reword(err.reason))
    throw err
  })
  if (status !== 200) {
    throw new FetchBlockedError(`${url.hostname} answered with ${status} — ${PASTE_BRIEF_INSTEAD}`)
  }

  // `text/plain; charset=utf-8` is the same type as `text/plain`; the parameters describe the
  // bytes, which `fetch` has already dealt with by the time we are holding a string.
  const mediaType = contentType.split(';')[0].trim().toLowerCase()
  if (mediaType === 'application/pdf' || text.trimStart().startsWith('%PDF-')) {
    // The body is sniffed as well as the header because a static host will serve a PDF as
    // `application/octet-stream` without a second thought, and a PDF read as a page becomes a
    // screen of binary that everything downstream would treat as the brief. Nothing here can
    // read a PDF, but the product has a path that can, so the refusal names it.
    throw new FetchBlockedError('that link is a PDF — download it and add it as a file')
  }
  if (mediaType === 'text/plain' || mediaType === 'text/markdown') return text.trim()
  // Everything else — `text/html`, an absent header, a type nobody expected — is read as a
  // page. An absent header is overwhelmingly HTML, and stripping markup from a body that has
  // none costs its indentation, not its content, so guessing wrong in this direction is cheap.
  return htmlToText(text)
}
