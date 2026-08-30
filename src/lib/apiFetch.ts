import { auth } from '@/lib/firebase/client'

/**
 * A non-2xx answer from our own API, carrying what the server actually said.
 *
 * `message` is the sentence to show a person; `status` and `body` are what a caller
 * branches on. The wizard has to tell one deliberate refusal — the 422 that means "we could
 * not fetch that posting, paste it instead" — apart from every other failure, and matching
 * on a message string is not a contract. It is still an `Error`, so callers that only read
 * `.message` keep working.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The error body as data: parsed JSON when it parses, the raw text when it doesn't. */
function errorBody(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** Route handlers answer errors as `{ error: string }`; fall back to the raw body. */
function errorText(raw: string, parsed: unknown, res: Response): string {
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    const { error } = parsed as { error: unknown }
    if (typeof error === 'string') return error
  }
  return raw || `${res.status} ${res.statusText}`
}

/**
 * The signed request itself: the caller's Firebase ID token attached, a non-2xx turned into
 * an `ApiError`. Callers get a `Response` whose body is untouched and theirs to read.
 */
async function send(path: string, init?: RequestInit): Promise<Response> {
  // `currentUser` is null until Firebase restores the persisted session from IndexedDB,
  // so reading it synchronously would throw for a user who is genuinely signed in.
  await auth.authStateReady()
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')

  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`)

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const body = await res.text()
    const parsed = errorBody(body)
    throw new ApiError(errorText(body, parsed, res), res.status, parsed)
  }
  return res
}

/**
 * Client-side fetch for our own API. Attaches the caller's Firebase ID token and
 * throws on a non-2xx response so callers only handle the success path.
 */
export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const body = await (await send(path, init)).text()
  return (body ? JSON.parse(body) : undefined) as T
}

/**
 * Save a file our API answers with, under the given name.
 *
 * A plain download link cannot do this: the API authenticates by `Authorization` header and
 * a link cannot set one, so the file has to be fetched with the token and handed to the
 * browser afterwards. Failures arrive as the same `ApiError` every other call throws.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(await (await send(path)).blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // In the document, not merely constructed: Firefox has historically ignored `.click()` on
  // an anchor that was never attached.
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking in the same tick as the click cancels the download in some browsers; the URL
  // is released a moment later instead, once the browser has taken the file.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
