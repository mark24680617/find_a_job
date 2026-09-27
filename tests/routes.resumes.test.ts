import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BOUND_MESSAGE,
  ExtractError,
  MAX_PARSE_QUEUE,
  MAX_RESUME_BYTES,
  MAX_UPLOAD_BODY_BYTES,
  READER_BUSY_MESSAGE,
  TOO_LARGE_MESSAGE,
} from '@/lib/resume/bounds'
import { DEPLOYMENT_SPENT_MESSAGE, TOOLS_OFF_MESSAGE, UID_SPENT_MESSAGE } from '@/lib/resume/meter'
import type { StoredResume } from '@/lib/types'

// The resume's way in, with auth, the database and the extractor all faked: no Admin SDK, no
// PDF parser, no model call. The bounds are the real ones — they are pure, and the two size
// checks are what this route exists to apply.
//
// Under test: the header check refuses BEFORE the body is read; the decoded bytes are checked
// again after; the daily permit is taken before the parse and not before the refusals; each
// extraction bound answers 422 naming itself; a re-upload keeps the derived artifacts with their
// old reviewedFrom; and the snippet report is recomputed against the text that has just been
// stored.

const { requireUser, getProfile, getResume, setResume, deleteResume } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getProfile: vi.fn(),
  getResume: vi.fn(),
  setResume: vi.fn(),
  deleteResume: vi.fn(),
}))
const { extractResume, parseQueueDepth } = vi.hoisted(() => ({
  extractResume: vi.fn(),
  parseQueueDepth: vi.fn(),
}))
const { resumeToolsEnabled, takePermit } = vi.hoisted(() => ({
  resumeToolsEnabled: vi.fn(),
  takePermit: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({
  getProfile,
  getResume,
  setResume,
  deleteResume,
  RESUME_CURRENT_ID: 'current',
}))
vi.mock('@/lib/resume/extract', () => ({ extractResume, parseQueueDepth }))
// The real refusal sentences and `permitRefusal` (R49); only the switch and the transaction are
// faked. The meter module reaches for the Admin SDK at import, so that is stubbed to nothing.
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {} }))
vi.mock('@/lib/resume/meter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resume/meter')>()),
  resumeToolsEnabled,
  takePermit,
}))

import { POST } from '@/app/api/profile/resumes/route'
import { DELETE, GET } from '@/app/api/profile/resumes/[id]/route'

const EXTRACTED = {
  text: 'Senior Backend Engineer — Marram Systems\nCut checkout latency from 900 ms to 180 ms',
  lines: [{ page: 1, x: 72, y: 720, size: 11, font: 'f1', text: 'Senior Backend Engineer — Marram Systems' }],
  sections: [{ name: 'experience', fromLine: 0, toLine: 1 }],
  entries: [],
  bullets: [{ id: 'b1', entryIndex: -1, lines: [1], text: 'Cut checkout latency from 900 ms to 180 ms' }],
  language: 'en' as const,
  pages: 1,
}

/** The body as it goes on the wire, with content-length set the way a real client sets it. */
const request = (body: unknown, declared?: number) => {
  const payload = JSON.stringify(body)
  return new Request('https://example.test/api/profile/resumes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(declared ?? Buffer.byteLength(payload)),
    },
    body: payload,
  })
}
const post = (body: unknown, declared?: number) => POST(request(body, declared))

const upload = (over: Record<string, unknown> = {}) => ({
  pdfBase64: Buffer.from('a small pretend PDF').toString('base64'),
  filename: 'resume.pdf',
  ...over,
})

/** The stored document, mutated by the write, so the read-back answers what was written. */
let stored: StoredResume | null

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-21T09:00:00.000Z'))
  stored = null
  requireUser.mockResolvedValue({ uid: 'user-1' })
  resumeToolsEnabled.mockReturnValue(true)
  takePermit.mockResolvedValue('ok')
  getProfile.mockResolvedValue({ facts: [], standardAnswers: {}, voiceRules: [], gaps: [] })
  getResume.mockImplementation(async () => stored)
  setResume.mockImplementation(async (_uid: string, _id: string, doc: StoredResume) => {
    stored = doc
  })
  extractResume.mockResolvedValue(EXTRACTED)
  parseQueueDepth.mockReturnValue(0)
})

describe('POST /api/profile/resumes — the guards', () => {
  it('returns the auth guard verbatim and never reads, extracts or writes', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post(upload())).status).toBe(401)
    expect(extractResume).not.toHaveBeenCalled()
    expect(setResume).not.toHaveBeenCalled()
  })

  it('is a 503 with the flag when the kill switch is off', async () => {
    resumeToolsEnabled.mockReturnValue(false)
    const res = await post(upload())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: TOOLS_OFF_MESSAGE, disabled: true })
    expect(extractResume).not.toHaveBeenCalled()
  })

  it('refuses an oversized content-length before a byte of the body is read', async () => {
    const req = request(upload(), MAX_UPLOAD_BODY_BYTES + 1)
    const res = await POST(req)
    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({ error: TOO_LARGE_MESSAGE })
    expect(req.bodyUsed).toBe(false)
    expect(extractResume).not.toHaveBeenCalled()
  })

  it('refuses a missing or unparseable content-length rather than reading an unmeasured body', async () => {
    const withoutHeader = new Request('https://example.test/api/profile/resumes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(upload()),
    })
    expect((await POST(withoutHeader)).status).toBe(413)
    const unparseable = request(upload(), Number.NaN)
    expect((await POST(unparseable)).status).toBe(413)
    expect(withoutHeader.bodyUsed).toBe(false)
    expect(unparseable.bodyUsed).toBe(false)
    expect(extractResume).not.toHaveBeenCalled()
  })

  it('refuses the decoded document again, because base64 is a third longer than the file', async () => {
    const oversized = Buffer.alloc(MAX_RESUME_BYTES + 1).toString('base64')
    // Declared small enough to pass the header check, so it is the second check that fires.
    const res = await post(upload({ pdfBase64: oversized }), 1_024)
    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({ error: TOO_LARGE_MESSAGE })
    expect(extractResume).not.toHaveBeenCalled()
  })

  it('refuses a body with nothing to read', async () => {
    expect((await post({ filename: 'resume.pdf' })).status).toBe(400)
    expect((await post(upload({ filename: '  ' }))).status).toBe(400)
    expect(setResume).not.toHaveBeenCalled()
    // None of the refusals above cost the account a permit: a body we never parsed is not an
    // upload, and a day's allowance spent on typos is an allowance nobody can plan against.
    expect(takePermit).not.toHaveBeenCalled()
  })
})

describe('POST /api/profile/resumes — the daily permit', () => {
  it('takes one upload unit for today, after the two size checks and before the parse', async () => {
    await post(upload())
    expect(takePermit).toHaveBeenCalledWith('user-1', 'upload', '2026-09-21', 1)
    // The parse is the expensive thing on this route — up to MAX_EXTRACT_MS of CPU — so the
    // permit has to be taken in front of it, not after it.
    expect(takePermit.mock.invocationCallOrder[0]).toBeLessThan(
      extractResume.mock.invocationCallOrder[0],
    )
  })

  it('answers 429 naming which ceiling, and never parses or writes', async () => {
    takePermit.mockResolvedValue('uid-limit')
    const res = await post(upload())
    expect(res.status).toBe(429)
    // The meter's one wording for each ceiling, the same on every metered route (R49).
    await expect(res.json()).resolves.toEqual({ error: UID_SPENT_MESSAGE, ceiling: 'uid' })
    expect(extractResume).not.toHaveBeenCalled()
    expect(setResume).not.toHaveBeenCalled()

    takePermit.mockResolvedValue('deployment-limit')
    const capped = await post(upload())
    expect(capped.status).toBe(429)
    await expect(capped.json()).resolves.toEqual({
      error: DEPLOYMENT_SPENT_MESSAGE,
      ceiling: 'deployment',
    })
  })
})

describe('POST /api/profile/resumes — the parse queue', () => {
  it('answers 503 busy with MAX_PARSE_QUEUE parses ahead, and spends no permit on it', async () => {
    // One parse at a time per process, each up to 20 s: an upload behind four would wait past
    // the 80 s the queue promises, and a burst of them past Cloud Run's 300 s timeout.
    parseQueueDepth.mockReturnValue(MAX_PARSE_QUEUE)
    const res = await post(upload())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: READER_BUSY_MESSAGE, busy: true })
    expect(takePermit).not.toHaveBeenCalled()
    expect(extractResume).not.toHaveBeenCalled()
    expect(setResume).not.toHaveBeenCalled()
  })

  it('takes the upload with one place left, and asks only after the size checks', async () => {
    parseQueueDepth.mockReturnValue(MAX_PARSE_QUEUE - 1)
    expect((await post(upload())).status).toBe(200)
    expect(takePermit).toHaveBeenCalledTimes(1)
    parseQueueDepth.mockClear()
    expect((await post(upload(), MAX_UPLOAD_BODY_BYTES + 1)).status).toBe(413)
    expect(parseQueueDepth).not.toHaveBeenCalled()
  })
})

describe('POST /api/profile/resumes — the extraction', () => {
  // Table-driven over every `ExtractBound` (amended 2026-09-24, B-18): the promise is a 422 per
  // bound, so each bound is exercised, not only 'pages'.
  it.each(['pages', 'chars', 'lines', 'bullets', 'ms', 'memory'] as const)(
    'answers 422 naming the %s bound the document blew, and writes nothing',
    async (bound) => {
      extractResume.mockRejectedValue(new ExtractError(bound))
      const res = await post(upload())
      expect(res.status).toBe(422)
      await expect(res.json()).resolves.toEqual({ error: BOUND_MESSAGE[bound], extractFailed: true })
      expect(setResume).not.toHaveBeenCalled()
    },
  )

  it('never passes the parser’s own message through, because a handler’s throw is logged', async () => {
    extractResume.mockRejectedValue(new Error('XRef: /Root/Pages missing at offset 91021'))
    const res = await post(upload())
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).not.toContain('XRef')
    expect(body.error).toContain('could not be read as a PDF')
  })
})

describe('POST /api/profile/resumes — the write', () => {
  it('stores the extraction, stamps addedAt and answers the re-read document', async () => {
    const res = await post(upload())
    expect(res.status).toBe(200)
    const body = (await res.json()) as StoredResume
    expect(setResume).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({
      addedAt: '2026-09-21T09:00:00.000Z',
      filename: 'resume.pdf',
      text: EXTRACTED.text,
      language: 'en',
    })
    expect(body.bullets.map((b) => b.id)).toEqual(['b1'])
    expect(body).not.toHaveProperty('pages')
  })

  it('keeps the derived artifacts on a re-upload, stale against their old reviewedFrom', async () => {
    stored = {
      ...EXTRACTED,
      pages: undefined,
      addedAt: '2026-09-01T09:00:00.000Z',
      filename: 'old.pdf',
      bytes: 10,
      diagnose: {
        reviewedFrom: '2026-09-01T09:00:00.000Z',
        judge: 'gemini',
        ranAt: '2026-09-01T09:05:00.000Z',
        checks: [],
        judgements: [],
        findings: [],
      },
    } as unknown as StoredResume
    const body = (await (await post(upload())).json()) as StoredResume
    expect(body.addedAt).toBe('2026-09-21T09:00:00.000Z')
    expect(body.diagnose?.reviewedFrom).toBe('2026-09-01T09:00:00.000Z')
    expect(body.filename).toBe('resume.pdf')
  })

  it('reports the facts it could not find in the text it has just stored', async () => {
    getProfile.mockResolvedValue({
      facts: [
        { id: 'f1', claim: 'a claim', sourceSnippet: 'Cut checkout latency from 900 ms to 180 ms', tags: [] },
        { id: 'f2', claim: 'another', sourceSnippet: 'Ran the payroll rewrite', tags: [] },
      ],
      standardAnswers: {},
      voiceRules: [],
      gaps: [],
    })
    const body = (await (await post(upload())).json()) as StoredResume
    expect(body.snippetCheck).toEqual({
      reviewedFrom: '2026-09-21T09:00:00.000Z',
      located: 1,
      total: 2,
      missing: ['Ran the payroll rewrite'],
    })
  })
})

const del = (id: string) =>
  DELETE(new Request(`https://example.test/api/profile/resumes/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })

describe('DELETE /api/profile/resumes/[id]', () => {
  it('removes the document and answers 204 with no body', async () => {
    stored = { ...EXTRACTED, addedAt: 'x', filename: 'r.pdf', bytes: 1 } as unknown as StoredResume
    const res = await del('current')
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(deleteResume).toHaveBeenCalledWith('user-1', 'current')
  })

  it('answers the same 404 for an id that is not there and an id that is malformed', async () => {
    stored = null
    const missing = await del('current')
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: 'not found' })

    const malformed = await del('../../users/someone-else')
    expect(malformed.status).toBe(404)
    await expect(malformed.json()).resolves.toEqual({ error: 'not found' })
    expect(getResume).toHaveBeenCalledTimes(1) // the malformed id never reached a read
    expect(deleteResume).not.toHaveBeenCalled()
  })

  it('refuses an id past 64 characters without reading anything', async () => {
    const res = await del('a'.repeat(65))
    expect(res.status).toBe(404)
    expect(getResume).not.toHaveBeenCalled()
  })

  it('returns the auth guard verbatim and never deletes', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await del('current')).status).toBe(401)
    expect(deleteResume).not.toHaveBeenCalled()
  })

  it('deletes even with the kill switch off — a person may always remove their own document', async () => {
    resumeToolsEnabled.mockReturnValue(false)
    stored = { ...EXTRACTED, addedAt: 'x', filename: 'r.pdf', bytes: 1 } as unknown as StoredResume
    expect((await del('current')).status).toBe(204)
    expect(deleteResume).toHaveBeenCalledTimes(1)
  })
})

const get = (id: string) =>
  GET(new Request(`https://example.test/api/profile/resumes/${id}`), {
    params: Promise.resolve({ id }),
  })

describe('GET /api/profile/resumes/[id]', () => {
  it('returns the stored resume', async () => {
    stored = { ...EXTRACTED, addedAt: '2026-09-21T09:00:00.000Z', filename: 'r.pdf', bytes: 1 } as unknown as StoredResume
    const res = await get('current')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ addedAt: '2026-09-21T09:00:00.000Z' })
    expect(getResume).toHaveBeenCalledWith('user-1', 'current')
  })

  it('answers the same 404 for a missing document and for a malformed id', async () => {
    stored = null
    const missing = await get('current')
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: 'not found' })

    const malformed = await get('../other')
    expect(malformed.status).toBe(404)
    await expect(malformed.json()).resolves.toEqual({ error: 'not found' })
    // The malformed id never reached the database, so it says nothing about what exists.
    expect(getResume).toHaveBeenCalledTimes(1)
  })

  it('returns requireUser’s 401 unchanged', async () => {
    requireUser.mockResolvedValue(new Response(null, { status: 401 }))
    expect((await get('current')).status).toBe(401)
  })
})
