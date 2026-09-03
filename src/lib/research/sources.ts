import type { ResearchSource } from '@/lib/types'

/**
 * Where a source came from, and which of them are worth reading. Everything here is a plain
 * function over URLs and titles, so the route's judgment about the web is testable without
 * the web.
 */

/** Hosts that answer a server with a challenge page. Kept as links, never fetched. */
export const NO_FETCH_HOSTS: readonly string[] = [
  'glassdoor.com', 'glassdoor.co.uk', 'glassdoor.de', 'glassdoor.ca', 'glassdoor.com.au',
  'glassdoor.co.in', 'glassdoor.ie', 'glassdoor.sg',
  'teamblind.com', 'linkedin.com', 'levels.fyi', 'indeed.com',
]

/** Hosts whose content is people talking to each other, not a company talking about itself. */
const COMMUNITY_HOSTS: readonly string[] = [
  'reddit.com', 'teamblind.com', 'levels.fyi', 'news.ycombinator.com',
  // Glassdoor's country sites are the same site under another domain, so they carry the same
  // kind as the .com. The list is spelled out rather than pattern-matched: `glassdoor.*` would
  // hand the classification to whoever registers the next Glassdoor-looking domain.
  'glassdoor.com', 'glassdoor.co.uk', 'glassdoor.de', 'glassdoor.ca', 'glassdoor.com.au',
  'glassdoor.co.in', 'glassdoor.ie', 'glassdoor.sg',
]

const TRACKING = /^(utm_|fbclid|gclid|mc_)/

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * A guess at the company's own host from its name — "Marram Systems" → "marramsystems.com"
 * — used only to label a source as the company's rather than a third party's. A wrong guess
 * mislabels nothing that matters: the source is still shown and still cited.
 */
export function guessCompanyHost(company: string): string | undefined {
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '')
  return slug ? `${slug}.com` : undefined
}

/** True when `host` is `base` or a subdomain of it. */
export const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`)

/** One page, one string: no tracking params, no fragment, no www, no trailing slash. */
export function normalizeUrl(url: string): string {
  const u = new URL(url)
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key)
  u.hash = ''
  // The slash comes off the path rather than off the serialised string: a query hides it from
  // the end of the string, and `/post/?id=3` and `/post?id=3` are the same page. A bare origin
  // keeps its slash, because `/` is all the path it has.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
  return u.toString()
}

export interface KindContext {
  postingHost?: string
  companyHost?: string
}

export function sourceKind(url: string, ctx: KindContext): ResearchSource['kind'] {
  const host = hostOf(url)
  if (ctx.postingHost && under(host, ctx.postingHost.toLowerCase().replace(/^www\./, ''))) return 'posting'
  if (ctx.companyHost && under(host, ctx.companyHost.toLowerCase().replace(/^www\./, ''))) return 'company'
  if (COMMUNITY_HOSTS.some((c) => under(host, c))) return 'community'
  return 'guide'
}

export interface SourceCandidate {
  url: string
  title: string
  snippet: string
  publishedAt?: string
}

const SNIPPET_CAP = 600

/**
 * How long a title may be, and the one place it is cut. Every road a title arrives by ends in
 * a stored record and a line somebody reads — or hears read whole, since a screen reader does
 * not truncate the way `truncate` does — so a page whose `<title>` runs to a paragraph, or a
 * CMS slug of two hundred characters, is cut at the same length wherever it came from.
 */
const TITLE_CAP = 160
export const capTitle = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, TITLE_CAP)

/**
 * Candidates from five searches and two APIs overlap heavily. They are folded on the
 * normalised URL: the first title wins (the search that found it first usually named it
 * best), the snippets are joined so the synthesis sees every support, and the ids are ours —
 * `s1`, `s2`, … — so a model can only ever point at a source we handed it.
 */
export function mergeSources(cands: SourceCandidate[], ctx: KindContext): ResearchSource[] {
  const byKey = new Map<string, ResearchSource>()
  for (const cand of cands) {
    let key: string
    try {
      // This is the trust boundary for everything downstream: what survives here is fetched and
      // rendered as a link. `new URL` parses `file:`, `data:` and `javascript:` as happily as it
      // parses a web page, and each would come through with an empty host, be filed as a guide,
      // and pass `isFetchable`. Only the web's own two schemes get past.
      const { protocol } = new URL(cand.url)
      if (protocol !== 'http:' && protocol !== 'https:') continue
      key = normalizeUrl(cand.url)
    } catch {
      continue
    }
    const existing = byKey.get(key)
    if (existing) {
      const parts = [existing.snippet, cand.snippet].filter((s) => s.trim() !== '')
      existing.snippet = parts.join(' … ').slice(0, SNIPPET_CAP)
      if (!existing.publishedAt && cand.publishedAt) existing.publishedAt = cand.publishedAt
      continue
    }
    byKey.set(key, {
      id: `s${byKey.size + 1}`,
      // A candidate with no title of its own falls back to the host rather than to its whole
      // address: a URL is not a name, and the host at least says who is talking. `titledByHost`
      // then reads it as the absence it is, so the path can name it later if it has one.
      title: capTitle(cand.title) || hostOf(key),
      url: key,
      host: hostOf(key),
      kind: sourceKind(key, ctx),
      snippet: cand.snippet.trim().slice(0, SNIPPET_CAP),
      ...(cand.publishedAt ? { publishedAt: cand.publishedAt } : {}),
      fetched: false,
    })
  }
  return [...byKey.values()]
}

export function isFetchable(source: ResearchSource): boolean {
  return !NO_FETCH_HOSTS.some((h) => under(source.host, h))
}

/**
 * True when a source carries no title of its own: nothing, its own address, or a bare domain
 * it sits under. The last case is the common one and it has to be spelled that way rather
 * than as an equality — grounding named one page `medium.com` when it lives on
 * `arpita0412.medium.com`, and three different postings `ashbyhq.com` when each lives on
 * `jobs.ashbyhq.com`. Three identical strings in an evidence list cannot be checked by a
 * reader or told apart by a screen reader, which is the same as having no title at all.
 */
export function titledByHost(source: ResearchSource): boolean {
  const title = source.title.trim()
  if (title === '' || title === source.url) return true
  const domain = title.toLowerCase().replace(/^www\./, '')
  return !/\s/.test(domain) && domain.includes('.') && under(source.host, domain)
}

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000

/** What a company calls the page where it describes its own hiring loop. */
const COMPANY_PROCESS_PAGE = /interview|hiring|how we hire|process|candidate/i

/**
 * The lead a company's own process page gets, chosen to be more than every other signal
 * below can add up to (3 + 2 + 2 + 3 + 1 + 1). A few points would not do it: a job board's
 * repost, titled "<Company> interview", scores 7 on those signals alone, which is how a
 * company's own "interviewing at" page came to sit unread beneath two aggregators. It is the
 * one account nobody is paraphrasing, and it is always about the right company.
 */
const COMPANY_PAGE_LEAD = 13

/**
 * Prep sites that generate a page per company: they read as write-ups, they rank like
 * write-ups, and what they say about a loop nobody has written about is invented. In the
 * Vercel run four of them were read for a design role and returned engineering specifics.
 *
 * A host list is a stopgap and will always be one — the next such site is not on it. The
 * durable signal is `firstHand`, which the digest reports about the text itself; this only
 * has to hold the line until enough runs have gone through that signal to lean on it.
 */
const AGGREGATOR_HOSTS: readonly string[] = [
  'designgurus.io', 'techprep.app', 'finalroundai.com', 'interviewquery.com',
  'interviewkickstart.com', 'leetcode.com', 'spacecomplexity.ai', 'interviewcoder.co',
  'tryexponent.com', 'prepfully.com', 'coditioning.com',
]
const AGGREGATOR_PENALTY = 3

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

/**
 * Which write-ups to read first. The company's own page about how it interviews leads, when
 * it has one: it is the only account nobody is paraphrasing. Then community accounts and
 * guides over the posting; anything that says "interview" in its title; anything that names
 * the company; a Reddit thread with the company in its title — that is the write-up a friend
 * would have sent. Recency is one point, not a gate: an old thread about the right company
 * still beats a new one about nothing in particular. The known prep aggregators are docked,
 * for the reason given above their list.
 */
export function rankGuides(sources: ResearchSource[], company: string, researchedAt: string): ResearchSource[] {
  const c = company.toLowerCase()
  const now = Date.parse(researchedAt)
  const score = (s: ResearchSource) => {
    let n = 0
    // The title is often just the bare domain — that is how grounding names a page — so the
    // path carries the signal instead: `/interviewing`, `/how-we-hire`, `/careers/process`.
    if (s.kind === 'company' && COMPANY_PROCESS_PAGE.test(`${s.title} ${pathOf(s.url)}`)) n += COMPANY_PAGE_LEAD
    // A company page that is not its process page still speaks for itself, so it is worth as
    // much as a guide: an engineering blog post about how the team hires outranks a bare
    // domain that only happens to carry the company's name.
    if (s.kind === 'community' || s.kind === 'guide' || s.kind === 'company') n += 3
    if (/interview/i.test(s.title)) n += 2
    if (s.title.toLowerCase().includes(c) || s.snippet.toLowerCase().includes(c)) n += 2
    if (under(s.host, 'reddit.com') && s.title.toLowerCase().includes(c)) n += 3
    const at = Date.parse(s.publishedAt ?? '')
    if (!Number.isNaN(at) && now - at < TWO_YEARS_MS) n += 1
    // A snippet of any substance is a page that was already observed to say something.
    if (s.snippet.length >= 200) n += 1
    if (AGGREGATOR_HOSTS.some((h) => under(s.host, h))) n -= AGGREGATOR_PENALTY
    return n
  }
  return [...sources].sort((a, b) => score(b) - score(a))
}
