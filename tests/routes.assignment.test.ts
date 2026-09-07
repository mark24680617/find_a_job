import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FetchBlockedError } from '@/adapters/types'
import { FlowOutputError } from '@/ai/genkit'
import { MAX_BRIEF_CHARS, MAX_PDF_BYTES } from '@/lib/assignment'
import type { Application, Assignment, InterviewRound } from '@/lib/types'

// The brief's way in, with the database, the auth guard, the link reader and the transcription
// all faked: no Admin SDK, no network, no model call. `cutBrief` and the caps are the real ones
// — they are pure, and the one length rule is what this route exists to apply.
//
// Under test: the three paths differ only in how the text is got; everything after that is one
// rule in one wording; nothing is written when the read failed, at any status; and the write
// goes through `replaceAssignment` rather than `updateInterview`, because a new brief has to
// take the old plan with it.

const { requireUser, getApplication, getInterview, replaceAssignment } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  getInterview: vi.fn(),
  replaceAssignment: vi.fn(),
}))
const { runAssignmentTranscribe } = vi.hoisted(() => ({ runAssignmentTranscribe: vi.fn() }))
const { readBrief } = vi.hoisted(() => ({ readBrief: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, getInterview, replaceAssignment }))
vi.mock('@/ai/flows/assignmentTranscribe', () => ({ runAssignmentTranscribe }))
vi.mock('@/lib/readBrief', () => ({ readBrief }))

import { POST } from '@/app/api/applications/[id]/interviews/[rid]/assignment/route'

/** Comfortably over MIN_BRIEF_CHARS (200), and short enough to read in a diff. */
const BRIEF =
  'Build a small service that ingests the attached ledger file and exposes one endpoint. ' +
  'Keep it simple and explain your trade-offs in a README. '.repeat(4).trim()

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'a posting',
  adapter: 'manual',
  questions: [],
  status: 'interviewing',
  timeline: [{ event: 'created', at: '2026-08-20T09:00:00.000Z' }],
  createdAt: '2026-08-20T09:00:00.000Z',
  ...over,
})

const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r-1',
  noticeRaw: 'Your take-home is attached — please send it back by Friday.',
  roundType: 'take-home',
  people: [],
  chat: [],
  createdAt: '2026-09-04T10:00:00.000Z',
  ...over,
})

const post = (body: unknown) =>
  POST(
    new Request('https://example.test/api/applications/app-1/interviews/r-1/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'app-1', rid: 'r-1' }) },
  )

/** The stored round, mutated by the write, so the read-back answers what was actually written. */
let stored: InterviewRound

beforeEach(() => {
  vi.resetAllMocks()
  stored = round()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockImplementation(async () => application())
  getInterview.mockImplementation(async () => stored)
  replaceAssignment.mockImplementation(
    async (_uid: string, _appId: string, _rid: string, assignment: Assignment) => {
      stored = { ...stored, assignment }
    },
  )
  readBrief.mockResolvedValue(BRIEF)
  runAssignmentTranscribe.mockResolvedValue({ text: BRIEF })
})

describe('POST …/assignment — the guards', () => {
  it('returns the auth guard verbatim and never reads or writes anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post({ pastedText: BRIEF })).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('is a 404 when the application is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    const res = await post({ pastedText: BRIEF })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'not found' })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('is a 404 when the round is not the caller’s', async () => {
    getInterview.mockResolvedValue(null)
    expect((await post({ pastedText: BRIEF })).status).toBe(404)
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('refuses every round type but take-home — the others have no document to read', async () => {
    stored = round({ roundType: 'technical' })
    const res = await post({ pastedText: BRIEF })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'only a take-home round has a brief' })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('refuses a body with nothing to read', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'send pastedText, pdfBase64 or url — one of them',
    })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('refuses a body with two, rather than guessing which one they meant', async () => {
    // Storing one of them under a source line naming the other is the failure this prevents.
    const res = await post({ pastedText: BRIEF, url: 'https://example.com/brief' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'send pastedText, pdfBase64 or url — one of them',
    })
    expect(readBrief).not.toHaveBeenCalled()
    expect(replaceAssignment).not.toHaveBeenCalled()
  })
})

describe('POST …/assignment — a paste', () => {
  it('stores it as the brief and answers with the round read back', async () => {
    const res = await post({ pastedText: `  ${BRIEF}  ` })
    expect(res.status).toBe(200)

    expect(replaceAssignment).toHaveBeenCalledTimes(1)
    const [uid, appId, rid, assignment] = replaceAssignment.mock.calls[0] as [
      string,
      string,
      string,
      Assignment,
    ]
    expect([uid, appId, rid]).toEqual(['user-1', 'app-1', 'r-1'])
    expect(assignment).toEqual({
      text: BRIEF,
      source: 'pasted',
      addedAt: expect.any(String),
      cut: false,
    })
    expect(Date.parse(assignment.addedAt)).not.toBeNaN()
    // Read back, not composed: whatever the write did to the record is what the page is given.
    await expect(res.json()).resolves.toEqual({ ...round(), assignment })
  })

  it('cuts a paste longer than the cap and says on the record that it did', async () => {
    await post({ pastedText: 'x'.repeat(25_000) })
    const assignment = replaceAssignment.mock.calls[0][3] as Assignment
    expect(assignment.text).toHaveLength(MAX_BRIEF_CHARS)
    expect(assignment.cut).toBe(true)
  })

  it('refuses a paste too short to plan from, writing nothing', async () => {
    const res = await post({ pastedText: 'x'.repeat(100) })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'that is too short to plan from — paste the whole brief',
      readFailed: true,
    })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })
})

describe('POST …/assignment — a link', () => {
  it('reads the address as it was given and stores it unrewritten', async () => {
    const url = 'https://docs.google.com/document/d/abc123/edit'
    const res = await post({ url })
    expect(res.status).toBe(200)

    // The rewrite to the export form belongs to `readBrief`. What the record keeps is what the
    // candidate pasted, because that is the address the line on screen links to.
    expect(readBrief).toHaveBeenCalledWith(url)
    expect(replaceAssignment.mock.calls[0][3]).toEqual({
      text: BRIEF,
      source: 'url',
      url,
      addedAt: expect.any(String),
      cut: false,
    })
  })

  it('refuses a link whose page was too short to plan from, in the paste’s own words', async () => {
    // A login wall, a "the exercise is attached" covering note, a Google Doc that exported one
    // line. `readBrief` holds no floor — it hands back whatever it read — so the refusal is the
    // route's one length rule, reached down the link path and worded exactly as it is for a
    // paste. Two paths refused in two wordings would be the same rule said twice, badly.
    readBrief.mockResolvedValue('Please find the exercise attached.')
    const res = await post({ url: 'https://example.com/brief' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'that is too short to plan from — paste the whole brief',
      readFailed: true,
    })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('hands a blocked fetch back in the fetcher’s own words, writing nothing', async () => {
    readBrief.mockRejectedValue(
      new FetchBlockedError('docs.example.com answered with 403 — paste the brief’s text instead'),
    )
    const res = await post({ url: 'https://docs.example.com/brief' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'docs.example.com answered with 403 — paste the brief’s text instead',
      readFailed: true,
    })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })
})

describe('POST …/assignment — a PDF', () => {
  // Four base64 characters carry three bytes, so this is the shortest string that decodes to
  // more than the cap. The check is on the file, not on the string that carried it.
  const oversized = 'A'.repeat(4 * Math.ceil((MAX_PDF_BYTES + 1) / 3))

  it('refuses one over 6 MB before the model is asked to read it', async () => {
    const res = await post({ pdfBase64: oversized })
    expect(res.status).toBe(413)
    await expect(res.json()).resolves.toEqual({
      error: 'that PDF is over 6 MB — paste the brief’s text instead',
    })
    expect(runAssignmentTranscribe).not.toHaveBeenCalled()
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('transcribes it and stores the transcription as the brief', async () => {
    const res = await post({ pdfBase64: 'JVBERi0xLjQK' })
    expect(res.status).toBe(200)
    expect(runAssignmentTranscribe).toHaveBeenCalledWith({ pdfBase64: 'JVBERi0xLjQK' })
    expect(replaceAssignment.mock.calls[0][3]).toEqual({
      text: BRIEF,
      source: 'pdf',
      addedAt: expect.any(String),
      cut: false,
    })
  })

  it('refuses a transcription too short to plan from, in the paste’s own words', async () => {
    // The flow refuses only an EMPTY transcription; a PDF that came out short is a real reading
    // of a real file, and how short is too short is this route's rule and no one else's. Same
    // sentence, same 422, same nothing written as for a short paste or a short page.
    runAssignmentTranscribe.mockResolvedValue({ text: 'Ship a CSV parser by Friday.' })
    const res = await post({ pdfBase64: 'JVBERi0xLjQK' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'that is too short to plan from — paste the whole brief',
      readFailed: true,
    })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })

  it('hands a transcription failure back as the reason, writing nothing', async () => {
    runAssignmentTranscribe.mockRejectedValue(
      new FlowOutputError('the PDF transcribed to nothing — paste the brief’s text instead'),
    )
    const res = await post({ pdfBase64: 'JVBERi0xLjQK' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'the PDF transcribed to nothing — paste the brief’s text instead',
      readFailed: true,
    })
    expect(replaceAssignment).not.toHaveBeenCalled()
  })
})
