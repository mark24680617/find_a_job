import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchPosting } from '@/adapters'
import { getGuardedText } from '@/adapters/http'
import { FetchBlockedError } from '@/adapters/types'
import { readPage } from '@/lib/profileSource'
import { readBrief } from '@/lib/readBrief'

// Every outbound fetch is read through one reader, and it stops at 4 MiB of decoded body (caps
// spec §7.5): what undici yields after decompressing, counted as it arrives, never the length a
// server declares. A local server plays the far end, so undici does what it does in production —
// decompresses, frames a chunked body, drops a connection it aborts — and a stub of `fetch` sends
// each request for a public-looking address to it, so the address guard sees what it would.

const MiB = 1024 * 1024
const CAP = 4 * MiB
const OVER = 'That page is over 4 MB — paste the job description text instead'
const JOB_ID = 'deae2da1-6f6a-40ed-b64e-6596775a5473'

let server: Server
let origin = ''
/** Settles when the client went away from the endless response: an abort, seen from this end. */
let endlessClosed: Promise<void> = Promise.resolve()

const realFetch = globalThis.fetch
/**
 * A request for any `https://<host>/<path>` goes to the local server's `/<path>`, and its
 * response reports the address that was asked for as `res.url`, as it would without the detour.
 */
const viaLocalServer = () =>
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const res = await realFetch(origin + new URL(String(input)).pathname, init)
    Object.defineProperty(res, 'url', { value: String(input) })
    return res
  })

/** A response as undici hands one over: `res.url` is where the body came from, after any redirect. */
function answering(url: string, body: BodyInit | null, init: ResponseInit = { status: 200 }) {
  const res = new Response(body, init)
  Object.defineProperty(res, 'url', { value: url })
  return res
}

/** An Ashby board holding the one posting, its description `filler` bytes long. */
const board = (filler: number) =>
  Buffer.concat([
    Buffer.from(`{"jobs":[{"id":"${JOB_ID}","title":"Engineer","location":"Remote","descriptionHtml":"<p>`),
    Buffer.alloc(filler, 'a'),
    Buffer.from('</p>"}]}'),
  ])

const drained = (res: ServerResponse) =>
  new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done)
      res.off('close', done)
      resolve()
    }
    res.on('drain', done)
    res.on('close', done)
  })

/** `total` bytes of "a" in 64 KiB writes, no `content-length` (so chunked), ended or held open. */
async function stream(res: ServerResponse, total: number, end: boolean) {
  res.writeHead(200, { 'content-type': 'text/html' })
  const chunk = Buffer.alloc(64 * 1024, 'a')
  for (let sent = 0; sent < total && !res.destroyed; sent += chunk.length) {
    if (!res.write(total - sent < chunk.length ? chunk.subarray(0, total - sent) : chunk)) await drained(res)
  }
  if (end) res.end()
}

function send(res: ServerResponse, body: Buffer | string, headers: Record<string, string> = {}) {
  const bytes = Buffer.from(body)
  res.writeHead(200, { 'content-length': String(bytes.length), ...headers })
  res.end(bytes)
}

/** The bytes the UTF-8 test sends: a BOM, characters of two to four bytes, and one invalid byte. */
const UTF8 = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('Rôle — 数据工程师 🧪 '.repeat(2000)),
  Buffer.from([0xff]),
  Buffer.from(' end'),
])

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (path === '/page-over') return void stream(res, CAP + 1024, true)
    if (path === '/page-5mib') return void stream(res, 5 * MiB, true)
    if (path === '/posting-api/job-board/twenty') return send(res, board(20 * MiB), { 'content-type': 'application/json' })
    if (path === '/posting-api/job-board/over32') return send(res, board(33 * MiB), { 'content-type': 'application/json' })
    if (path === '/v1/boards/acme/jobs/1') return send(res, board(5 * MiB), { 'content-type': 'application/json' })
    if (path === '/page-at-cap') return void stream(res, CAP, true)
    if (path === '/page-endless') {
      endlessClosed = new Promise((resolve) => res.on('close', () => resolve()))
      // 32 MiB and then held open: today's reader would sit on it until the 10 s timeout.
      return void stream(res, 32 * MiB, false)
    }
    if (path === '/gzip-over') return send(res, gzipSync(Buffer.alloc(16 * MiB, ' ')), { 'content-encoding': 'gzip' })
    if (path === '/gzip-at-cap') return send(res, gzipSync(Buffer.alloc(CAP, 'a')), { 'content-encoding': 'gzip' })
    if (path === '/utf8') {
      // Odd-sized writes, so characters fall across the chunks the reader sees.
      res.writeHead(200, { 'content-type': 'text/plain' })
      for (let at = 0, k = 1; at < UTF8.length; at += k, k = (k % 7) + 1) res.write(UTF8.subarray(at, at + k))
      return void res.end()
    }
    if (path === '/posting-api/job-board/small') {
      return send(res, JSON.stringify({ jobs: [{ id: JOB_ID, title: 'Engineer', location: 'Remote', descriptionHtml: '<p>Build the ledger.</p>' }] }))
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** What a read came to: the refusal's sentence, or that it read the body after all. */
const outcome = (read: Promise<unknown>) =>
  read.then(
    () => 'read it all',
    (err: unknown) => (err instanceof FetchBlockedError ? err.reason : `${err}`),
  )

/** A body of `n` bytes of "a" in 64 KiB chunks, made as it is read. */
function body(n: number): ReadableStream<Uint8Array> {
  let left = n
  return new ReadableStream({
    pull(controller) {
      if (left <= 0) return controller.close()
      const k = Math.min(left, 64 * 1024)
      left -= k
      controller.enqueue(new Uint8Array(k).fill(97))
    },
  })
}

describe('the fetch reader — a body past 4 MiB, decoded, is refused', () => {
  it('a body with no content-length, sent chunked', async () => {
    viaLocalServer()
    expect(await outcome(getGuardedText(new URL('https://pages.example.com/page-over')))).toBe(OVER)
  })

  it('a content-length that lies low is not believed', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(body(CAP + MiB), { status: 200, headers: { 'content-length': '1024' } }))
    expect(await outcome(getGuardedText(new URL('https://pages.example.com/lying')))).toBe(OVER)
  })

  it('a stream that never ends stops at 4 MiB, long before the timeout, and the request is aborted', async () => {
    viaLocalServer()
    const started = performance.now()
    expect(await outcome(getGuardedText(new URL('https://pages.example.com/page-endless')))).toBe(OVER)
    expect(performance.now() - started).toBeLessThan(5_000)
    // The server sees the connection go once the reader gives up, not 32 MiB or 10 s later.
    await expect(Promise.race([endlessClosed.then(() => 'closed'), new Promise((r) => setTimeout(r, 2_000, 'still open'))])).resolves.toBe('closed')
  }, 20_000)

  it('a gzip page that inflates past 4 MiB, whatever its content-length says', async () => {
    viaLocalServer()
    expect(await outcome(getGuardedText(new URL('https://pages.example.com/gzip-over')))).toBe(OVER)
  })

  it('a posting past 4 MiB from a job-board API that is not Ashby’s, read through getJson', async () => {
    viaLocalServer()
    expect(await outcome(fetchPosting('https://boards.greenhouse.io/acme/jobs/1'))).toBe(OVER)
  })

  it('each surface that fetches an address a person chose says so in its own words', async () => {
    viaLocalServer()
    expect(await outcome(fetchPosting('https://pages.example.com/page-over'))).toBe(OVER)
    expect(await outcome(readPage('https://pages.example.com/page-over'))).toBe(
      'That page is over 4 MB — paste the page’s text into Pasted notes instead',
    )
    expect(await outcome(readBrief('https://pages.example.com/page-over'))).toBe(
      'That page is over 4 MB — paste the brief’s text instead',
    )
  })
})

describe('the fetch reader — 32 MiB from Ashby’s job-board API, 4 MiB from every other host and hop', () => {
  // Ashby has no single-posting endpoint, so a posting is read out of its company's whole board:
  // OpenAI's came to 14.3 MB decoded on 2026-10-08. The cap goes with the host the body is read
  // from, exactly api.ashbyhq.com, and no caller chooses it.
  const OVER_32 = 'That page is over 32 MB — paste the job description text instead'

  it('an Ashby board of 20 MiB reads, through getJson', async () => {
    viaLocalServer()
    await expect(fetchPosting(`https://jobs.ashbyhq.com/twenty/${JOB_ID}`)).resolves.toMatchObject({
      adapter: 'ashby',
      role: 'Engineer',
    })
  })

  it('an Ashby board past 32 MiB is refused, and the sentence names 32 MB', async () => {
    viaLocalServer()
    expect(await outcome(fetchPosting(`https://jobs.ashbyhq.com/over32/${JOB_ID}`))).toBe(OVER_32)
  })

  it('any other host is held to 4 MiB: 5 MiB from a page, and from another job-board API', async () => {
    viaLocalServer()
    expect(await outcome(getGuardedText(new URL('https://pages.example.com/page-5mib')))).toBe(OVER)
    expect(await outcome(fetchPosting('https://boards.greenhouse.io/acme/jobs/1'))).toBe(OVER)
  })

  it('a lookalike of the Ashby host is any other host', async () => {
    viaLocalServer()
    for (const host of ['api.ashbyhq.com.evil.example', 'xapi.ashbyhq.com', 'api-ashbyhq.com', 'ashbyhq.com']) {
      expect(await outcome(getGuardedText(new URL(`https://${host}/page-5mib`))), host).toBe(OVER)
    }
  })

  it('a redirect away from the Ashby host reads the next hop under 4 MiB, followed by hand', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      return url.startsWith('https://api.ashbyhq.com/')
        ? answering(url, null, { status: 302, headers: { location: 'https://cdn.example.net/board' } })
        : answering(url, body(5 * MiB))
    })
    expect(await outcome(getGuardedText(new URL('https://api.ashbyhq.com/posting-api/job-board/acme')))).toBe(OVER)
    expect(calls).toEqual(['https://api.ashbyhq.com/posting-api/job-board/acme', 'https://cdn.example.net/board'])
  })

  it('a redirect away from the Ashby host reads the next hop under 4 MiB, followed by fetch', async () => {
    // getJson lets `fetch` follow redirects, and `res.url` is then where the body came from.
    const fiveMiBBoard = () => board(5 * MiB)
    vi.stubGlobal('fetch', async () => answering('https://cdn.example.net/board', fiveMiBBoard()))
    expect(await outcome(fetchPosting(`https://jobs.ashbyhq.com/acme/${JOB_ID}`))).toBe(OVER)
    // The same board, answered by the Ashby host itself, reads.
    vi.stubGlobal('fetch', async (input: string | URL) => answering(String(input), fiveMiBBoard()))
    await expect(fetchPosting(`https://jobs.ashbyhq.com/acme/${JOB_ID}`)).resolves.toMatchObject({ adapter: 'ashby' })
  })
})

describe('the fetch reader — what it read before, it reads the same', () => {
  it('a body of exactly 4 MiB, plain or gzipped', async () => {
    viaLocalServer()
    for (const path of ['page-at-cap', 'gzip-at-cap']) {
      const { status, text } = await getGuardedText(new URL(`https://pages.example.com/${path}`))
      expect(status).toBe(200)
      expect(text.length).toBe(CAP)
      expect(text).toBe('a'.repeat(CAP))
    }
  })

  it('text decoded as res.text() decodes it: the BOM dropped, characters split across chunks, a bad byte replaced', async () => {
    viaLocalServer()
    const { text } = await getGuardedText(new URL('https://pages.example.com/utf8'))
    expect(text).toBe(await new Response(UTF8).text())
    expect(text.startsWith('Rôle')).toBe(true)
  })

  it('a job board under the cap, through getJson', async () => {
    viaLocalServer()
    await expect(fetchPosting(`https://jobs.ashbyhq.com/small/${JOB_ID}`)).resolves.toMatchObject({
      adapter: 'ashby',
      role: 'Engineer',
    })
  })

  it('a body that stalls still ends at the 10 s timeout, as a page that could not be reached', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', async (_: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<html><body>'))
            // As undici does: the request's abort ends the body it was still delivering.
            init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
          },
        }),
        { status: 200 },
      ))
    let settled = false
    const read = outcome(getGuardedText(new URL('https://pages.example.com/stall'))).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await read).toBe('Could not reach pages.example.com — paste the job description text instead')
  })
})
