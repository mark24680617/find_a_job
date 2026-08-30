import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, Profile, Question, VoiceRule } from '@/lib/types'
import type { FeedbackDistillOut } from '@/ai/schemas'
import { FlowOutputError } from '@/ai/genkit'
import type { FeedbackDistillInput } from '@/ai/prompts/feedbackDistill'

// The handler with everything behind it faked: no Admin SDK, no model call. What is under
// test is the finalize contract — the save lands FIRST and unconditionally, learning runs
// only on a genuine edit, and nothing the optional learning step can throw ever costs the
// human the answer they saved.

const { requireUser, getApplication, updateApplication, getProfile, setProfile } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    getApplication: vi.fn(),
    updateApplication: vi.fn(),
    getProfile: vi.fn(),
    setProfile: vi.fn(),
  }),
)
const { runFeedbackDistill } = vi.hoisted(() => ({ runFeedbackDistill: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, updateApplication, getProfile, setProfile }))
vi.mock('@/ai/flows/feedbackDistill', () => ({ runFeedbackDistill }))

import { POST } from '@/app/api/applications/[id]/questions/[idx]/finalize/route'

// A drafted question: this is the answer the model wrote, opener and adjective and all.
const drafted = (over: Partial<Question> = {}): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  draft: { text: 'I am excited to say I own a fast payments service.', citations: [] },
  askHuman: [],
  status: 'drafted',
  ...over,
})

const other = (): Question => ({
  q: 'Where are you based?',
  constraints: { type: 'short-text', required: false },
  askHuman: [],
  status: 'pending',
})

const FINAL = 'I own a payments service handling 12,000 requests a day.'

const profile = (over: Partial<Profile> = {}): Profile => ({
  facts: [],
  standardAnswers: {},
  voiceRules: [
    { rule: 'cuts openers, starts with the fact', evidence: 'x', createdAt: '2026-08-01T00:00:00.000Z' },
  ],
  gaps: [],
  ...over,
})

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Build a ledger.',
  adapter: 'ashby',
  questions: [drafted(), other()],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00.000Z' }],
  createdAt: '2026-08-27T00:00:00.000Z',
  ...over,
})

// A rule the profile does not already hold, so an append is visible.
const distilled: FeedbackDistillOut = {
  rules: [{ rule: 'replaces adjectives with numbers', evidence: 'fast → 12,000 requests a day' }],
}

const post = (body?: unknown, id = 'app-1', idx = '0') =>
  new Request(`https://example.test/api/applications/${id}/questions/${idx}/finalize`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const ctx = (id: string, idx: string) => ({ params: Promise.resolve({ id, idx }) })

const patchOf = () => updateApplication.mock.calls[0][2] as Partial<Application>
const written = (i = 0) => (patchOf().questions as Question[])[i]
const flowInput = () => runFeedbackDistill.mock.calls[0][0] as FeedbackDistillInput
const savedProfile = () => setProfile.mock.calls[0][1] as Profile

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  getProfile.mockResolvedValue(profile())
  runFeedbackDistill.mockResolvedValue(distilled)
})

describe('POST .../questions/[idx]/finalize — what it accepts', () => {
  it('401s before reading anything or calling the model', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(post({ final: FINAL }), ctx('app-1', '0'))).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runFeedbackDistill).not.toHaveBeenCalled()
  })

  it('400s a body with no final, or a final that is not a string, without reading the record', async () => {
    const bad: unknown[] = [undefined, {}, { final: 7 }, { final: null }, { final: ['a'] }]
    for (const body of bad) {
      const res = await POST(post(body), ctx('app-1', '0'))
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(getApplication).not.toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('400s an index that is not a whole number, without reading the record', async () => {
    for (const idx of ['', 'first', '1.5', '-1', '0x1', ' 1', 'NaN', 'Infinity']) {
      const res = await POST(post({ final: FINAL }), ctx('app-1', idx))
      expect(res.status, idx).toBe(400)
    }
    expect(getApplication).not.toHaveBeenCalled()
  })

  it('404s an application that is not there — or is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    const res = await POST(post({ final: FINAL }), ctx('nope', '0'))
    expect(res.status).toBe(404)
    expect(getApplication).toHaveBeenCalledWith('user-1', 'nope')
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('400s an index past the end of the questions the form actually has', async () => {
    for (const idx of ['2', '7']) {
      const res = await POST(post({ final: FINAL }), ctx('app-1', idx))
      expect(res.status).toBe(400)
    }
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('takes an empty-string final — clearing an answer is the human’s call, not a bad request', async () => {
    const res = await POST(post({ final: '' }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    expect(written().final).toBe('')
    expect(written().status).toBe('final')
  })
})

describe('POST .../questions/[idx]/finalize — the save', () => {
  it('stores the final and marks the question final, leaving the others alone', async () => {
    const res = await POST(post({ final: FINAL }), ctx('app-1', '0'))
    expect(res.status).toBe(200)

    const [uid, id] = updateApplication.mock.calls[0]
    expect(uid).toBe('user-1')
    expect(id).toBe('app-1')
    expect(written()).toEqual({ ...drafted(), final: FINAL, status: 'final' } satisfies Question)
    expect((patchOf().questions as Question[])[1]).toEqual(other())
  })

  it('answers with the updated question and the rules learned this call', async () => {
    const res = await POST(post({ final: FINAL }), ctx('app-1', '0'))
    const body = (await res.json()) as { question: Question; newRules: VoiceRule[] }
    expect(body.question).toEqual(written())
    expect(body.newRules).toEqual([
      { rule: 'replaces adjectives with numbers', evidence: 'fast → 12,000 requests a day', createdAt: expect.any(String) },
    ])
    expect(Number.isNaN(Date.parse(body.newRules[0].createdAt))).toBe(false)
  })
})

describe('POST .../questions/[idx]/finalize — learning from the edit', () => {
  it('runs feedbackDistill with the draft, the final and the rules already known', async () => {
    await POST(post({ final: FINAL }), ctx('app-1', '0'))
    expect(flowInput()).toEqual({
      draft: 'I am excited to say I own a fast payments service.',
      final: FINAL,
      existingRules: ['cuts openers, starts with the fact'],
    })
  })

  it('appends the learned rules to the profile, each stamped with a time', async () => {
    await POST(post({ final: FINAL }), ctx('app-1', '0'))
    const rules = savedProfile().voiceRules
    expect(rules).toHaveLength(2)
    expect(rules[0]).toEqual(profile().voiceRules[0])
    expect(rules[1].rule).toBe('replaces adjectives with numbers')
    expect(rules[1].evidence).toBe('fast → 12,000 requests a day')
    expect(Number.isNaN(Date.parse(rules[1].createdAt))).toBe(false)
  })

  it('skips learning entirely when the question has no draft to compare against', async () => {
    const noDraft = drafted({ draft: undefined, status: 'pending' })
    getApplication.mockResolvedValue(application({ questions: [noDraft, other()] }))

    const res = await POST(post({ final: FINAL }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ newRules: [] })
    expect(runFeedbackDistill).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
    expect(written().final).toBe(FINAL)
  })

  it('skips learning when the human left the draft word for word', async () => {
    const kept = 'I own a payments service handling 12,000 requests a day.'
    getApplication.mockResolvedValue(
      application({ questions: [drafted({ draft: { text: kept, citations: [] } }), other()] }),
    )

    const res = await POST(post({ final: kept }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ newRules: [] })
    expect(runFeedbackDistill).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('learns nothing, and touches nothing, when the edit shows no pattern', async () => {
    runFeedbackDistill.mockResolvedValue({ rules: [] } satisfies FeedbackDistillOut)
    const res = await POST(post({ final: FINAL }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ newRules: [] })
    expect(runFeedbackDistill).toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('caps voiceRules at twelve, dropping the oldest', async () => {
    const twelve: VoiceRule[] = Array.from({ length: 12 }, (_, i) => ({
      rule: `rule ${i}`,
      evidence: `e${i}`,
      createdAt: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))
    getProfile.mockResolvedValue(profile({ voiceRules: twelve }))

    await POST(post({ final: FINAL }), ctx('app-1', '0'))
    const rules = savedProfile().voiceRules
    expect(rules).toHaveLength(12)
    expect(rules.find((r) => r.rule === 'rule 0')).toBeUndefined()
    expect(rules[0].rule).toBe('rule 1')
    expect(rules[11].rule).toBe('replaces adjectives with numbers')
  })
})

describe('POST .../questions/[idx]/finalize — the save never rides on the learning', () => {
  it('keeps the final when feedbackDistill refuses its output, and reports no rules', async () => {
    // The critical one. The save landed on the record before the model was ever called, so a
    // FlowOutputError from the learning step is swallowed: 200, final persisted, no rules.
    runFeedbackDistill.mockRejectedValue(new FlowOutputError('no output after one retry'))

    const res = await POST(post({ final: FINAL }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ newRules: [] })
    expect(written().final).toBe(FINAL)
    expect(written().status).toBe('final')
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('has already saved the final by the time a non-flow failure goes up', async () => {
    // A Firestore outage in the learning step is not the human's to act on, and it goes up as
    // a 500 — but the save already happened, so the answer is on the record regardless.
    runFeedbackDistill.mockRejectedValue(new Error('socket hang up'))
    await expect(POST(post({ final: FINAL }), ctx('app-1', '0'))).rejects.toThrow('socket hang up')
    expect(written().final).toBe(FINAL)
    expect(setProfile).not.toHaveBeenCalled()
  })
})
