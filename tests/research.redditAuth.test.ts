import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The one thing this module decides: whether there is a way into Reddit at all, and how often
// we pay for it. The module holds its token in memory, so each test imports a fresh copy.

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const load = async () => {
  vi.resetModules()
  return import('@/lib/research/redditAuth')
}

const tokenBody = (token: string, expiresIn = 3600) => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: token, token_type: 'bearer', expires_in: expiresIn }),
})

beforeEach(() => {
  vi.resetAllMocks()
  process.env.REDDIT_CLIENT_ID = 'app-id'
  delete process.env.REDDIT_CLIENT_SECRET
})

afterEach(() => {
  delete process.env.REDDIT_CLIENT_ID
  delete process.env.REDDIT_CLIENT_SECRET
})

describe('redditToken', () => {
  it('asks for an installed-client token with the app id as the whole credential', async () => {
    fetchMock.mockResolvedValue(tokenBody('tok-1'))
    const { redditToken, REDDIT_UA } = await load()
    await expect(redditToken()).resolves.toBe('tok-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.reddit.com/api/v1/access_token')
    expect(init.method).toBe('POST')
    // An installed app has no secret, so the Basic credential is the id and an empty password.
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('app-id:').toString('base64')}`)
    expect(init.headers['user-agent']).toBe(REDDIT_UA)
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('https://oauth.reddit.com/grants/installed_client')
    expect(body.get('device_id')).toBe('DO_NOT_TRACK_THIS_DEVICE')
  })
  it('sends the secret when the operator registered a confidential app', async () => {
    process.env.REDDIT_CLIENT_SECRET = 's3cret'
    fetchMock.mockResolvedValue(tokenBody('tok-1'))
    const { redditToken } = await load()
    await redditToken()
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe(
      `Basic ${Buffer.from('app-id:s3cret').toString('base64')}`,
    )
  })
  it('asks once and reuses the token until it is nearly expired', async () => {
    fetchMock.mockResolvedValue(tokenBody('tok-1'))
    const { redditToken } = await load()
    await expect(redditToken()).resolves.toBe('tok-1')
    await expect(redditToken()).resolves.toBe('tok-1')
    await expect(redditToken()).resolves.toBe('tok-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('asks again once the cached token is inside its last minute', async () => {
    // A token that expires in 30s is already past the renewal threshold, so it is used now
    // and asked for again next time rather than carried into a request it cannot finish.
    fetchMock.mockResolvedValue(tokenBody('tok-1', 30))
    const { redditToken } = await load()
    await redditToken()
    await redditToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('reads no Reddit, and asks for nothing, when no app id is configured', async () => {
    delete process.env.REDDIT_CLIENT_ID
    const { redditToken } = await load()
    await expect(redditToken()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('is null on a refusal, a body with no token, or a network failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const a = await load()
    await expect(a.redditToken()).resolves.toBeNull()

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: 'nope' }) })
    const b = await load()
    await expect(b.redditToken()).resolves.toBeNull()

    fetchMock.mockRejectedValue(new Error('down'))
    const c = await load()
    await expect(c.redditToken()).resolves.toBeNull()
  })
})
