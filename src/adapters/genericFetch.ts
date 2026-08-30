import { decodeEntities, htmlToText } from './html'
import { getGuardedText } from './http'
import { FetchBlockedError, PASTE_INSTEAD, type ParsedPosting } from './types'

/**
 * The fallback for a career page with no API behind it. Anything below this much text is a
 * shell that renders its content with JavaScript, or a challenge page — either way there is
 * nothing to answer questions from, so it is better to say so than to hand Gemini a stub.
 */
const MIN_JD_CHARS = 500

// Page titles usually read "Role | Company" or "Role - Company". A bare hyphen inside a word
// (Full-Stack) must not split, so only a spaced one counts.
const TITLE_SEPARATORS = /\s*[|—–]\s*|\s+-\s+/

export function parseGeneric(html: string): ParsedPosting {
  const jdText = htmlToText(html)
  if (jdText.length < MIN_JD_CHARS) {
    throw new FetchBlockedError(
      `That page has almost no readable text — it is probably drawn by JavaScript, so ${PASTE_INSTEAD}`,
    )
  }

  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = title.split(TITLE_SEPARATORS).filter(Boolean)

  return {
    company: parts.length > 1 ? parts[parts.length - 1] : '',
    role: parts[0] ?? '',
    jdText,
  }
}

export async function fetchGeneric(url: URL): Promise<ParsedPosting> {
  const { status, text } = await getGuardedText(url)
  if (status !== 200) {
    throw new FetchBlockedError(`${url.hostname} answered with ${status} — ${PASTE_INSTEAD}`)
  }
  return parseGeneric(text)
}
