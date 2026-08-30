import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, InterviewRound } from '@/lib/types'

// The two read-only routes the dashboard needs: the rounds belonging to one application, and
// one round as a calendar file. Firestore is faked; what is under test is the contract the
// strip depends on — who is allowed to read, what is missing, and what a round with no time
// on it yet does instead of exporting a broken event.

const { requireUser, listInterviews, getInterview, getApplication } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listInterviews: vi.fn(),
  getInterview: vi.fn(),
  getApplication: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ listInterviews, getInterview, getApplication }))

import { GET as LIST } from '@/app/api/applications/[id]/interviews/route'
import { GET as ICS } from '@/app/api/applications/[id]/interviews/[rid]/ics/route'

const app = {
  id: 'app-1',
  company: 'Nectir',
  role: 'Founding Engineer',
  status: 'interviewing',
} as Application

const round: InterviewRound = {
  id: 'r-1',
  noticeRaw: 'Zoom with Kavitha, Sept 5',
  roundType: 'recruiter-screen',
  datetime: '2026-09-05T17:00:00.000Z',
  people: ['Kavitha Rao', 'Sam Lee'],
  chat: [],
  createdAt: '2026-08-28T09:00:00.000Z',
}

const req = () => new Request('https://example.test/api/applications/app-1/interviews')
const listCtx = { params: Promise.resolve({ id: 'app-1' }) }
const icsCtx = { params: Promise.resolve({ id: 'app-1', rid: 'r-1' }) }

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  listInterviews.mockResolvedValue([round])
  getInterview.mockResolvedValue(round)
  getApplication.mockResolvedValue(app)
})

describe('GET /api/applications/[id]/interviews', () => {
  it('answers with the rounds under that application, scoped to the caller', async () => {
    const res = await LIST(req(), listCtx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([round])
    expect(listInterviews).toHaveBeenCalledWith('user-1', 'app-1')
  })

  it('returns the guard verbatim and never touches the database when unauthenticated', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await LIST(req(), listCtx)).status).toBe(401)
    expect(listInterviews).not.toHaveBeenCalled()
  })
})

describe('GET /api/applications/[id]/interviews/[rid]/ics', () => {
  it('answers with a downloadable calendar file for the round', async () => {
    const res = await ICS(req(), icsCtx)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/calendar')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="interview.ics"')

    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('DTSTART:20260905T170000Z')
    expect(body).toContain('SUMMARY:Recruiter screen — Nectir')
    // Role and interviewers travel with the event: it is read on a phone, away from the app.
    expect(body).toContain('Founding Engineer')
    expect(body).toContain('Kavitha Rao')
  })

  it('keys the event on the round id, so a re-export replaces rather than duplicates', async () => {
    const uid = async () => (await (await ICS(req(), icsCtx)).text()).match(/UID:.*/)?.[0]
    expect(await uid()).toBe('UID:r-1@find-a-job')

    // The two edits that send somebody back for another copy.
    getInterview.mockResolvedValue({ ...round, datetime: '2026-09-08T21:00:00.000Z' })
    expect(await uid()).toBe('UID:r-1@find-a-job')
    getInterview.mockResolvedValue({ ...round, people: ['Kavitha Rao', 'A New Person'] })
    expect(await uid()).toBe('UID:r-1@find-a-job')
  })

  it('is a 404 when the round or the application is gone', async () => {
    getInterview.mockResolvedValue(null)
    expect((await ICS(req(), icsCtx)).status).toBe(404)

    getInterview.mockResolvedValue(round)
    getApplication.mockResolvedValue(null)
    expect((await ICS(req(), icsCtx)).status).toBe(404)
  })

  it('refuses a round with no readable time instead of exporting a broken event', async () => {
    getInterview.mockResolvedValue({ ...round, datetime: undefined })
    const missing = await ICS(req(), icsCtx)
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: string }).error).toMatch(/time/i)

    getInterview.mockResolvedValue({ ...round, datetime: 'next Tuesday' })
    expect((await ICS(req(), icsCtx)).status).toBe(400)
  })

  it('returns the guard verbatim and never reads the round when unauthenticated', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await ICS(req(), icsCtx)).status).toBe(401)
    expect(getInterview).not.toHaveBeenCalled()
  })
})
