/**
 * The token that lets a server read Reddit at all.
 *
 * Reddit's public JSON — `www.reddit.com/search.json`, `…/comments/….json` — answers a
 * server with 403 and a challenge page, and `old.reddit.com` redirects to a login, so the
 * write-ups people actually post about interviewing are unreachable without OAuth. The way
 * in that costs nothing is the "installed client" grant: a free app id, no user, no secret,
 * and a token good for an hour. The operator opts in by putting the id in the environment;
 * without one we read no Reddit rather than spending requests that can only come back 403.
 *
 * The token is kept in module memory because it outlives a request and costs a round trip to
 * replace: a warm instance asks once and reuses it until it is nearly expired.
 */

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'

const TIMEOUT_MS = 10_000

/** Renewed a minute early, because a token that expires mid-request is a lost read. */
const RENEW_BEFORE_MS = 60_000

/** Reddit asks that a client name itself; a generic or absent User-Agent is rate-limited hard. */
export const REDDIT_UA = 'find-a-job-research/0.1 (+https://github.com/mark24680617/find_a_job)'

let cached: { token: string; expiresAt: number } | null = null

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null

/**
 * A bearer token, or `null` when this deployment has no Reddit access — no app id
 * configured, or Reddit would not issue one. Every caller treats `null` the same way: skip
 * Reddit, keep the rest of the research.
 */
export async function redditToken(): Promise<string | null> {
  const clientId = process.env.REDDIT_CLIENT_ID
  if (!clientId) return null
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // The grant is anonymous: an app registered as "installed" has no secret, and the device
    // id is Reddit's own literal for a client that does not want to be tracked across runs.
    const basic = Buffer.from(`${clientId}:${process.env.REDDIT_CLIENT_SECRET ?? ''}`).toString('base64')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': REDDIT_UA,
      },
      body: new URLSearchParams({
        grant_type: 'https://oauth.reddit.com/grants/installed_client',
        device_id: 'DO_NOT_TRACK_THIS_DEVICE',
      }).toString(),
    })
    if (!res.ok) return null
    const body = asRecord(await res.json())
    const token = body?.access_token
    if (typeof token !== 'string' || token === '') return null
    // A body without `expires_in` is cached as already stale: the token is used for this run
    // and asked for again next time, rather than guessed at a lifetime Reddit never stated.
    const lifetime = typeof body?.expires_in === 'number' ? body.expires_in * 1000 : 0
    cached = { token, expiresAt: Date.now() + Math.max(0, lifetime - RENEW_BEFORE_MS) }
    return token
  } catch {
    // A refusal, a timeout, or a body that is not a token: this run reads no Reddit, which
    // is the same outcome as not being configured for it.
    return null
  } finally {
    clearTimeout(timer)
  }
}
