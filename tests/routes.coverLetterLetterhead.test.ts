import { describe, it, expect, vi, beforeEach } from 'vitest'
import { newCoverLetter } from '@/lib/letter/letterhead'
import type { Application, Fact, ParsedJob, Question } from '@/lib/types'

// The handler with Firestore and the flow faked. What is under test is the merge and nothing
// else: a blank field takes what the flow found, a typed one keeps what the person typed, and
// the answer names which fields the call actually filled. The flow's own guard is proved in
// `flows.letterheadFill.test.ts`; here it is a stub returning whatever the case needs.

const { requireUser, getApplication, getProfile, updateApplication } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  getProfile: vi.fn(),
  updateApplication: vi.fn(),
}))
const { runLetterheadFill } = vi.hoisted(() => ({ runLetterheadFill: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, getProfile, updateApplication }))
vi.mock('@/ai/flows/letterheadFill', () => ({ runLetterheadFill }))

import { POST } from '@/app/api/applications/[id]/cover-letter/letterhead/route'
import { FlowOutputError } from '@/ai/genkit'

const letterQuestion = (over: Partial<Question['letter']> = {}): Question => {
  const q = newCoverLetter('Tom Candidate', 'tom@x.test')
  return { ...q, letter: { ...q.letter!, ...over } }
}

const formQuestion = (): Question => ({
  q: 'Where are you based?',
  constraints: { type: 'short-text', required: false },
  askHuman: [],
  status: 'pending',
})

// The interpretation every application the create route writes carries, and its company and role
// are deliberately not the record's: the record's are the user's correction of an adapter's
// slug-derived name, and these are what the model read off the posting. Which of the two the fill
// is handed is the whole point of the `??` in the route.
const parsedJob = (): ParsedJob => ({
  company: 'Marram systems',
  role: 'Senior Backend Engineer, Ledger',
  roleFacts: [],
  gates: [],
  themes: [],
  scope: 'per-application',
  advisory: '',
})

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Applications go to Dana Wu, Head of Engineering.',
  adapter: 'ashby',
  parsed: parsedJob(),
  questions: [formQuestion(), letterQuestion()],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00.000Z' }],
  createdAt: '2026-08-27T00:00:00.000Z',
  ...over,
})

const fact = (): Fact => ({
  id: 'f1',
  claim: 'Based in Portland, Oregon',
  sourceSnippet: 'Portland, OR · (503) 555-0161',
  tags: ['contact'],
})

const req = () =>
  new Request('https://example.test/api/applications/app-1/cover-letter/letterhead', {
    method: 'POST',
  })

const ctx = (id = 'app-1') => ({ params: Promise.resolve({ id }) })

const body = async (res: Response) =>
  (await res.json()) as { error?: string; filled?: string[]; question?: Question }

const writtenQuestions = () =>
  (updateApplication.mock.calls[0][2] as { questions: Question[] }).questions

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  getProfile.mockResolvedValue({ facts: [], standardAnswers: {}, voiceRules: [], gaps: [] })
  runLetterheadFill.mockResolvedValue({})
  updateApplication.mockResolvedValue(undefined)
})

describe('POST .../cover-letter/letterhead — what it refuses', () => {
  it('401s before reading the record or reaching the model', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(req(), ctx())).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runLetterheadFill).not.toHaveBeenCalled()
  })

  it('404s on an application that is not there', async () => {
    getApplication.mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect((await body(res)).error).toBe('not found')
    expect(runLetterheadFill).not.toHaveBeenCalled()
  })

  it('404s on an application with no cover letter on it', async () => {
    getApplication.mockResolvedValue(application({ questions: [formQuestion()] }))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect((await body(res)).error).toBe('no cover letter on this application')
    expect(runLetterheadFill).not.toHaveBeenCalled()
  })

  it('422s before the model when neither document has anything to read', async () => {
    getApplication.mockResolvedValue(application({ jdRaw: '   ' }))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(422)
    expect(await body(res)).toStrictEqual({
      error:
        'there is nothing to fill in from — this application has no posting text and your profile has no facts yet',
      fillFailed: true,
    })
    expect(runLetterheadFill).not.toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('runs on the facts alone when the posting was never captured', async () => {
    getApplication.mockResolvedValue(application({ jdRaw: '' }))
    getProfile.mockResolvedValue({
      facts: [fact()],
      standardAnswers: {},
      voiceRules: [],
      gaps: [],
    })
    await POST(req(), ctx())
    expect(runLetterheadFill).toHaveBeenCalledTimes(1)
  })

  it('422s with the flow’s own message when the fill fails', async () => {
    runLetterheadFill.mockRejectedValue(new FlowOutputError('letterheadFill: nothing came back'))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(422)
    expect(await body(res)).toStrictEqual({
      error: 'letterheadFill: nothing came back',
      fillFailed: true,
    })
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('404s when the letter went while the fill was out', async () => {
    getApplication
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(application({ questions: [formQuestion()] }))
    const res = await POST(req(), ctx())
    expect(res.status).toBe(404)
    expect((await body(res)).error).toBe('no cover letter on this application')
    expect(updateApplication).not.toHaveBeenCalled()
  })
})

describe('POST .../cover-letter/letterhead — the merge', () => {
  it('fills the blanks, keeps what was typed, and says which it filled', async () => {
    getApplication.mockResolvedValue(
      application({ questions: [formQuestion(), letterQuestion({ recipient: 'Ada Wu' })] }),
    )
    runLetterheadFill.mockResolvedValue({
      phone: '(503) 555-0161',
      location: 'Portland, OR',
      recipient: 'Dana Wu',
      companyAddress: '1 Marram Way\nBristol, England',
    })

    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    const out = await body(res)
    // Ordered as the letterhead is, so the sentence the panel builds reads down the block.
    expect(out.filled).toStrictEqual(['phone', 'location', 'companyAddress'])
    expect(out.question?.letter).toStrictEqual({
      name: 'Tom Candidate',
      email: 'tom@x.test',
      phone: '(503) 555-0161',
      location: 'Portland, OR',
      // The typed recipient stands: the fill writes into blanks and never over an answer.
      recipient: 'Ada Wu',
      recipientTitle: '',
      companyAddress: '1 Marram Way\nBristol, England',
    })
  })

  it('writes the whole question list back, with the letter where it stood', async () => {
    runLetterheadFill.mockResolvedValue({ recipient: 'Dana Wu' })
    await POST(req(), ctx())
    expect(updateApplication).toHaveBeenCalledTimes(1)
    const questions = writtenQuestions()
    expect(questions).toHaveLength(2)
    expect(questions[0].q).toBe('Where are you based?')
    expect(questions[1].letter?.recipient).toBe('Dana Wu')
  })

  it('fills nothing when nothing could be sourced, and writes nothing either', async () => {
    const res = await POST(req(), ctx())
    const out = await body(res)
    expect(out.filled).toStrictEqual([])
    // The question comes back as it stands, which is what the panel re-seeds from.
    expect(out.question?.letter?.name).toBe('Tom Candidate')
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('writes nothing when everything it found was already typed', async () => {
    getApplication.mockResolvedValue(
      application({ questions: [formQuestion(), letterQuestion({ recipient: 'Ada Wu' })] }),
    )
    runLetterheadFill.mockResolvedValue({ recipient: 'Dana Wu' })
    const res = await POST(req(), ctx())
    expect((await body(res)).filled).toStrictEqual([])
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('reads the posting the flow is given off the record, truncated', async () => {
    getApplication.mockResolvedValue(application({ jdRaw: 'x'.repeat(7000) }))
    await POST(req(), ctx())
    const passed = runLetterheadFill.mock.calls[0][0] as { jdText: string; parsed: unknown }
    expect(passed.jdText).toHaveLength(6000)
    // The interpretation, not the record's own 'Marram Systems' / 'Senior Backend Engineer'.
    expect(passed.parsed).toStrictEqual(parsedJob())
  })

  it('names the role off the record when the posting was never interpreted', async () => {
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    await POST(req(), ctx())
    const passed = runLetterheadFill.mock.calls[0][0] as { parsed: unknown }
    expect(passed.parsed).toStrictEqual({
      company: 'Marram Systems',
      role: 'Senior Backend Engineer',
    })
  })
})

/**
 * Pass 1: the profile, read deterministically and never through the model. The contact block the
 * candidate filled in once is the first source; their facts are the second; the model is asked
 * only for what neither of those two settled. It is also the half that keeps the phone and the
 * location out of a context window — they are copied, not read.
 */
describe('POST .../cover-letter/letterhead — from the profile first', () => {
  const withContact = (over: Partial<Record<string, string>> = {}) => ({
    facts: [],
    standardAnswers: {},
    voiceRules: [],
    gaps: [],
    contact: { name: '', email: '', phone: '', location: '', ...over },
  })

  it('fills a blank phone from the contact, and never asks the model for it', async () => {
    getProfile.mockResolvedValue(withContact({ phone: '(503) 555-0161' }))
    runLetterheadFill.mockResolvedValue({ recipient: 'Dana Wu' })

    const res = await POST(req(), ctx())
    const out = await body(res)
    expect(out.filled).toStrictEqual(['phone', 'recipient'])
    expect(out.question?.letter?.phone).toBe('(503) 555-0161')
    // The model still ran — the recipient was blank — but the phone was never its to answer.
    expect(runLetterheadFill).toHaveBeenCalledTimes(1)
    expect(writtenQuestions()[1].letter?.phone).toBe('(503) 555-0161')
  })

  it('keeps a typed phone over both the contact and the model', async () => {
    getApplication.mockResolvedValue(
      application({ questions: [formQuestion(), letterQuestion({ phone: '(206) 555-0114' })] }),
    )
    getProfile.mockResolvedValue(withContact({ phone: '(503) 555-0161' }))
    runLetterheadFill.mockResolvedValue({ phone: '(415) 555-0180' })

    const out = await body(await POST(req(), ctx()))
    expect(out.filled).toStrictEqual([])
    expect(out.question?.letter?.phone).toBe('(206) 555-0114')
    expect(updateApplication).not.toHaveBeenCalled()
  })

  // A bank that happens to hold a phone number — which before this was the only way the fill
  // ever saw one, and the reason it so often filled nothing at all.
  const phoneFact = (): Fact => ({
    id: 'f2',
    claim: 'Reachable on 503-555-0161',
    sourceSnippet: 'Portland, OR · 503-555-0161',
    tags: ['contact'],
  })

  it('falls back to the facts for a field the contact leaves blank', async () => {
    // `extractIdentity` is the old accident made deliberate: whatever an ingest happened to
    // write into the bank still counts, it is just no longer the only source.
    getProfile.mockResolvedValue({ ...withContact(), facts: [phoneFact()] })
    runLetterheadFill.mockResolvedValue({})

    const out = await body(await POST(req(), ctx()))
    expect(out.filled).toStrictEqual(['phone'])
    expect(out.question?.letter?.phone).toBe('503-555-0161')
  })

  it('prefers the contact to the facts where both have something', async () => {
    getProfile.mockResolvedValue({
      ...withContact({ phone: '(206) 555-0114' }),
      facts: [phoneFact()],
    })
    runLetterheadFill.mockResolvedValue({})

    const out = await body(await POST(req(), ctx()))
    expect(out.question?.letter?.phone).toBe('(206) 555-0114')
  })

  it('does not call the model when pass 1 left none of its five blank', async () => {
    getApplication.mockResolvedValue(
      application({
        questions: [
          formQuestion(),
          letterQuestion({
            recipient: 'Dana Wu',
            recipientTitle: 'Head of Engineering',
            companyAddress: '1 Marram Way',
          }),
        ],
      }),
    )
    getProfile.mockResolvedValue(withContact({ phone: '(503) 555-0161', location: 'Portland, OR' }))

    const out = await body(await POST(req(), ctx()))
    expect(runLetterheadFill).not.toHaveBeenCalled()
    expect(out.filled).toStrictEqual(['phone', 'location'])
    expect(out.question?.letter?.location).toBe('Portland, OR')
  })

  it('fills from the contact alone when there is no posting and no facts', async () => {
    // The 422 is about having nothing to fill in from, and a contact block naming four fields is
    // something to fill in from. Nothing is left for the model to read, so it is simply not asked.
    getApplication.mockResolvedValue(application({ jdRaw: '   ' }))
    getProfile.mockResolvedValue(withContact({ phone: '(503) 555-0161', location: 'Portland, OR' }))

    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(runLetterheadFill).not.toHaveBeenCalled()
    expect((await body(res)).filled).toStrictEqual(['phone', 'location'])
    expect(writtenQuestions()[1].letter?.location).toBe('Portland, OR')
  })

  it('cuts what the facts say to a letterhead line, as every other writer does', async () => {
    // `extractIdentity` hands back the whole claim, and a claim is a sentence. Every other writer
    // of these fields caps them at 200 and keeps them to one line, so this one does too — a
    // stored letterhead is what the PDF typesets.
    const sprawl = `Portland, OR\n(open to remote across the US, ${'and to relocating for the right team, '.repeat(6)}for the right one)`
    getProfile.mockResolvedValue({
      ...withContact(),
      facts: [{ id: 'f3', claim: sprawl, sourceSnippet: '', tags: ['location'] }],
    })
    runLetterheadFill.mockResolvedValue({})

    const location = (await body(await POST(req(), ctx()))).question?.letter?.location ?? ''
    expect(Array.from(location)).toHaveLength(200)
    expect(location).not.toContain('\n')
    expect(location.startsWith('Portland, OR (open to remote across the US,')).toBe(true)
  })

  it('fills a blank name and email too — the account is not the only place they live', async () => {
    getApplication.mockResolvedValue(
      application({ questions: [formQuestion(), { ...letterQuestion(), letter: undefined }] }),
    )
    getProfile.mockResolvedValue(withContact({ name: 'Tom Candidate', email: 'tom@example.test' }))
    runLetterheadFill.mockResolvedValue({})

    const out = await body(await POST(req(), ctx()))
    expect(out.filled).toStrictEqual(['name', 'email'])
  })
})
