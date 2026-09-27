import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnsweredAsk, StoredResume } from '@/lib/types'

// The write path behind every askHuman card on this feature — §6.2's bucket 3 and §6.3's
// missing-Y asks alike. No model call and no meter: this stores what the candidate typed.

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }))
const { getResume, appendResumeAsk } = vi.hoisted(() => ({
  getResume: vi.fn(),
  appendResumeAsk: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getResume, appendResumeAsk }))

import { POST } from '@/app/api/profile/resumes/[id]/asks/route'

const answered = (over: Partial<AnsweredAsk> = {}): AnsweredAsk => ({
  askId: 'gaps-apache-kafka',
  question: 'Have you done this?',
  answer: 'Yes — I ran the Kafka consumers for two years at Marram.',
  answeredAt: '2026-09-20T10:00:00.000Z',
  ...over,
})

const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: '2026-09-20T09:00:00.000Z',
  filename: 'resume.pdf',
  bytes: 41_231,
  text: 'Senior Backend Engineer, Marram Systems.',
  lines: [],
  sections: [],
  entries: [],
  bullets: [],
  language: 'en',
  ...over,
})

const post = (
  body: unknown = {
    askId: 'gaps-apache-kafka',
    question: 'Have you done this?',
    answer: 'Yes — I ran the Kafka consumers for two years at Marram.',
  },
  id = 'current',
) =>
  POST(
    new Request('https://example.test/api/profile/resumes/current/asks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

// The checks and the append themselves run in one transaction (appendResumeAsk, pinned in
// tests/db.resumeAsks.test.ts); here the route is held to what it hands the helper and how it
// maps each of the helper's four outcomes.
const handed = () => appendResumeAsk.mock.calls[0][2] as AnsweredAsk

let stored: StoredResume

beforeEach(() => {
  vi.resetAllMocks()
  stored = resume({ asks: [answered()] })
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getResume.mockImplementation(async () => stored)
  appendResumeAsk.mockResolvedValue('appended')
})

describe('POST …/resumes/[id]/asks — the guards', () => {
  it('returns the auth guard verbatim and never reads or writes anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post()).status).toBe(401)
    expect(getResume).not.toHaveBeenCalled()
    expect(appendResumeAsk).not.toHaveBeenCalled()
  })

  it('is a 404 on an id that is not an id, before any read', async () => {
    expect((await post(undefined, '../../etc/passwd')).status).toBe(404)
    expect(getResume).not.toHaveBeenCalled()
    expect(appendResumeAsk).not.toHaveBeenCalled()
  })

  it('refuses an ask missing any of its three parts', async () => {
    for (const body of [
      { question: 'Have you done this?', answer: 'Yes' },
      { askId: 'a1', answer: 'Yes' },
      { askId: 'a1', question: 'Have you done this?' },
      { askId: 'a1', question: 'Have you done this?', answer: '   ' },
    ]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({
        error: 'an answered ask carries askId, question and answer',
      })
    }
    expect(appendResumeAsk).not.toHaveBeenCalled()
  })

  it('refuses an answer longer than the cap', async () => {
    // R55, second amendment: the answer is capped at 1,000 characters.
    const res = await post({ askId: 'a1', question: 'Have you done this?', answer: 'x'.repeat(1_001) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'an answer is at most 1000 characters' })
    expect(appendResumeAsk).not.toHaveBeenCalled()
  })

  it('refuses a question or an askId longer than its cap', async () => {
    // R55: every part that is stored has a bound, so the asks array has one too.
    const long = await post({ askId: 'a1', question: 'q'.repeat(501), answer: 'Yes' })
    expect(long.status).toBe(400)
    expect(await long.json()).toEqual({ error: 'a question is at most 500 characters' })

    const id = await post({ askId: 'a'.repeat(121), question: 'Have you done this?', answer: 'Yes' })
    expect(id.status).toBe(400)
    expect(await id.json()).toEqual({ error: 'an askId is at most 120 characters' })
    expect(appendResumeAsk).not.toHaveBeenCalled()
  })

  it('is a 404 when there is no resume under this account', async () => {
    appendResumeAsk.mockResolvedValue('missing')
    const res = await post()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
    expect(getResume).not.toHaveBeenCalled()
  })
})

describe('POST …/resumes/[id]/asks — the write', () => {
  it('hands the helper one ask and the count cap, and answers with the document re-read', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(appendResumeAsk).toHaveBeenCalledTimes(1)
    expect(appendResumeAsk.mock.calls[0]).toEqual([
      'user-1',
      'current',
      {
        askId: 'gaps-apache-kafka',
        question: 'Have you done this?',
        answer: 'Yes — I ran the Kafka consumers for two years at Marram.',
        answeredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
      100,
    ])
    expect(getResume).toHaveBeenCalledWith('user-1', 'current')
    expect(await res.json()).toEqual(stored)
  })

  it('trims what arrived rather than storing the whitespace around it', async () => {
    await post({ askId: '  a1 ', question: ' Have you done this? ', answer: '  Yes, twice.  ' })
    expect(handed()).toMatchObject({
      askId: 'a1',
      question: 'Have you done this?',
      answer: 'Yes, twice.',
    })
  })

  it('is a 409 with the duplicate flag on an ask that is already answered', async () => {
    // (amended 2026-09-24, R55) The one refusal a caller may treat as already saved.
    appendResumeAsk.mockResolvedValue('duplicate')
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'that ask is already answered — reload the page',
      duplicate: true,
    })
    expect(getResume).not.toHaveBeenCalled()
  })

  it('is a 422 with the asksFull flag once the resume holds 100 answered asks', async () => {
    // R55, second amendment: the count cap is 100. Its own status (amended 2026-09-24, R55):
    // nothing was stored, so no caller may read it as saved.
    appendResumeAsk.mockResolvedValue('full')
    const res = await post()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'this resume already holds 100 answered asks — no more can be stored',
      asksFull: true,
    })
    expect(getResume).not.toHaveBeenCalled()
  })
})
