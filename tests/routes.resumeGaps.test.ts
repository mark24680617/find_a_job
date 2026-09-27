import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FlowOutputError } from '@/ai/genkit'
import { JUDGE_FALLBACK_GAPS_SYSTEM } from '@/ai/prompts/judgeFallback'
import { NOTHING_TO_COMPARE } from '@/components/resume/copy'
import { LANGUAGE_GATE_SENTENCE } from '@/lib/resume/checkSources'
import { DEPLOYMENT_SPENT_MESSAGE, TOOLS_OFF_MESSAGE, UID_SPENT_MESSAGE } from '@/lib/resume/meter'
import type { Application, Profile, StoredResume } from '@/lib/types'

// The handler with the database, the auth guard, the meter's switch and transaction, both judges
// and the generated O*NET file faked: no Admin SDK, no vendor, no network. The pure gaps layer is
// the real one — the buckets are the thing this route exists to store, and a mocked bucketer
// would test nothing. So is `@/lib/resume/judge` (R50): the JEV-or-Gemini rule is C8's
// `askWithFallback`, reached here through the two mocked judges, so this file tests the route's
// use of it, not a copy of it. C8 puts R6's gate inside `askWithFallback`
// (`deps.jevEnabled ?? jevEnabled()`, which reads `CUTS_MEASURED` and `TYPESAFE_API_KEY`), and the
// route passes no `jevEnabled` until JEV has failed once, so `@/lib/resume/cuts` is mocked with
// `CUTS_MEASURED: true` and the key is stubbed in `beforeEach` — `resetAllMocks` does not clear
// it — as C8's own test does. Without both, JEV is never asked (amended 2026-09-24, R50).
//
// What is under test is the contract around a run that takes seconds: which questions go out and
// under which state, that one judge answers the whole run and is named on the result, that a
// resume replaced mid-run is refused rather than stored against, and that nothing is written on
// any refusal.

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }))
const { getResume, patchResume, getProfile, listApplications } = vi.hoisted(() => ({
  getResume: vi.fn(),
  patchResume: vi.fn(),
  getProfile: vi.fn(),
  listApplications: vi.fn(),
}))
const { takePermit, resumeToolsEnabled } = vi.hoisted(() => ({
  takePermit: vi.fn(),
  resumeToolsEnabled: vi.fn(),
}))
const { askNouls, JevError } = vi.hoisted(() => {
  class JevError extends Error {
    constructor(
      readonly status: number,
      readonly field: string | null,
      message: string,
    ) {
      super(message)
      this.name = 'JevError'
    }
  }
  return { askNouls: vi.fn(), JevError }
})
const { judgeWithGemini } = vi.hoisted(() => ({ judgeWithGemini: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getResume, patchResume, getProfile, listApplications }))
// The real refusal sentences and `permitRefusal` (R49), as the Diagnose route's test loads them;
// only the switch and the transaction are faked. The meter module reaches for the Admin SDK at
// import, so that is stubbed to nothing.
vi.mock('@/lib/firebase/admin', () => ({ adminDb: {}, adminAuth: {} }))
vi.mock('@/lib/resume/meter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resume/meter')>()),
  takePermit,
  resumeToolsEnabled,
}))
// Two questions a request, so three demanded skills split into two — the K-split of §6.2 with
// nothing real depending on what Task A4 measured.
vi.mock('@/ai/jev', () => ({ askNouls, JevError, JEV_MAX_QUESTIONS: 2, JEV_MODEL: 'jev-1.13.0' }))
// `JUDGE_FALLBACK_MODEL` is what C8's `askWithFallback` stamps on a fallback answer (R50).
vi.mock('@/ai/flows/judgeFallback', () => ({ judgeWithGemini, JUDGE_FALLBACK_MODEL: 'gemini-3.8-flash' }))
// R6's gate, opened: C8's `jevEnabled()` reads this and the stubbed key (amended 2026-09-24, R50).
vi.mock('@/lib/resume/cuts', () => ({ CUTS_MEASURED: true }))
// `bulletNouls` and `BULLET_NOUL_IDS` are imported by `@/lib/resume/judge` for `judgeBullets`,
// which this route never calls; they are here so the real module loads against this mock.
vi.mock('@/ai/nouls', () => ({
  BULLET_NOUL_IDS: [],
  bulletNouls: () => ({}),
  skillNoul: (skill: string) => ({
    instructions: `Does the resume evidence hands-on use of ${skill}?`,
    criteria: { true: `hands-on ${skill}`, false: `no ${skill}` },
  }),
}))
// The cut points are Task A4's measurement and stage C's test's business; here a judgement only
// has to become a verdict.
vi.mock('@/lib/resume/verdict', () => ({
  toVerdict: (noul: number | null, judge: string, answer: string | null) =>
    judge === 'jev' ? ((noul ?? 0) >= 0.7 ? 'pass' : 'fail') : answer === 'yes' ? 'pass' : 'fail',
}))
// `ONET_TITLES` is what the real `onetLookup` derives ROLE_FAMILIES from (R11), so the two
// families this file posts must be titled here. Both are in Task A6's twelve.
vi.mock('@/lib/resume/onet', () => ({
  ONET_RELEASE: '30.0',
  ONET_ATTRIBUTION: 'O*NET attribution',
  ONET_ALIASES: { Postgres: 'PostgreSQL' },
  ONET_TITLES: { '15-1252.00': 'Software Developers', '15-1254.00': 'Web Developers' },
  ONET_SKILLS: {
    '15-1252.00': [
      { name: 'PostgreSQL', inDemand: true },
      { name: 'Kubernetes', inDemand: true },
      { name: 'Apache Kafka', inDemand: false },
      { name: 'COBOL', inDemand: false },
    ],
    '15-1254.00': [{ name: 'COBOL', inDemand: false }],
  },
}))

import { POST } from '@/app/api/profile/resumes/[id]/gaps/route'

// Fictional. `text` is what the extractor stores; the state the judge reads is `visibleText`,
// the stored lines minus the ones the page does not render (§8), which for this fixture is the
// same two lines.
const LINES: StoredResume['lines'] = [
  { page: 1, x: 72, y: 720, size: 11, font: 'Helvetica', text: 'Senior Backend Engineer, Marram Systems. Tuned Postgres queries down from 40 seconds to 2.' },
  { page: 1, x: 72, y: 704, size: 11, font: 'Helvetica', text: 'Moved the ledger onto Apache Kafka.' },
]
const RESUME_TEXT = LINES.map((l) => l.text).join('\n')

const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: '2026-09-20T09:00:00.000Z',
  filename: 'resume.pdf',
  bytes: 41_231,
  text: RESUME_TEXT,
  lines: LINES,
  sections: [],
  entries: [],
  bullets: [],
  language: 'en',
  ...over,
})

const profile = (): Profile => ({
  facts: [
    {
      id: 'f1',
      claim: 'Ran the Kubernetes migration for the billing cluster',
      sourceSnippet: 'ran the kubernetes migration',
      tags: ['infrastructure'],
    },
  ],
  standardAnswers: {},
  voiceRules: [],
  gaps: [],
})

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'a posting',
  adapter: 'manual',
  parsed: {
    company: 'Marram Systems',
    role: 'Senior Backend Engineer',
    roleFacts: ['Runs the ledger on Apache Kafka'],
    gates: [
      { requirement: 'Five years of backend experience', met: 'yes', posture: 'silent', note: '' },
    ],
    themes: ['payments'],
    scope: 'per-application',
    advisory: '',
  },
  questions: [],
  status: 'applied',
  timeline: [{ event: 'created', at: '2026-09-01T09:00:00.000Z' }],
  createdAt: '2026-09-01T09:00:00.000Z',
  ...over,
})

const post = (body: unknown = { roleFamily: 'Software Developers', onetSoc: '15-1252.00' }, id = 'current') =>
  POST(
    new Request('https://example.test/api/profile/resumes/current/gaps', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

const written = () => (patchResume.mock.calls[0][2] as { gaps: StoredResume['gaps'] }).gaps

let stored: StoredResume

beforeEach(() => {
  vi.resetAllMocks()
  // R6's gate needs the key as well as CUTS_MEASURED (amended 2026-09-24, R50).
  vi.stubEnv('TYPESAFE_API_KEY', 'test')
  stored = resume()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  resumeToolsEnabled.mockReturnValue(true)
  takePermit.mockResolvedValue('ok')
  getResume.mockImplementation(async () => stored)
  getProfile.mockResolvedValue(profile())
  listApplications.mockResolvedValue([application()])
  patchResume.mockImplementation(async (_uid: string, _id: string, patch: Record<string, unknown>) => {
    stored = { ...stored, ...(patch as Partial<StoredResume>) }
  })
  // PostgreSQL passes, Kubernetes and Apache Kafka do not.
  askNouls.mockImplementation(async (_state: string, questions: Record<string, unknown>) =>
    Object.fromEntries(
      Object.keys(questions).map((id) => [id, { noul: id === 's1' ? 0.93 : 0.08, model: 'jev-1.13.0' }]),
    ),
  )
  judgeWithGemini.mockImplementation(async (_state: string, questions: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(questions).map((id) => [id, id === 's1' ? 'yes' : 'no'])),
  )
})

describe('POST …/resumes/[id]/gaps — the guards', () => {
  it('returns the auth guard verbatim and never reads or judges anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await post()).status).toBe(401)
    expect(getResume).not.toHaveBeenCalled()
    expect(askNouls).not.toHaveBeenCalled()
  })

  it('is a 503 while the kill switch is off, before anything is read', async () => {
    resumeToolsEnabled.mockReturnValue(false)
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: TOOLS_OFF_MESSAGE, // meter.ts's sentence, handed on verbatim (R49)
      disabled: true,
    })
    expect(getResume).not.toHaveBeenCalled()
  })

  it('is a 404 on an id that is not an id, before any read', async () => {
    expect((await post(undefined, '../../etc/passwd')).status).toBe(404)
    expect((await post(undefined, '')).status).toBe(404)
    expect(getResume).not.toHaveBeenCalled()
  })

  it('refuses a role family this build has no occupation for', async () => {
    const res = await post({ roleFamily: 'Vibes Engineer', onetSoc: '15-1252.00' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'confirm a role family from the list before running this',
    })
    expect(getResume).not.toHaveBeenCalled()
  })

  it('refuses a family and a code that do not agree — both travel, and both are checked', async () => {
    expect((await post({ roleFamily: 'Software Developers', onetSoc: '13-1111.00' })).status).toBe(400)
    expect((await post({ roleFamily: 'Software Developers' })).status).toBe(400)
    expect(askNouls).not.toHaveBeenCalled()
  })

  it('is a 404 when there is no resume under this account', async () => {
    getResume.mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(takePermit).not.toHaveBeenCalled()
  })

  it('refuses a resume that is not in English, before the permit and the judge', async () => {
    // R26: the same 400 as Diagnose, with C2's sentence and a flag. The page renders the
    // sentence from `resume.language` before any run; this is the route's own guard.
    stored = resume({ language: 'other' })
    const res = await post()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: LANGUAGE_GATE_SENTENCE, languageGate: true })
    expect(takePermit).not.toHaveBeenCalled()
    expect(askNouls).not.toHaveBeenCalled()
  })

  it('refuses when nothing is demanded with the spec’s empty-state sentence, and stores nothing', async () => {
    // R11: a family in Task A6's twelve whose only O*NET skill is neither In Demand nor in a posting.
    // R35: the 400 carries §6.2's empty state verbatim, so the page shows the spec's words.
    listApplications.mockResolvedValue([])
    const res = await post({ roleFamily: 'Web Developers', onetSoc: '15-1254.00' })
    expect(res.status).toBe(400)
    expect(NOTHING_TO_COMPARE).toBe(
      'Nothing to compare against yet. Save an application, or pick a closer role.',
    )
    expect(await res.json()).toEqual({ error: NOTHING_TO_COMPARE })
    expect(takePermit).not.toHaveBeenCalled()
    expect(patchResume).not.toHaveBeenCalled()
  })

  it('answers 429 with the meter’s refusal for whichever ceiling stopped it, and judges nothing', async () => {
    takePermit.mockResolvedValue('uid-limit')
    const uid = await post()
    expect(uid.status).toBe(429)
    expect(await uid.json()).toEqual({ error: UID_SPENT_MESSAGE, ceiling: 'uid' })

    takePermit.mockResolvedValue('deployment-limit')
    const deployment = await post()
    expect(deployment.status).toBe(429)
    expect(await deployment.json()).toEqual({ error: DEPLOYMENT_SPENT_MESSAGE, ceiling: 'deployment' })
    expect(askNouls).not.toHaveBeenCalled()
    expect(patchResume).not.toHaveBeenCalled()
  })
})

describe('POST …/resumes/[id]/gaps — the run', () => {
  it('sends one Noul per demanded skill against the visible resume, split at the cap', async () => {
    await post()
    expect(takePermit).toHaveBeenCalledWith('user-1', 'gaps', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(askNouls).toHaveBeenCalledTimes(2)
    // COBOL is neither In Demand nor in a saved posting, so it is never asked about.
    expect(Object.keys(askNouls.mock.calls[0][1] as object)).toEqual(['s1', 's2'])
    expect(Object.keys(askNouls.mock.calls[1][1] as object)).toEqual(['s3'])
    // One state, the whole visible resume.
    expect(askNouls.mock.calls[0][0]).toBe(RESUME_TEXT)
    expect(askNouls.mock.calls[1][0]).toBe(RESUME_TEXT)
    expect((askNouls.mock.calls[1][1] as Record<string, { instructions: string }>).s3.instructions)
      .toContain('Apache Kafka')
  })

  it('keeps a line the page does not render out of the state and out of "named in your resume"', async () => {
    // §8: hidden text is excluded from every model input. The route reads the checks' definition of
    // hidden (a size-0 run; set into `text` by hand, which the extractor never does, so the test
    // tells the route's reading from `text`), so neither the judge nor namedInResume sees the line.
    const hidden = { page: 1, x: 72, y: 690, size: 0, hiddenBy: 'size' as const, font: 'Helvetica', text: 'Expert in Kubernetes.' }
    stored = resume({ lines: [...LINES, hidden], text: `${RESUME_TEXT}\n${hidden.text}` })
    await post()
    expect(askNouls.mock.calls[0][0]).toBe(RESUME_TEXT)
    expect(written()?.skills.find((s) => s.name === 'Kubernetes')?.namedInResume).toBe(false)
    // (F2) Nor is a hidden line ever the one the page quotes back as "your resume names it".
    expect(written()?.skills.find((s) => s.name === 'Kubernetes')?.evidence.resume).toBeNull()
  })

  it('stores the buckets, the basis, the judge and the real N, and answers with the document', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(patchResume).toHaveBeenCalledTimes(1)
    expect(patchResume.mock.calls[0].slice(0, 2)).toEqual(['user-1', 'current'])
    expect(written()).toEqual({
      reviewedFrom: '2026-09-20T09:00:00.000Z',
      judge: 'jev',
      ranAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      roleFamily: 'Software Developers',
      postingsUsed: 1,
      onetRelease: '30.0',
      // R37: In-Demand-only skills say inPostings: false; Apache Kafka is named in the resume but
      // not passed, so bucket 3 with namedInResume: true — the page must not call it absent.
      skills: [
        {
          name: 'PostgreSQL',
          bucket: 1,
          inPostings: false,
          namedInResume: true,
          judgement: { bulletId: '', questionId: 's1', noul: 0.93, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' },
          // (F2, acceptance-6) What each flag matched, so the page can cite it.
          evidence: { posting: null, resume: LINES[0].text, bank: null },
        },
        {
          name: 'Kubernetes',
          bucket: 2,
          inPostings: false,
          namedInResume: false,
          judgement: { bulletId: '', questionId: 's2', noul: 0.08, verdict: 'fail', model: 'jev-1.13.0', judge: 'jev' },
          evidence: { posting: null, resume: null, bank: 'Ran the Kubernetes migration for the billing cluster' },
        },
        {
          name: 'Apache Kafka',
          bucket: 3,
          inPostings: true,
          namedInResume: true,
          judgement: { bulletId: '', questionId: 's3', noul: 0.08, verdict: 'fail', model: 'jev-1.13.0', judge: 'jev' },
          evidence: { posting: 'Runs the ledger on Apache Kafka', resume: LINES[1].text, bank: null },
        },
      ],
    })
    expect(await res.json()).toEqual(stored)
  })

  it('stores the canonical title, not the spelling that arrived', async () => {
    await post({ roleFamily: 'software developers', onetSoc: '15-1252.00' })
    expect(written()?.roleFamily).toBe('Software Developers')
  })
})

describe('POST …/resumes/[id]/gaps — which judge answered', () => {
  it('falls back to Gemini for every skill when JEV is down, and says so on the result', async () => {
    askNouls.mockRejectedValue(new JevError(429, null, 'rate limited'))
    const res = await post()
    expect(res.status).toBe(200)
    // Both batches re-asked, so one judge answered the whole run — a mixed run has nowhere to
    // live under a single `judge` stamp.
    expect(judgeWithGemini).toHaveBeenCalledTimes(2)
    // R34: the Gaps variant of the fallback prompt, because the state is the whole resume.
    expect(judgeWithGemini.mock.calls[0][3]).toBe(JUDGE_FALLBACK_GAPS_SYSTEM)
    expect(written()?.judge).toBe('gemini')
    expect(written()?.skills[0].judgement).toEqual({
      bulletId: '',
      questionId: 's1',
      noul: null,
      verdict: 'pass',
      model: 'gemini-3.8-flash',
      judge: 'gemini',
    })
  })

  it('re-asks the batches JEV already answered when it falls over part-way, so one judge answers', async () => {
    askNouls
      .mockImplementationOnce(async (_state: string, questions: Record<string, unknown>) =>
        Object.fromEntries(Object.keys(questions).map((id) => [id, { noul: 0.93, model: 'jev-1.13.0' }])),
      )
      .mockRejectedValue(new JevError(503, null, 'unavailable'))
    await post()
    // Batch 2 fell back, then batch 1 was asked again of the fallback. JEV is not asked again.
    expect(askNouls).toHaveBeenCalledTimes(2)
    expect(judgeWithGemini).toHaveBeenCalledTimes(2)
    expect(written()?.judge).toBe('gemini')
    expect(written()?.skills.every((s) => s.judgement?.judge === 'gemini')).toBe(true)
  })

  it('is a 422 when the fallback refuses part-way, and nothing half-judged is stored', async () => {
    // R50: C6's schema pins every question id, so a fallback that leaves one out is a
    // FlowOutputError, never a silent gap to read as null.
    askNouls.mockRejectedValue(new JevError(401, null, 'unauthorized'))
    judgeWithGemini
      .mockImplementationOnce(async (_state: string, questions: Record<string, unknown>) =>
        Object.fromEntries(Object.keys(questions).map((id) => [id, 'yes'])),
      )
      .mockRejectedValue(new FlowOutputError('generateStructured failed after one retry'))
    const res = await post()
    expect(res.status).toBe(422)
    expect((await res.json()).gapsFailed).toBe(true)
    expect(patchResume).not.toHaveBeenCalled()
  })

  it('refuses a 422 rather than masking our own bad question as a Gemini answer', async () => {
    askNouls.mockRejectedValue(new JevError(422, 'criteria.true', 'criteria.true is required'))
    const res = await post()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'the judge refused a question (criteria.true)',
      gapsFailed: true,
    })
    expect(judgeWithGemini).not.toHaveBeenCalled()
    expect(patchResume).not.toHaveBeenCalled()
  })

  it('is a 422 when the fallback judge cannot answer either, and nothing is stored', async () => {
    askNouls.mockRejectedValue(new JevError(529, null, 'overloaded'))
    judgeWithGemini.mockRejectedValue(new FlowOutputError('generateStructured failed after one retry'))
    const res = await post()
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'generateStructured failed after one retry',
      gapsFailed: true,
    })
    expect(patchResume).not.toHaveBeenCalled()
  })

  it('does not swallow anything that is not a judge failure', async () => {
    askNouls.mockRejectedValue(new Error('firestore unavailable'))
    await expect(post()).rejects.toThrow(/firestore unavailable/)
  })
})

describe('POST …/resumes/[id]/gaps — when the ground moves', () => {
  it('refuses to store a run whose resume was replaced while it was out', async () => {
    getResume.mockReset()
    getResume
      .mockResolvedValueOnce(resume())
      .mockResolvedValue(resume({ addedAt: '2026-09-21T11:00:00.000Z' }))
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'the resume was replaced while this ran — run it again',
      basisMoved: true,
    })
    expect(patchResume).not.toHaveBeenCalled()
  })

  it('is a 404 when the resume is deleted while the judge is out', async () => {
    getResume.mockReset()
    getResume.mockResolvedValueOnce(resume()).mockResolvedValue(null)
    expect((await post()).status).toBe(404)
    expect(patchResume).not.toHaveBeenCalled()
  })
})
