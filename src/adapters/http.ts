import { FetchBlockedError, PASTE_INSTEAD } from './types'

/**
 * The one place that talks to the network. Every adapter goes through it so the timeout,
 * the User-Agent and the "we could not reach it" wording are decided once.
 */

const TIMEOUT_MS = 10_000

// A page that redirects more than this is either a loop or a tracker chain, and every hop
// is another address to check.
const MAX_REDIRECTS = 3

// Some career sites serve a challenge page to unknown clients; a normal browser string is
// enough to get the public HTML the same visitor would see.
export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface Fetched {
  status: number
  body: unknown
  location: string | null
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
    // `res.ok` is false for a 3xx too, so a manual redirect never reads a body.
    const body = res.ok ? (kind === 'json' ? await res.json() : await res.text()) : null
    return { status: res.status, body, location: res.headers.get('location') }
  } catch {
    // Timeout, DNS failure, a refused connection and a body that stops mid-stream are all
    // the same story to the user.
    throw new FetchBlockedError(`Could not reach ${new URL(url).hostname} — ${PASTE_INSTEAD}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `json` is only read on a 200; callers decide what a 404 means for them. Follows redirects
 * unguarded — safe only because all three callers point at fixed api.* ATS hosts, never a
 * user-supplied URL. Anything reachable from a pasted link must go through `getGuardedText`.
 */
export async function getJson(url: string): Promise<{ status: number; json: unknown }> {
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
  // dotted quad.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
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
 */
export async function getGuardedText(url: URL): Promise<{ status: number; text: string }> {
  let target = url
  for (let hop = 0; ; hop++) {
    assertReachableAddress(target)
    const { status, body, location } = await send(target.href, 'text/html', 'text', 'manual')
    if (status < 300 || status >= 400 || !location) return { status, text: (body as string) ?? '' }
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
