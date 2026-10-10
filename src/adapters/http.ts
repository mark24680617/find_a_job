import { FetchBlockedError, PASTE_INSTEAD } from './types'

/**
 * The one place that talks to the network. Every adapter goes through it so the timeout,
 * the User-Agent and the "we could not reach it" wording are decided once.
 */

const TIMEOUT_MS = 10_000

// A page that redirects more than this is either a loop or a tracker chain, and every hop
// is another address to check.
const MAX_REDIRECTS = 3

// The most of a body that is read, counted after undici has decompressed it (caps spec §7.5):
// 4 MiB from any host, past which a page is one to paste instead, and 32 MiB from Ashby's
// job-board API. Ashby has no single-posting endpoint, so a posting is read out of its company's
// whole board, and OpenAI's board came to 14.3 MB decoded on 2026-10-08; the larger cap keeps
// every Ashby posting link working (decided 2026-10-08). It is chosen here, per hop, from the
// host the body is read from and nothing else, so no caller can raise it: a redirect away from
// Ashby is read under 4 MiB, and a host that only looks like Ashby's is any other host.
const MAX_BODY_BYTES = 4 * 1024 * 1024
const ASHBY_API_HOST = 'api.ashbyhq.com'
const MAX_ASHBY_BODY_BYTES = 32 * 1024 * 1024

/** The cap on a body read from `url`. */
const capFor = (url: string): number =>
  new URL(url).hostname === ASHBY_API_HOST ? MAX_ASHBY_BODY_BYTES : MAX_BODY_BYTES

// Some career sites serve a challenge page to unknown clients; a normal browser string is
// enough to get the public HTML the same visitor would see.
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface Fetched {
  status: number
  body: unknown
  location: string | null
  /** The `content-type` header, `''` when the server sent none. */
  contentType: string
}

/**
 * The body as text, counted as it arrives and given up past `cap` bytes. What is counted is
 * what the stream yields, after undici has decompressed it, so a small gzip that inflates to
 * gigabytes stops here too; `content-length` is never consulted, since a chunked body has none
 * and any body can misstate it. Past the cap the body is cancelled and the request aborted, and
 * the refusal names the cap. Decoded as `res.text()` decodes: UTF-8, a leading BOM dropped, a
 * bad byte replaced.
 */
async function readCapped(res: Response, controller: AbortController, cap: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    bytes += value.byteLength
    if (bytes > cap) {
      void reader.cancel().catch(() => {})
      controller.abort()
      throw new FetchBlockedError(`That page is over ${cap / 1024 / 1024} MB — ${PASTE_INSTEAD}`)
    }
    text += decoder.decode(value, { stream: true })
  }
}

async function send(
  url: string,
  accept: string,
  kind: 'json' | 'text',
  redirect: RequestRedirect,
): Promise<Fetched> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect,
      headers: { accept, 'user-agent': BROWSER_UA },
    })
    // The body is read inside the timed scope on purpose: the abort signal is the only
    // thing that can end a stalled download, and an Ashby board is megabytes of it.
    // `res.ok` is false for a 3xx too, so a manual redirect never reads a body. The cap is the
    // one for where the body comes from: `res.url`, which after a redirect `fetch` followed
    // (getJson) is the last hop's address, and with redirects followed by hand
    // (getGuardedText) is this hop's. A response a test builds has no `url`.
    const text = res.ok ? await readCapped(res, controller, capFor(res.url || url)) : null
    const body = text !== null && kind === 'json' ? JSON.parse(text) : text
    // What the body is, not only where it came from. A brief behind a link is a Google Docs
    // export, a raw file off GitHub or a page, and the three have to be read differently;
    // a PDF served at a link is refused on this header before anything tries to make text
    // of it. Every existing caller destructures the fields it wants, so this reaches them
    // as an unread extra.
    return {
      status: res.status,
      body,
      location: res.headers.get('location'),
      contentType: res.headers.get('content-type') ?? '',
    }
  } catch (err) {
    // A page over the cap says so. Timeout, DNS failure, a refused connection, a body that
    // stops mid-stream and JSON that does not parse are all the same story to the user.
    if (err instanceof FetchBlockedError) throw err
    throw new FetchBlockedError(`Could not reach ${new URL(url).hostname} — ${PASTE_INSTEAD}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `json` is only read on a 200; callers decide what a 404 means for them.
 *
 * Redirects are followed without checking each hop, which is safe only because no caller
 * lets a stranger choose the address. The ATS adapters (`ashby`, `lever`, `greenhouse`)
 * build theirs from a fixed `api.*` host and encode the slug and id they interpolate;
 * `lib/research/community` builds theirs from a fixed Reddit or Algolia host and matches the
 * one piece it takes from a search result — a thread path, an item id — against a literal
 * shape first. The address check below is defence in depth for that invariant rather than a
 * replacement for it: it sees only the first address, so anything reachable from a link a
 * user pasted still belongs in `getGuardedText`, which checks every hop.
 */
export async function getJson(url: string): Promise<{ status: number; json: unknown }> {
  assertReachableAddress(new URL(url))
  const { status, body } = await send(url, 'application/json', 'json', 'follow')
  return { status, json: body }
}

const unreachable = () =>
  new FetchBlockedError(`That address isn't reachable from here — ${PASTE_INSTEAD}`)

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function isBlockedIpv4(host: string): boolean {
  const m = IPV4.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return (
    a === 0 || // 0.0.0.0/8, "this host"
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) // link-local, which is where cloud metadata lives
  )
}

function isBlockedIpv6(host: string): boolean {
  const ip = host.toLowerCase()
  if (ip === '::1' || ip === '::') return true
  // An IPv4-mapped literal (::ffff:169.254.169.254) is never a job posting, and letting one
  // through would route around the v4 rules above.
  if (ip.startsWith('::ffff:')) return true
  const firstHextet = parseInt(ip.split(':')[0], 16)
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true // unique local, fc00::/7
  return firstHextet >= 0xfe80 && firstHextet <= 0xfebf // link-local, fe80::/10
}

/**
 * A posting URL is whatever the user typed, and we fetch it from a server that sits inside
 * a private network with a cloud metadata endpoint on it. So: public addresses and default
 * ports only. This is not proof against DNS rebinding — a hostname that resolves to a
 * private address still passes, deliberately, since pinning the resolved IP is out of scope
 * for the MVP.
 */
export function assertReachableAddress(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw unreachable()
  if (url.port !== '' && url.port !== '80' && url.port !== '443') throw unreachable()

  // A trailing dot is a legal, fully-qualified spelling of the same name — `localhost.`
  // resolves to ::1 — and it would otherwise walk past both the name below and the dotless
  // rule. The IPv4 rules need no equivalent: the URL parser already drops the dot from a
  // dotted quad. Only the dot that starts a run is tried as the start of the trailing run: the
  // parser takes a host of any number of dots, and tried from every dot in a run that does
  // not end the host, `\.+$` read the rest of the run again each time (20,000 dots, 1 s).
  const host = url.hostname.toLowerCase().replace(/(?<!\.)\.+$/, '')
  if (host === 'metadata.google.internal') throw unreachable()
  // A URL parsed from an IPv6 literal keeps its brackets in `hostname`.
  if (host.startsWith('[') && host.endsWith(']')) {
    if (isBlockedIpv6(host.slice(1, -1))) throw unreachable()
    return
  }
  // No dot means a name only this network can resolve: localhost, or a service name.
  if (!host.includes('.')) throw unreachable()
  if (isBlockedIpv4(host)) throw unreachable()
}

/**
 * Redirects are followed by hand so that every hop is checked, not just the URL the user
 * pasted — otherwise a public host could bounce the request straight at an internal one.
 *
 * `contentType` is the header of the hop that finally answered, `''` when it sent none. The
 * caller decides from it whether the body is text to keep as it is, a page to strip, or a
 * file to refuse; this layer only reports what it was told.
 */
export async function getGuardedText(
  url: URL,
): Promise<{ status: number; text: string; contentType: string }> {
  let target = url
  for (let hop = 0; ; hop++) {
    assertReachableAddress(target)
    const { status, body, location, contentType } = await send(
      target.href,
      'text/html',
      'text',
      'manual',
    )
    if (status < 300 || status >= 400 || !location) {
      return { status, text: (body as string) ?? '', contentType }
    }
    if (hop === MAX_REDIRECTS) {
      throw new FetchBlockedError(`That link keeps redirecting — ${PASTE_INSTEAD}`)
    }
    try {
      target = new URL(location, target)
    } catch {
      throw unreachable()
    }
  }
}
