import { htmlToText, humanizeSlug, joinSections } from './html'
import { getJson } from './http'
import { FetchBlockedError, PASTE_INSTEAD, type ParsedPosting } from './types'

/** Lever posting URLs are `/{org}/{id}`, and its API mirrors that path exactly. */

const postingApi = (org: string, id: string) =>
  `https://api.lever.co/v0/postings/${encodeURIComponent(org)}/${encodeURIComponent(id)}`

interface LeverPosting {
  text?: string
  categories?: { location?: string; commitment?: string }
  descriptionPlain?: string
  lists?: { text?: string; content?: string }[]
  hostedUrl?: string
}

export function parseLever(json: unknown): ParsedPosting {
  const p = (json ?? {}) as LeverPosting
  // Lever splits a posting into the intro (`descriptionPlain`) plus one block per bulleted
  // section, so the requirements only exist inside `lists`.
  const lists = (p.lists ?? []).map((l) => joinSections(l.text, htmlToText(l.content ?? '')))
  return {
    // Like Ashby, the payload names no company — only the org slug in its own URL.
    company: humanizeSlug(orgOf(p.hostedUrl)),
    role: p.text ?? '',
    jdText: joinSections(p.text, p.categories?.location, p.descriptionPlain, ...lists),
  }
}

function orgOf(hostedUrl: string | undefined): string {
  if (!hostedUrl) return ''
  try {
    return new URL(hostedUrl).pathname.split('/').filter(Boolean)[0] ?? ''
  } catch {
    return ''
  }
}

export async function fetchLever(url: URL): Promise<ParsedPosting> {
  const [org, id] = url.pathname.split('/').filter(Boolean)
  if (!org || !id) {
    throw new FetchBlockedError(`That Lever link has no job id in it — ${PASTE_INSTEAD}`)
  }

  const { status, json } = await getJson(postingApi(org, id))
  if (status !== 200) {
    throw new FetchBlockedError(
      `Lever does not have that posting any more (${status}) — ${PASTE_INSTEAD}`,
    )
  }
  return parseLever(json)
}
