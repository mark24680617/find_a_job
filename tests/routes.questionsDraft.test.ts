import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, AskHuman, ClarifyAnswer, Fact, ParsedJob, Profile, Question } from '@/lib/types'
import type { AnswerDraftOut, ProfileIngestOut } from '@/ai/schemas'
import { FlowOutputError } from '@/ai/genkit'
import type { AnswerDraftInput } from '@/ai/prompts/answerDraft'

// The handler with everything behind it faked: no Admin SDK, no model call. What is under
// test is the draft contract — what the flow is given, what survives a re-draft, and what
// happens when the question moves underneath a call that takes seconds.

const { requireUser, getApplication, updateApplication, getProfile, setProfile } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
  updateApplication: vi.fn(),
  getProfile: vi.fn(),
  setProfile: vi.fn(),
}))
const { runAnswerDraft, runProfileIngest } = vi.hoisted(() => ({
  runAnswerDraft: vi.fn(),
  runProfileIngest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication, updateApplication, getProfile, setProfile }))
vi.mock('@/ai/flows/answerDraft', () => ({ runAnswerDraft }))
vi.mock('@/ai/flows/profileIngest', () => ({ runProfileIngest }))

import { POST } from '@/app/api/applications/[id]/questions/[idx]/draft/route'

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: 'payments', tags: ['payments'] },
]

const profile: Profile = {
  facts,
  standardAnswers: { work_authorization: 'UK citizen', salary_expectation: 'UNKNOWN' },
  voiceRules: [
    { rule: 'cuts openers, starts with the fact', evidence: 'deleted "I am excited to"', createdAt: '2026-08-01T00:00:00.000Z' },
  ],
  gaps: ['no dates on the 2024 role'],
}

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['remote'],
  gates: [],
  themes: ['payments'],
  scope: 'per-application',
  advisory: '',
}

const question = (over: Partial<Question> = {}): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
  ...over,
})

const other = question({ q: 'Where are you based?', constraints: { type: 'short-text', required: false } })

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Build a ledger.',
  adapter: 'ashby',
  parsed,
  questions: [question(), other],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00.000Z' }],
  createdAt: '2026-08-27T00:00:00.000Z',
  ...over,
})

const out: AnswerDraftOut = {
  text: 'I own a payments service handling 12,000 requests a day.',
  citations: [{ claimSpan: '12,000 requests a day', factId: 'f1' }],
  askHuman: [{ question: 'Why this company?', why: 'no fact covers motivation' }],
}

const post = (body?: unknown) =>
  new Request('https://example.test/api/applications/app-1/questions/0/draft', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const ctx = (id: string, idx: string) => ({ params: Promise.resolve({ id, idx }) })

const patchOf = () => updateApplication.mock.calls[0][2] as Partial<Application>
const written = (i = 0) => (patchOf().questions as Question[])[i]
const flowInput = () => runAnswerDraft.mock.calls[0][0] as AnswerDraftInput

// What the story ingest returns: one atomic fact, numbered from f1 as every ingest is, with
// the candidate's own words as its snippet. The merge is what re-numbers it past f1.
const STORY = 'The billing job double-charged 40 accounts. I wrote the idempotency key that Sunday.'
const ingested: ProfileIngestOut = {
  facts: [
    {
      id: 'f1',
      claim: 'Wrote the idempotency key that stopped a billing job double-charging 40 accounts',
      sourceSnippet: 'I wrote the idempotency key that Sunday.',
      tags: ['billing', 'reliability'],
    },
  ],
  standardAnswers: {},
  gaps: ['no date for the billing incident'],
}

/** The profile as it stands once that story has been merged in — f2, and the gaps untouched. */
const augmented: Profile = {
  ...profile,
  facts: [...facts, { ...ingested.facts[0], id: 'f2' }],
}

/** A fact that landed from somewhere else while the ingest was running. */
const fromAnotherTab: Fact = {
  id: 'f2',
  claim: 'Added from the profile editor in another tab',
  sourceSnippet: 'another tab',
  tags: ['edited'],
}

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  getProfile.mockResolvedValue(profile)
  runAnswerDraft.mockResolvedValue(out)
  runProfileIngest.mockResolvedValue(ingested)
  setProfile.mockResolvedValue(undefined)
})

describe('POST .../questions/[idx]/draft — what it accepts', () => {
  it('401s before reading anything or calling the model', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await POST(post(), ctx('app-1', '0'))).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('400s an index that is not a whole number, without reading the record', async () => {
    for (const idx of ['', 'first', '1.5', '-1', '0x1', ' 1', 'NaN', 'Infinity']) {
      const res = await POST(post(), ctx('app-1', idx))
      expect(res.status, idx).toBe(400)
    }
    expect(getApplication).not.toHaveBeenCalled()
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('404s an application that is not there — or is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    const res = await POST(post(), ctx('nope', '0'))
    expect(res.status).toBe(404)
    expect(getApplication).toHaveBeenCalledWith('user-1', 'nope')
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('400s an index past the end of the questions the form actually has', async () => {
    for (const idx of ['2', '7']) {
      const res = await POST(post(), ctx('app-1', idx))
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('question') })
    }
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('400s when the posting was never interpreted, rather than drafting without the scope', async () => {
    // Rule 4 is judged on parsed.scope. Drafting without it is drafting with a hard rule
    // switched off — and the per-profile answer that names an office is the failure it stops.
    getApplication.mockResolvedValue(application({ parsed: undefined }))
    const res = await POST(post(), ctx('app-1', '0'))
    expect(res.status).toBe(400)
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('400s a humanAnswers body that is not a list of answers', async () => {
    const bad: unknown[] = [
      { humanAnswers: 'Portland' },
      { humanAnswers: [{ why: 'x', answer: 'Portland' }] },
      { humanAnswers: [{ question: '', answer: 'Portland' }] },
      { humanAnswers: [{ question: 'Which office?', answer: 7 }] },
      { humanAnswers: [null] },
    ]
    for (const body of bad) {
      expect((await POST(post(body), ctx('app-1', '0'))).status, JSON.stringify(body)).toBe(400)
    }
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('takes an ask the human left blank — sending the queue back untouched is not an error', async () => {
    // The client holds the whole askHuman queue and posts it back; the ones still blank are
    // the ones still open, which is a state, not a malformed request.
    const asked: AskHuman[] = [{ question: 'Which office?', why: 'not in the profile' }]
    getApplication.mockResolvedValue(application({ questions: [question({ askHuman: asked }), other] }))

    const res = await POST(post({ humanAnswers: [{ question: 'Which office?', why: 'not in the profile' }] }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    expect(flowInput().humanAnswers).toEqual([])
  })

  it('drafts with no body at all — the first draft has nothing to answer yet', async () => {
    for (const body of [undefined, {}, { humanAnswers: [] }]) {
      expect((await POST(post(body), ctx('app-1', '0'))).status).toBe(200)
    }
  })
})

describe('POST .../questions/[idx]/draft — what the flow is given', () => {
  it('hands the flow this question, the posting and the whole profile', async () => {
    await POST(post(), ctx('app-1', '1'))
    expect(flowInput()).toEqual({
      question: other,
      parsed,
      jdText: 'Build a ledger.',
      facts,
      standardAnswers: profile.standardAnswers,
      voiceRules: ['cuts openers, starts with the fact'],
      humanAnswers: [],
      clarifyAnswers: [],
    })
  })

  it('truncates a very long posting before the model ever sees it', async () => {
    const long = 'x'.repeat(6100)
    getApplication.mockResolvedValue(application({ jdRaw: long }))
    await POST(post(), ctx('app-1', '0'))
    expect((flowInput().jdText as string).length).toBe(6000)
  })

  it('merges the posted positioning answers over the stored ones, keyed by id', async () => {
    const stored: ClarifyAnswer[] = [
      { id: 'c1', question: 'Which experience should lead?', answer: ['The old choice'] },
      { id: 'c2', question: 'Address the gap?', answer: ['Head-on'] },
    ]
    getApplication.mockResolvedValue(application({ questions: [question({ clarifyAnswers: stored }), other] }))

    await POST(
      post({ clarifyAnswers: [{ id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] }] }),
      ctx('app-1', '0'),
    )
    expect(flowInput().clarifyAnswers).toEqual([
      { id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] },
      { id: 'c2', question: 'Address the gap?', answer: ['Head-on'] },
    ])
  })

  it('400s a clarifyAnswers body that is not a list of choices', async () => {
    const bad: unknown[] = [
      { clarifyAnswers: 'c1' },
      { clarifyAnswers: [{ question: 'Which?', answer: ['a'] }] },
      { clarifyAnswers: [{ id: 'c1', answer: ['a'] }] },
      { clarifyAnswers: [{ id: 'c1', question: 'Which?', answer: 'a' }] },
      { clarifyAnswers: [{ id: 'c1', question: 'Which?', answer: [7] }] },
      { clarifyAnswers: [null] },
    ]
    for (const body of bad) {
      expect((await POST(post(body), ctx('app-1', '0'))).status, JSON.stringify(body)).toBe(400)
    }
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('sends only the answered asks, with the answers merged onto the stored questions', async () => {
    const asked: AskHuman[] = [
      { question: 'Why this company?', why: 'no fact covers motivation' },
      { question: 'Which office?', why: 'not in the profile' },
    ]
    getApplication.mockResolvedValue(application({ questions: [question({ askHuman: asked, status: 'drafted' }), other] }))

    await POST(post({ humanAnswers: [{ question: 'Which office?', answer: 'Remote, UK.' }] }), ctx('app-1', '0'))
    expect(flowInput().humanAnswers).toEqual([
      { question: 'Which office?', why: 'not in the profile', answer: 'Remote, UK.' },
    ])
  })

  it('keeps the stored reason, not whatever the client sent with the answer', async () => {
    const asked: AskHuman[] = [{ question: 'Which office?', why: 'not in the profile' }]
    getApplication.mockResolvedValue(application({ questions: [question({ askHuman: asked }), other] }))

    await POST(
      post({ humanAnswers: [{ question: 'Which office?', why: 'rewritten by the client', answer: 'Remote.' }] }),
      ctx('app-1', '0'),
    )
    expect(flowInput().humanAnswers[0].why).toBe('not in the profile')
  })

  it('ignores an answer to a question this agent never asked', async () => {
    await POST(post({ humanAnswers: [{ question: 'Something else entirely', answer: 'Sure.' }] }), ctx('app-1', '0'))
    expect(flowInput().humanAnswers).toEqual([])
  })
})

describe('POST .../questions/[idx]/draft — what it writes', () => {
  it('stores the draft and the citations, and marks the question drafted', async () => {
    const res = await POST(post(), ctx('app-1', '0'))
    expect(res.status).toBe(200)

    const [uid, id] = updateApplication.mock.calls[0]
    expect(uid).toBe('user-1')
    expect(id).toBe('app-1')
    expect(written()).toEqual({
      q: question().q,
      constraints: question().constraints,
      clarifyAnswers: [],
      draft: { text: out.text, citations: out.citations },
      askHuman: out.askHuman,
      status: 'drafted',
    } satisfies Question)
  })

  it('persists the merged positioning answers on the question it writes', async () => {
    const stored: ClarifyAnswer[] = [{ id: 'c1', question: 'Which experience should lead?', answer: ['The old choice'] }]
    getApplication.mockResolvedValue(application({ questions: [question({ clarifyAnswers: stored }), other] }))

    await POST(
      post({ clarifyAnswers: [{ id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] }] }),
      ctx('app-1', '0'),
    )
    expect(written().clarifyAnswers).toEqual([
      { id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] },
    ])
  })

  it('keeps a final the human already saved, and moves the status back to drafted', async () => {
    const finalised = question({
      draft: { text: 'the old draft', citations: [] },
      final: 'The words the human actually submitted.',
      status: 'final',
    })
    getApplication.mockResolvedValue(application({ questions: [finalised, other] }))

    await POST(post(), ctx('app-1', '0'))
    expect(written().final).toBe('The words the human actually submitted.')
    expect(written().status).toBe('drafted')
    expect(written().draft).toEqual({ text: out.text, citations: out.citations })
  })

  it('returns the question it wrote under `question`, not the whole application', async () => {
    const res = await POST(post(), ctx('app-1', '0'))
    const body = (await res.json()) as { question: Question; newFacts: number; storyLearned: boolean }
    expect(body.question).toEqual(written())
    expect(body.question).not.toHaveProperty('company')
    // Nothing was told, so nothing was learned — and the UI has to be able to tell.
    expect(body).toMatchObject({ newFacts: 0, storyLearned: false })
  })

  it('leaves the other questions exactly as they were', async () => {
    await POST(post(), ctx('app-1', '1'))
    const questions = patchOf().questions as Question[]
    expect(questions).toHaveLength(2)
    expect(questions[0]).toEqual(question())
    expect(questions[1].status).toBe('drafted')
  })

  it('keeps the answers the human already gave, so a re-draft does not ask twice', async () => {
    const asked: AskHuman[] = [{ question: 'Which office?', why: 'not in the profile' }]
    getApplication.mockResolvedValue(application({ questions: [question({ askHuman: asked }), other] }))

    await POST(post({ humanAnswers: [{ question: 'Which office?', answer: 'Remote, UK.' }] }), ctx('app-1', '0'))
    expect(written().askHuman).toEqual([
      { question: 'Which office?', why: 'not in the profile', answer: 'Remote, UK.' },
      ...out.askHuman,
    ])
  })

  it('drops an ask the human already answered, however the model re-words the need', async () => {
    const asked: AskHuman[] = [{ question: 'Why this company?', why: 'no fact covers motivation' }]
    getApplication.mockResolvedValue(application({ questions: [question({ askHuman: asked }), other] }))

    // The flow re-asks the same question — it saw the answer, and asked anyway.
    await POST(post({ humanAnswers: [{ question: 'Why this company?', answer: 'Their ledger post.' }] }), ctx('app-1', '0'))
    expect(written().askHuman).toEqual([
      { question: 'Why this company?', why: 'no fact covers motivation', answer: 'Their ledger post.' },
    ])
  })

  it('forgets an unanswered ask the new draft no longer needs', async () => {
    const asked: AskHuman[] = [{ question: 'Which office?', why: 'not in the profile' }]
    getApplication.mockResolvedValue(application({ questions: [question({ askHuman: asked }), other] }))

    await POST(post(), ctx('app-1', '0'))
    expect(written().askHuman).toEqual(out.askHuman)
  })
})

describe('POST .../questions/[idx]/draft — when the flow refuses its own output', () => {
  it('422s with the flow’s own message, so the person is told what went wrong', async () => {
    // The message names the count, the limit and the offending span, and it is the only
    // account of the failure there is. Left uncaught, Next turns it into a 500 and the
    // reason never leaves the server.
    const message = 'The draft was still wrong after one correction — over the limit: 118 words against a limit of 100 words'
    runAnswerDraft.mockRejectedValue(new FlowOutputError(message))

    const res = await POST(post(), ctx('app-1', '0'))
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: message, draftFailed: true })
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('lets a failure that is not the flow’s judgment go up as a 500', async () => {
    // A Firestore outage or a bug is not something the person can act on, and dressing it
    // as a draft failure would tell them the model wrote something bad when it never ran.
    runAnswerDraft.mockRejectedValue(new Error('socket hang up'))
    await expect(POST(post(), ctx('app-1', '0'))).rejects.toThrow('socket hang up')
    expect(updateApplication).not.toHaveBeenCalled()
  })
})

describe('POST .../questions/[idx]/draft — when the record moves underneath', () => {
  it('404s without writing when the application is deleted while the model drafts', async () => {
    getApplication.mockResolvedValueOnce(application()).mockResolvedValueOnce(null)
    const res = await POST(post(), ctx('app-1', '0'))
    expect(res.status).toBe(404)
    expect(runAnswerDraft).toHaveBeenCalled()
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('409s rather than writing this answer under a question that has changed', async () => {
    // A re-parse replaces the question list wholesale. Index 0 still exists; it is a
    // different question, and an answer filed under it would be an answer to nothing.
    getApplication
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(application({ questions: [question({ q: 'A different question' }), other] }))

    const res = await POST(post(), ctx('app-1', '0'))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'questions changed while drafting' })
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('409s when the question kept its words but changed the length it asks for', async () => {
    // The quietest way this can go wrong: a re-parse leaves the wording alone and tightens
    // the limit — 250 words down to 100 is an edit real forms make. The draft was written
    // against 250 and counted against 250, so storing it under 100 would leave an over-limit
    // draft that no guard rejected and no error mentioned.
    const loose = question({ constraints: { limit: 250, unit: 'words', type: 'long-text', required: true } })
    const tightened = question({ constraints: { limit: 100, unit: 'words', type: 'long-text', required: true } })
    getApplication
      .mockResolvedValueOnce(application({ questions: [loose, other] }))
      .mockResolvedValueOnce(application({ questions: [tightened, other] }))

    const res = await POST(post(), ctx('app-1', '0'))
    expect(res.status).toBe(409)
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('409s when the unit changed under a limit that did not', async () => {
    const asWords = question({ constraints: { limit: 100, unit: 'words', type: 'long-text', required: true } })
    const asChars = question({ constraints: { limit: 100, unit: 'chars', type: 'long-text', required: true } })
    getApplication
      .mockResolvedValueOnce(application({ questions: [asWords, other] }))
      .mockResolvedValueOnce(application({ questions: [asChars, other] }))

    expect((await POST(post(), ctx('app-1', '0'))).status).toBe(409)
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('409s when the re-parse left fewer questions than there were', async () => {
    getApplication
      .mockResolvedValueOnce(application())
      .mockResolvedValueOnce(application({ questions: [question()] }))

    const res = await POST(post(), ctx('app-1', '1'))
    expect(res.status).toBe(409)
    expect(updateApplication).not.toHaveBeenCalled()
  })

  it('writes onto the record as it is after the call, not the copy it read before', async () => {
    // The human answered an ask while the model was drafting; that answer is on the fresh
    // read, and the write must carry it rather than reverting to the pre-call copy.
    const asked: AskHuman[] = [{ question: 'Which office?', why: 'not in the profile' }]
    getApplication
      .mockResolvedValueOnce(application({ questions: [question({ askHuman: asked }), other] }))
      .mockResolvedValueOnce(
        application({ questions: [question({ askHuman: asked }), question({ q: 'Added while drafting' })] }),
      )

    await POST(post(), ctx('app-1', '0'))
    const questions = patchOf().questions as Question[]
    expect(questions).toHaveLength(2)
    expect(questions[1].q).toBe('Added while drafting')
  })
})

describe('POST .../questions/[idx]/draft — the story behind the answer', () => {
  const withStory = (over: Partial<Question> = {}) =>
    application({ questions: [question(over), other] })

  it('learns the story into the profile BEFORE it drafts, so the new facts are citable', async () => {
    // The ordering is the mechanism. Drafting first would run against the old fact bank, and
    // a citation onto a fact that lands a moment later is a citation the guard rejects.
    await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(setProfile.mock.invocationCallOrder[0]).toBeLessThan(
      runAnswerDraft.mock.invocationCallOrder[0],
    )
    expect(runProfileIngest.mock.invocationCallOrder[0]).toBeLessThan(
      setProfile.mock.invocationCallOrder[0],
    )
  })

  it('runs the story through the ingest as pasted text, with nothing else attached', async () => {
    await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(runProfileIngest).toHaveBeenCalledWith({ pastedText: STORY })
  })

  it('merges it with mergeStory: facts appended and re-numbered, the profile’s gaps kept', async () => {
    await POST(post({ story: STORY }), ctx('app-1', '0'))
    const [uid, saved] = setProfile.mock.calls[0] as [string, Profile]
    expect(uid).toBe('user-1')
    expect(saved.facts.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(saved.facts[1].sourceSnippet).toBe('I wrote the idempotency key that Sunday.')
    // The delta against mergeIngest: two sentences about one project must not replace what
    // the resume established was missing.
    expect(saved.gaps).toEqual(['no dates on the 2024 role'])
    expect(saved.voiceRules).toEqual(profile.voiceRules)
  })

  it('drafts against the profile it just saved, not the one it read first', async () => {
    await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(flowInput().facts).toEqual(augmented.facts)
  })

  it('merges onto the profile as it is AFTER the ingest, so a parallel edit is not clobbered', async () => {
    // The ingest spends around ten seconds in the model. setProfile replaces the whole
    // document, so merging onto the copy read before that window would write the window's
    // edits straight back out — and count newFacts against a length that no longer applies.
    const edited: Profile = { ...profile, facts: [...facts, fromAnotherTab] }
    getProfile.mockResolvedValueOnce(profile).mockResolvedValueOnce(edited)

    const res = await POST(post({ story: STORY }), ctx('app-1', '0'))
    const saved = setProfile.mock.calls[0][1] as Profile
    expect(saved.facts.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(saved.facts[1]).toEqual(fromAnotherTab)
    // The story's fact is numbered past what the other tab added, and the draft sees both.
    expect(saved.facts[2].claim).toBe(ingested.facts[0].claim)
    expect(flowInput().facts).toEqual(saved.facts)
    // Counted off the fresh read: one fact learned, not two.
    await expect(res.json()).resolves.toMatchObject({ newFacts: 1 })
  })

  it('sends the telling itself to the prompt as well as the facts drawn from it', async () => {
    await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(flowInput().story).toBe(STORY)
  })

  it('reports what it learned, counted off the profile it actually stored', async () => {
    const res = await POST(post({ story: STORY }), ctx('app-1', '0'))
    await expect(res.json()).resolves.toMatchObject({ newFacts: 1, storyLearned: true })
  })

  it('keeps the story on the question, so a re-draft and a return visit still have it', async () => {
    await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(written().story).toBe(STORY)
  })

  it('does not learn the same story twice when a re-draft posts it back unchanged', async () => {
    // Every re-draft sends the box's contents. Ingesting them again would fork one story into
    // a second set of near-identical facts, each with its own id, all citable.
    getApplication.mockResolvedValue(withStory({ story: STORY }))
    const res = await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toMatchObject({ newFacts: 0, storyLearned: false })
    // Still told to the model, and still kept — unchanged is not gone.
    expect(flowInput().story).toBe(STORY)
    expect(written().story).toBe(STORY)
  })

  it('re-learns when the person edits what they told it', async () => {
    getApplication.mockResolvedValue(withStory({ story: STORY }))
    await POST(post({ story: `${STORY} It has not recurred since.` }), ctx('app-1', '0'))
    expect(runProfileIngest).toHaveBeenCalledTimes(1)
  })

  it('ignores whitespace-only edits rather than paying for an ingest', async () => {
    getApplication.mockResolvedValue(withStory({ story: STORY }))
    await POST(post({ story: `  ${STORY}\n` }), ctx('app-1', '0'))
    expect(runProfileIngest).not.toHaveBeenCalled()
  })

  it('passes the stored story to the prompt when the client sends none at all', async () => {
    // Answering an askHuman re-drafts without touching the story box; the telling still stands.
    getApplication.mockResolvedValue(withStory({ story: STORY }))
    await POST(post({ humanAnswers: [] }), ctx('app-1', '0'))
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(flowInput().story).toBe(STORY)
    expect(written().story).toBe(STORY)
  })

  it('clears the story when the person empties the box', async () => {
    getApplication.mockResolvedValue(withStory({ story: STORY }))
    await POST(post({ story: '' }), ctx('app-1', '0'))
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(flowInput().story).toBeUndefined()
    expect(written().story).toBeUndefined()
    // What it already learned stays learned — the facts are the candidate's now.
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('never ingests a story that is only whitespace', async () => {
    for (const story of ['', '   ', '\n\t ']) {
      vi.clearAllMocks()
      getApplication.mockResolvedValue(application())
      getProfile.mockResolvedValue(profile)
      runAnswerDraft.mockResolvedValue(out)
      const res = await POST(post({ story }), ctx('app-1', '0'))
      expect(res.status, JSON.stringify(story)).toBe(200)
      expect(runProfileIngest).not.toHaveBeenCalled()
    }
  })

  it('400s a story that is not text, before spending anything', async () => {
    for (const body of [{ story: 7 }, { story: ['a'] }, { story: null }, { story: { text: 'x' } }]) {
      expect((await POST(post(body), ctx('app-1', '0'))).status, JSON.stringify(body)).toBe(400)
    }
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })

  it('still writes the answer when the story could not be learned, and says it wasn’t', async () => {
    // Failing to extract facts from the telling is a failure to LEARN. Refusing to write
    // because of it would lose the person their draft as well as their story.
    runProfileIngest.mockRejectedValue(new FlowOutputError('generateStructured failed after one retry'))

    const res = await POST(post({ story: STORY }), ctx('app-1', '0'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ newFacts: 0, storyLearned: false })
    expect(setProfile).not.toHaveBeenCalled()
    // The draft ran on the un-augmented profile — and still got the telling itself.
    expect(flowInput().facts).toEqual(facts)
    expect(flowInput().story).toBe(STORY)
    expect(written().story).toBe(STORY)
  })

  it('lets a failure that is not the model’s judgment go up as a 500', async () => {
    // A Firestore outage is not "your story could not be learned" — the write it reports may
    // have half-landed, and drafting on top of that is worse than failing loudly.
    setProfile.mockRejectedValue(new Error('socket hang up'))
    await expect(POST(post({ story: STORY }), ctx('app-1', '0'))).rejects.toThrow('socket hang up')
    expect(runAnswerDraft).not.toHaveBeenCalled()
  })
})
