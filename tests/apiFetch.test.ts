import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type FakeUser = { getIdToken: () => Promise<string> }

// Models Firebase's real startup: `currentUser` is null until the persisted session
// has been restored, and only `authStateReady()` tells you restoration has finished.
const { state } = vi.hoisted(() => ({
  state: { currentUser: null as FakeUser | null, restoredUser: null as FakeUser | null },
}))

vi.mock('@/lib/firebase/client', () => ({
  auth: {
    get currentUser() {
      return state.currentUser
    },
    authStateReady: async () => {
      state.currentUser = state.restoredUser
    },
  },
}))

import { ApiError, apiDownload, apiFetch } from '@/lib/apiFetch'

const signedIn: FakeUser = { getIdToken: async () => 'id-token-123' }
const fetchMock = vi.fn()

beforeEach(() => {
  state.currentUser = null
  state.restoredUser = null
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiFetch', () => {
  it('waits for session restore before reading currentUser', async () => {
    // currentUser is null right now — only authStateReady() reveals the signed-in user.
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    await expect(apiFetch('/api/profile')).resolves.toEqual({ ok: true })

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/profile')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer id-token-123')
  })

  it('preserves caller headers and init while adding the token', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await apiFetch('/api/profile', {
      method: 'PUT',
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json' },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(init.body).toBe('{"a":1}')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer id-token-123')
  })

  it('throws without hitting the network when nobody is signed in', async () => {
    await expect(apiFetch('/api/profile')).rejects.toThrow('Not signed in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("throws the server's error text on a non-2xx response", async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('{"error":"invalid token"}', { status: 401 }))

    await expect(apiFetch('/api/profile')).rejects.toThrow('invalid token')
  })

  it('falls back to status text when the error body is empty', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' }))

    await expect(apiFetch('/api/profile')).rejects.toThrow('500 Internal Server Error')
  })

  // What the wizard branches on: a create that comes back 422 needPaste is a deliberate
  // refusal to be recovered from, not a failure to report. Matching the message string
  // would make that a coincidence of wording rather than a contract.
  it('carries the status and the parsed body on the thrown ApiError', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(
      new Response('{"error":"LinkedIn blocks fetching","needPaste":true}', { status: 422 }),
    )

    const err = await apiFetch('/api/applications', { method: 'POST' }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toBeInstanceOf(Error)
    const api = err as ApiError
    expect(api.status).toBe(422)
    expect(api.body).toEqual({ error: 'LinkedIn blocks fetching', needPaste: true })
    expect(api.message).toBe('LinkedIn blocks fetching')
  })

  it('keeps a non-JSON error body as its raw text', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('<html>gateway timeout</html>', { status: 504 }))

    const err = (await apiFetch('/api/profile').catch((e: unknown) => e)) as ApiError

    expect(err.status).toBe(504)
    expect(err.body).toBe('<html>gateway timeout</html>')
  })

  it('resolves to undefined for an empty success body', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(apiFetch('/api/profile', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})

/**
 * The download path. No jsdom in this repo, so the browser it needs is three stubs: the blob
 * URL registry, `document.createElement`, and the body it attaches to. What is under test is
 * the sequence a download actually depends on — signed request, blob, named anchor, attached,
 * clicked, detached, URL released — every step of which fails silently in a real browser.
 */
describe('apiDownload', () => {
  interface FakeAnchor {
    href: string
    download: string
    click: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }

  let anchors: FakeAnchor[]
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let appendChild: ReturnType<typeof vi.fn>

  const anchor = () => anchors[0]

  beforeEach(() => {
    anchors = []
    createObjectURL = vi.fn(() => 'blob:fake-url')
    revokeObjectURL = vi.fn()
    appendChild = vi.fn()

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const el: FakeAnchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
        anchors.push(el)
        return el
      }),
      body: { appendChild },
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches the file with the caller\'s token and saves it under the given name', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(
      new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
        status: 200,
        headers: { 'content-type': 'text/calendar' },
      }),
    )

    await apiDownload('/api/applications/a1/interviews/r1/ics', 'interview.ics')

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/applications/a1/interviews/r1/ics')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer id-token-123')

    // The body the server sent is what reaches the blob, not a re-encoded copy.
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(await blob.text()).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')

    expect(anchor().href).toBe('blob:fake-url')
    expect(anchor().download).toBe('interview.ics')
    expect(anchor().click).toHaveBeenCalled()
  })

  it('attaches the anchor before clicking it and detaches it after', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('x', { status: 200 }))

    await apiDownload('/api/x/ics', 'interview.ics')

    expect(appendChild).toHaveBeenCalledWith(anchor())
    expect(appendChild.mock.invocationCallOrder[0]).toBeLessThan(
      anchor().click.mock.invocationCallOrder[0],
    )
    expect(anchor().remove).toHaveBeenCalled()
    expect(anchor().remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      anchor().click.mock.invocationCallOrder[0],
    )
  })

  it('releases the blob URL after the browser has had the file, not in the same tick', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(new Response('x', { status: 200 }))

    await apiDownload('/api/x/ics', 'interview.ics')
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('throws the ApiError and saves nothing when the server refuses', async () => {
    state.restoredUser = signedIn
    fetchMock.mockResolvedValue(
      new Response('{"error":"this round has no scheduled time yet"}', { status: 400 }),
    )

    const err = (await apiDownload('/api/x/ics', 'interview.ics').catch(
      (e: unknown) => e,
    )) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.message).toBe('this round has no scheduled time yet')
    expect(anchors).toHaveLength(0)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('never reaches the network when nobody is signed in', async () => {
    await expect(apiDownload('/api/x/ics', 'interview.ics')).rejects.toThrow('Not signed in')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(anchors).toHaveLength(0)
  })
})
