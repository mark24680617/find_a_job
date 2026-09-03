import { decodeEntities, htmlToText } from '@/adapters/html'
import { getGuardedText, getJson } from '@/adapters/http'
import { REDDIT_UA, redditToken } from '@/lib/research/redditAuth'
import { capTitle, hostOf, under, type SourceCandidate } from '@/lib/research/sources'
import type { ResearchSource } from '@/lib/types'

/**
 * The parts of the research that touch the web ourselves: two public APIs where people talk
 * about interviewing, the reader that turns one write-up into text a model can digest, and
 * the one-hop resolution of Google's grounding redirects into the pages behind them.
 *
 * Four paths reach the network here, and they are guarded differently because they are
 * trusted differently. An arbitrary page — whatever a search happened to return — is read
 * only through `getGuardedText`, which checks the address of every hop. The Hacker News reads
 * go to a fixed public API host through `getJson`, and the one caller-supplied piece (an item
 * id) is matched against a literal shape before it is interpolated, so a search result can
 * never choose the address. Reddit goes to its fixed OAuth host by hand, because a bearer
 * token and Reddit's required User-Agent are headers `getJson` decides for everybody; the
 * thread path is shape-matched the same way. The single HEAD in `resolveGroundingUrl` goes to
 * Google's fixed redirect host.
 *
 * What this module does not decide is whether a host may be fetched at all: the route applies
 * `isFetchable` before calling here, and `readSource` trusts it to have done so. Every failure
 * is a missing source rather than a failed request — the map is drawn from what could be read.
 */

const READ_CAP = 12_000
const READ_FLOOR = 800

/**
 * Both hand-rolled fetches here abort where every other network call on this side of the
 * product does. The HEAD needs it as much as the Reddit read: it runs once per grounding URI,
 * all of them at once, and one stalled request would hold the whole run until undici's own
 * 300-second header timeout — which is also how long Cloud Run waits before giving up.
 */
const FETCH_TIMEOUT_MS = 10_000

const quoted = (company: string) => `"${company.replace(/"/g, '')}" interview`

interface RedditPost {
  title?: unknown
  permalink?: unknown
  created_utc?: unknown
  selftext?: unknown
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

const fromUnix = (secs: unknown): string | undefined => {
  if (typeof secs !== 'number' || !Number.isFinite(secs)) return undefined
  try {
    return new Date(secs * 1000).toISOString()
  } catch {
    // A timestamp past the range a Date can express is one unusable field on one hit, not a
    // reason to lose the whole search — which is what letting the RangeError out would do.
    return undefined
  }
}

/**
 * A GET on Reddit's OAuth host, or `null` when this deployment cannot read Reddit at all.
 * `getJson` cannot carry it: the request needs a bearer token and Reddit's own User-Agent,
 * and those are headers that module decides once for every caller. The host is fixed and the
 * one caller-supplied piece of a path is shape-matched before it arrives here, which is the
 * invariant `getJson`'s address check exists to back up rather than to create.
 */
async function redditGet(url: string): Promise<{ status: number; json: unknown } | null> {
  const token = await redditToken()
  // No app id configured. Reddit's public JSON is closed to servers, so the honest thing is
  // to read no Reddit rather than spend a request that can only come back 403.
  if (!token) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': REDDIT_UA },
    })
    return { status: res.status, json: res.ok ? await res.json() : null }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function searchReddit(company: string): Promise<SourceCandidate[]> {
  // `raw_json=1` asks Reddit not to HTML-escape the body it returns, so a post reaches the
  // digest as the person wrote it rather than full of `&amp;`.
  const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(quoted(company))}&sort=relevance&t=all&limit=10&raw_json=1`
  try {
    const res = await redditGet(url)
    if (!res || res.status !== 200) return []
    const children = asRecord(asRecord(res.json)?.data)?.children
    if (!Array.isArray(children)) return []
    const out: SourceCandidate[] = []
    for (const child of children) {
      const post = asRecord(asRecord(child)?.data) as RedditPost | null
      if (!post || typeof post.permalink !== 'string' || typeof post.title !== 'string') continue
      const publishedAt = fromUnix(post.created_utc)
      out.push({
        url: `https://www.reddit.com${post.permalink}`,
        title: post.title,
        snippet: typeof post.selftext === 'string' ? post.selftext.slice(0, 600) : '',
        ...(publishedAt ? { publishedAt } : {}),
      })
    }
    return out
  } catch {
    return []
  }
}

/**
 * The other sense of "interview": a founder talking to a journalist. These titles pass a
 * plain `/interview/i` and describe nothing a candidate will sit through.
 */
const PRESS_INTERVIEW = /interview(ed|s)?\s+(with|by)\b|\b(ceo|cto|founder|co-founder)\b|\bpodcast\b|\bon mixergy\b/i

/** Below this, a discussion page is a headline and a shrug — not enough to digest. */
const HN_MIN_COMMENTS = 3

/**
 * "Show HN: Interview practice tool" is somebody's side project, not an account of anybody's
 * loop. It passes the title filter because the word is right there in the product's name.
 */
const HN_SHOW = /^\s*(show|launch|tell)\s+hn\b/i

/**
 * Hosts a link post points at that have no prose to read. The demo platforms are where a
 * Show HN's project lives, and a video page reads to its own chrome — both fail the 800-
 * character floor after spending one of the twelve read slots. Deliberately absent:
 * `github.io` and `pages.dev`, which is where people put the personal blog the write-up is on.
 */
const HN_UNREADABLE_HOSTS: readonly string[] = [
  'vercel.app', 'netlify.app', 'herokuapp.com', 'youtube.com', 'youtu.be', 'vimeo.com',
]

export async function searchHackerNews(company: string): Promise<SourceCandidate[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(quoted(company))}&tags=story&hitsPerPage=10`
  try {
    const { status, json } = await getJson(url)
    if (status !== 200) return []
    const hits = asRecord(json)?.hits
    if (!Array.isArray(hits)) return []
    const out: SourceCandidate[] = []
    for (const raw of hits) {
      const hit = asRecord(raw)
      if (!hit || typeof hit.title !== 'string' || typeof hit.objectID !== 'string') continue
      // A story about the company's funding is not a story about its interviews.
      if (!/interview/i.test(hit.title)) continue
      if (PRESS_INTERVIEW.test(hit.title)) continue
      if (HN_SHOW.test(hit.title)) continue
      const publishedAt = typeof hit.created_at === 'string' ? { publishedAt: hit.created_at } : {}
      // Most HN hits are submissions of somebody else's write-up, and the write-up is the
      // thing worth reading: the discussion page under a link post is a title with nothing
      // beneath it. So the candidate is the page that was linked, carrying the title HN gave
      // it — which is a real sentence, where grounding would have named it by bare domain.
      if (typeof hit.url === 'string' && /^https?:\/\//i.test(hit.url)) {
        // A page with no prose on it is not a candidate at all: the discussion above it is
        // empty by definition for a link post, so there is nothing to fall through to.
        const host = hostOf(hit.url)
        if (HN_UNREADABLE_HOSTS.some((h) => under(host, h))) continue
        out.push({ url: hit.url, title: hit.title, snippet: '', ...publishedAt })
        continue
      }
      // An Ask HN has no link; the discussion is the write-up, and only if people answered.
      if (typeof hit.num_comments === 'number' && hit.num_comments >= HN_MIN_COMMENTS) {
        out.push({
          url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
          title: hit.title,
          snippet: '',
          ...publishedAt,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * A thread as text: the title, the post, then the top-level comments by score. Deleted and
 * removed comments are skipped — they carry nothing and would count against the cap.
 */
export function flattenRedditThread(json: unknown): string {
  if (!Array.isArray(json) || json.length < 1) return ''
  const postListing = asRecord(asRecord(json[0])?.data)?.children
  const post = Array.isArray(postListing) ? asRecord(asRecord(postListing[0])?.data) : null
  const lines: string[] = []
  if (post) {
    if (typeof post.title === 'string') lines.push(post.title)
    if (typeof post.selftext === 'string' && post.selftext.trim()) lines.push(post.selftext)
  }
  const commentListing = json.length > 1 ? asRecord(asRecord(json[1])?.data)?.children : undefined
  const comments: { body: string; score: number }[] = []
  if (Array.isArray(commentListing)) {
    for (const c of commentListing) {
      const d = asRecord(asRecord(c)?.data)
      if (!d || typeof d.body !== 'string') continue
      if (d.body === '[deleted]' || d.body === '[removed]') continue
      comments.push({ body: d.body, score: typeof d.score === 'number' ? d.score : 0 })
    }
  }
  comments.sort((a, b) => b.score - a.score)
  for (const c of comments.slice(0, 15)) lines.push(c.body)
  return lines.join('\n\n')
}

/** An HN item and its replies, depth-first, HTML stripped. */
export function flattenHnItem(json: unknown): string {
  const lines: string[] = []
  const walk = (node: unknown) => {
    const item = asRecord(node)
    if (!item) return
    if (typeof item.title === 'string') lines.push(item.title)
    if (typeof item.text === 'string') lines.push(htmlToText(item.text))
    if (Array.isArray(item.children)) for (const child of item.children) walk(child)
  }
  walk(json)
  return lines.join('\n\n')
}

const cap = (text: string): string | null => {
  const t = text.trim()
  return t.length >= READ_FLOOR ? t.slice(0, READ_CAP) : null
}

/**
 * The canonical shape of a thread's path, `/r/<subreddit>/comments/<id>[/<slug>]`. A source
 * URL is whatever a search returned, and it is about to be spliced into an address on a host
 * we trust, so it is matched rather than sanitised: a listing, a profile, or a path the URL
 * parser has normalised into something else entirely all fail to match and are not read.
 * The slug carries no `%`, so a traversal spelled `%2e%2e%2f` — which the parser leaves
 * untouched, being already encoded — cannot hide inside it either.
 */
const REDDIT_THREAD_PATH = /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+(?:\/[A-Za-z0-9_-]*)?$/i

/**
 * `searchParams.get` decodes, so an id of `%2F..%2F..%2Fsettings` arrives as a path and an id
 * of `1%3Fx%3Dy` as a query. Digits only, and neither can be spelled.
 */
const HN_ITEM_ID = /^\d+$/

const HTML_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i

/**
 * What the page calls itself, taken from the raw HTML before `htmlToText` throws the head
 * away. Most sources reach us named by their bare domain, which is what grounding hands over
 * and what makes an evidence list unreadable; a page we actually fetched can do better.
 */
function pageTitle(html: string): string | undefined {
  const match = HTML_TITLE.exec(html)
  if (!match) return undefined
  const title = capTitle(decodeEntities(match[1]))
  return title === '' ? undefined : title
}

/** The title of the post a thread hangs off, which is a sentence somebody wrote. */
function redditThreadTitle(json: unknown): string | undefined {
  if (!Array.isArray(json)) return undefined
  const children = asRecord(asRecord(json[0])?.data)?.children
  const post = Array.isArray(children) ? asRecord(asRecord(children[0])?.data) : null
  return typeof post?.title === 'string' ? post.title : undefined
}

/** What one read returned: the text to digest, and what the page says it is called. */
export interface ReadPage {
  text: string
  title?: string
}

const page = (text: string | null, title: string | undefined): ReadPage | null => {
  if (text === null) return null
  // A title of whitespace is no title: it would replace a bare domain with nothing at all.
  const named = capTitle(title ?? '')
  return { text, ...(named === '' ? {} : { title: named }) }
}

/**
 * One source, read the way its host is best read: a Reddit thread through its `.json` (the
 * HTML is a wall of chrome), an HN discussion through Algolia, and everything else through
 * the guarded fetcher with the markup stripped. Thin pages are `null` — there is nothing to
 * digest — and so is every failure. Each road also brings back the page's own title, which
 * the pipeline uses to replace a bare domain.
 */
export async function readSource(source: ResearchSource): Promise<ReadPage | null> {
  try {
    if (source.host === 'reddit.com' || source.host.endsWith('.reddit.com')) {
      // Only the path is carried over: it is appended to the OAuth host, and a query string
      // like `?context=3` would land in the middle of the address if kept. `null` here is
      // usually not a failed read but an unconfigured one — see `redditGet`.
      const path = new URL(source.url).pathname.replace(/\/$/, '')
      if (!REDDIT_THREAD_PATH.test(path)) return null
      const res = await redditGet(`https://oauth.reddit.com${path}?raw_json=1`)
      if (!res || res.status !== 200) return null
      return page(cap(flattenRedditThread(res.json)), redditThreadTitle(res.json))
    }
    if (source.host === 'news.ycombinator.com') {
      const id = new URL(source.url).searchParams.get('id')
      if (!id || !HN_ITEM_ID.test(id)) return null
      const { status, json } = await getJson(`https://hn.algolia.com/api/v1/items/${id}`)
      if (status !== 200) return null
      const title = asRecord(json)?.title
      return page(cap(flattenHnItem(json)), typeof title === 'string' ? title : undefined)
    }
    const { status, text } = await getGuardedText(new URL(source.url))
    return status === 200 ? page(cap(htmlToText(text)), pageTitle(text)) : null
  } catch {
    return null
  }
}

const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com'

/**
 * Grounding metadata names pages through a Google redirect, not by their own address. One
 * HEAD with redirects left unfollowed gives the real URL in `Location`; anything short of
 * that keeps the redirect, which still opens in a browser. This is the only fetch here that
 * bypasses the guarded fetcher, and it may: the host is Google's, fixed, and public.
 */
export async function resolveGroundingUrl(uri: string): Promise<string> {
  if (hostOf(uri) !== GROUNDING_REDIRECT_HOST) return uri
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(uri, { method: 'HEAD', redirect: 'manual', signal: controller.signal })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) return uri
    // `Location` is a header, not a URL: it may be relative, so it is resolved against the
    // redirect it came from. And it ends up in an href the reader can click, so a scheme that
    // is not a page — `javascript:`, `file:` — keeps the redirect instead.
    const resolved = new URL(location, uri)
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.toString() : uri
  } catch {
    // An abort lands here too, and the answer it wants is the same one: keep the redirect,
    // which still opens in a browser.
    return uri
  } finally {
    clearTimeout(timer)
  }
}
