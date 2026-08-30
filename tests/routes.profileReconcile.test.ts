import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Profile } from '@/lib/types'

// Both halves of the reconcile-first ingest, with everything behind them faked: no Admin SDK,
// no model call. The contract under test is the one the panel codes against — and, above all,
// the division of labour between them: reconcile NEVER writes, apply is the only thing that
// does, and it never trusts an id the client sent.

const { requireUser, getProfile, setProfile, runProfileIngest, runReconcileFacts } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    getProfile: vi.fn(),
    setProfile: vi.fn(),
    runProfileIngest: vi.fn(),
    runReconcileFacts: vi.fn(),
  }),
)
vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getProfile, setProfile }))
vi.mock('@/ai/flows/profileIngest', () => ({ runProfileIngest }))
vi.mock('@/ai/flows/reconcileFacts', () => ({ runReconcileFacts }))
// The network is faked; `@/adapters/html` (pure), `@/adapters/types` and `@/ai/genkit` (the
// error classes the routes match on with `instanceof`) are deliberately the real modules.
const { getGuardedText } = vi.hoisted(() => ({ getGuardedText: vi.fn() }))
vi.mock('@/adapters/http', () => ({ getGuardedText }))

import { POST as reconcile } from '@/app/api/profile/reconcile/route'
import { POST as apply } from '@/app/api/profile/apply/route'
import { FetchBlockedError } from '@/adapters/types'
import { FlowOutputError } from '@/ai/genkit'

const stored: Profile = {
  facts: [
    { id: 'f1', claim: 'Owns the payments service', sourceSnippet: 'Owns payments', tags: ['backend'] },
    { id: 'f4', claim: 'Led a migration to Kafka', sourceSnippet: 'Led migration', tags: ['infra'] },
  ],
  standardAnswers: { work_authorization: 'US citizen' },
  voiceRules: [{ rule: 'Lead with the number', evidence: 'moved 12k up', createdAt: '2026-08-01' }],
  gaps: ['no dates'],
}

const extraction = {
  facts: [
    {
      id: 'f1',
      claim: 'Owns the payments service handling 12,000 requests/day',
      sourceSnippet: '12,000 requests/day',
      tags: ['backend'],
    },
  ],
  standardAnswers: { notice_period: 'two weeks' },
  gaps: ['no links'],
}

const modelOut = {
  adds: [{ claim: 'Mentors two juniors', sourceSnippet: 'mentors two', tags: ['leadership'] }],
  updates: [
    {
      id: 'f1',
      claim: 'Owns the payments service handling 12,000 requests/day',
      tags: ['backend', 'entity:Fenwick'],
    },
  ],
  skips: [{ id: 'f4', reason: 'Already stated word for word.' }],
  questions: [],
}

const post = (path: string, body: unknown) =>
  new Request(`https://example.test${path}`, { method: 'POST', body: JSON.stringify(body) })

const toReconcile = (body: unknown) => reconcile(post('/api/profile/reconcile', body))
const toApply = (body: unknown) => apply(post('/api/profile/apply', body))

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getProfile.mockResolvedValue(stored)
  setProfile.mockResolvedValue(undefined)
})

describe('POST /api/profile/reconcile — the first call', () => {
  it('reads the document, reconciles it against the bank, and returns all three pieces', async () => {
    runProfileIngest.mockResolvedValue(extraction)
    runReconcileFacts.mockResolvedValue(modelOut)

    const res = await toReconcile({ pastedText: 'a resume' })
    expect(res.status).toBe(200)

    expect(runProfileIngest).toHaveBeenCalledWith({ pdfBase64: undefined, pastedText: 'a resume' })
    expect(runReconcileFacts).toHaveBeenCalledWith({
      facts: stored.facts,
      extracted: extraction.facts,
      answers: [],
      guidance: undefined,
    })
    const { questions: _q, ...changeset } = modelOut
    void _q
    await expect(res.json()).resolves.toEqual({ extraction, changeset, questions: [] })
  })

  it('writes nothing at all — not the extraction, not the changeset', async () => {
    // The whole point of the route. A write here would be the blind append it replaces.
    runProfileIngest.mockResolvedValue(extraction)
    runReconcileFacts.mockResolvedValue(modelOut)
    await toReconcile({ pastedText: 'a resume' })
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('passes a PDF through, and reads a URL as though it had been pasted', async () => {
    runProfileIngest.mockResolvedValue(extraction)
    runReconcileFacts.mockResolvedValue(modelOut)
    await toReconcile({ pdfBase64: 'JVBERi0=' })
    expect(runProfileIngest).toHaveBeenCalledWith({ pdfBase64: 'JVBERi0=', pastedText: undefined })

    getGuardedText.mockResolvedValue({ status: 200, text: `<p>${'a portfolio page. '.repeat(30)}</p>` })
    await toReconcile({ url: 'https://tom.example/about' })
    const { pastedText } = runProfileIngest.mock.calls[1][0]
    expect(pastedText).toContain('From https://tom.example/about:')
    expect(pastedText).toContain('a portfolio page.')
  })

  it('400s when the body carries no source and no extraction, without calling the model', async () => {
    for (const bad of [{}, { pastedText: '' }, { pdfBase64: 42 }, null]) {
      expect((await toReconcile(bad)).status).toBe(400)
    }
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(runReconcileFacts).not.toHaveBeenCalled()
  })

  it('422s a page it will not read, in the words the profile screen uses', async () => {
    getGuardedText.mockRejectedValue(
      new FetchBlockedError('that address is not reachable — paste the job description text instead'),
    )
    const res = await toReconcile({ url: 'https://tom.example/about' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'that address is not reachable — paste the page’s text into Pasted notes instead',
    })
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('returns an empty changeset rather than reconciling a document with nothing in it', async () => {
    // Reconciling no facts would be asking the model to invent a changeset out of the bank.
    runProfileIngest.mockResolvedValue({ ...extraction, facts: [] })
    const res = await toReconcile({ pastedText: 'a blank page' })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      changeset: { adds: [], updates: [], skips: [] },
      questions: [],
    })
    expect(runReconcileFacts).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('never reports one fact as both revised and already known', async () => {
    // Shown side by side those two rows contradict each other. The model reaches for both when
    // a stored fact gains an entity tag while its claim stays put; the revision is the account
    // with an effect, so it is the one that survives.
    runProfileIngest.mockResolvedValue(extraction)
    runReconcileFacts.mockResolvedValue({
      ...modelOut,
      skips: [
        { id: 'f1', reason: 'Already stated.' },
        { id: 'f4', reason: 'Already stated word for word.' },
        { reason: 'Covered across two facts.' },
      ],
    })
    const res = await toReconcile({ pastedText: 'a resume' })
    const { changeset } = (await res.json()) as { changeset: { skips: { id?: string }[] } }
    expect(changeset.skips.map((s) => s.id)).toEqual(['f4', undefined])
  })

  it('turns a flow that refused its own output into a 422 carrying the reason', async () => {
    runProfileIngest.mockResolvedValue(extraction)
    runReconcileFacts.mockRejectedValue(new FlowOutputError('c1 recommends "ghost"'))
    const res = await toReconcile({ pastedText: 'a resume' })
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'c1 recommends "ghost"' })
  })

  it('hands back the guard 401 untouched, before anything is read', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await toReconcile({ pastedText: 'a resume' })).status).toBe(401)
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(getProfile).not.toHaveBeenCalled()
  })
})

describe('POST /api/profile/reconcile — answering and refining', () => {
  beforeEach(() => {
    runReconcileFacts.mockResolvedValue(modelOut)
  })

  it('skips the extraction when the client hands it back', async () => {
    // The read is the expensive half and the document has not changed; paying for it again on
    // every refinement would make disagreeing with the changeset cost more than accepting it.
    const res = await toReconcile({ extraction })
    expect(res.status).toBe(200)
    expect(runProfileIngest).not.toHaveBeenCalled()
    expect(runReconcileFacts).toHaveBeenCalledWith({
      facts: stored.facts,
      extracted: extraction.facts,
      answers: [],
      guidance: undefined,
    })
    await expect(res.json()).resolves.toMatchObject({ extraction })
  })

  it('carries the candidate’s answers and their own words into the reconcile', async () => {
    const answers = [{ id: 'c1', question: 'Same service?', answer: ['merge'] }]
    await toReconcile({ extraction, answers, guidance: 'f4 is a different migration' })
    expect(runReconcileFacts).toHaveBeenCalledWith({
      facts: stored.facts,
      extracted: extraction.facts,
      answers,
      guidance: 'f4 is a different migration',
    })
  })

  it('drops an answer that is not answer-shaped rather than refusing the whole run', async () => {
    // A malformed hint costs one question re-asked; a 400 costs the reconcile.
    await toReconcile({
      extraction,
      answers: [{ id: 'c1', question: 'Same service?', answer: ['merge'] }, 'nonsense', { id: 7 }],
    })
    expect(runReconcileFacts.mock.calls[0][0].answers).toEqual([
      { id: 'c1', question: 'Same service?', answer: ['merge'] },
    ])
  })

  it('400s an extraction that is not one, rather than reconciling against invented claims', async () => {
    for (const bad of [{ facts: 'no' }, { facts: [{ claim: 'no id' }] }, { extraction: 'a string' }]) {
      expect((await toReconcile({ extraction: bad })).status).toBe(400)
    }
    expect(runReconcileFacts).not.toHaveBeenCalled()
  })

  it('still writes nothing on a repeat call', async () => {
    await toReconcile({ extraction, guidance: 'you merged too much' })
    expect(setProfile).not.toHaveBeenCalled()
  })
})

describe('POST /api/profile/apply', () => {
  const changeset = () => ({
    adds: [{ claim: 'Mentors two juniors', sourceSnippet: 'mentors two', tags: ['leadership'] }],
    updates: [
      {
        id: 'f1',
        claim: 'Owns the payments service handling 12,000 requests/day',
        tags: ['backend', 'entity:Fenwick'],
      },
    ],
    skips: [{ id: 'f4', reason: 'Already stated.' }],
  })

  it('revises the named fact, appends the new one, and reports both counts', async () => {
    const res = await toApply({ changeset: changeset() })
    expect(res.status).toBe(200)

    const expected: Profile = {
      ...stored,
      facts: [
        {
          id: 'f1',
          claim: 'Owns the payments service handling 12,000 requests/day',
          // The evidence is the stored fact's, not the revision's — a revision that rewrote
          // the snippet would be rewriting what the claim is grounded in.
          sourceSnippet: 'Owns payments',
          tags: ['backend', 'entity:Fenwick'],
        },
        stored.facts[1],
        { id: 'f5', claim: 'Mentors two juniors', sourceSnippet: 'mentors two', tags: ['leadership'] },
      ],
    }
    expect(setProfile).toHaveBeenCalledWith('user-1', expected)
    await expect(res.json()).resolves.toEqual({ profile: expected, added: 1, updated: 1 })
  })

  it('numbers adds one past the bank’s highest id, never from f1', async () => {
    // The stored bank runs f1, f4 — an add numbered from the extraction's own f1 would collide
    // with a fact every citation in the product already points at.
    const res = await toApply({
      changeset: {
        adds: [
          { claim: 'One', sourceSnippet: '', tags: [] },
          { claim: 'Two', sourceSnippet: '', tags: [] },
        ],
        updates: [],
        skips: [],
      },
    })
    const { profile } = (await res.json()) as { profile: Profile }
    expect(profile.facts.map((f) => f.id)).toEqual(['f1', 'f4', 'f5', 'f6'])
  })

  it('ignores an id the client put on an add', async () => {
    const res = await toApply({
      changeset: {
        adds: [{ id: 'f1', claim: 'Overwrite me', sourceSnippet: '', tags: [] }],
        updates: [],
        skips: [],
      },
    })
    const { profile } = (await res.json()) as { profile: Profile }
    expect(profile.facts.map((f) => f.id)).toEqual(['f1', 'f4', 'f5'])
    expect(profile.facts[0].claim).toBe('Owns the payments service')
  })

  it('400s an update naming a fact the bank does not hold, and says which', async () => {
    // The panel computed this changeset against the bank as it stood; another tab may have
    // deleted that fact since. Applying it to nothing and reporting "updated 1" would be a lie.
    const res = await toApply({
      changeset: { adds: [], updates: [{ id: 'f9', claim: 'A ghost', tags: [] }], skips: [] },
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('f9') })
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('counts two updates of one fact as one update, last word winning', async () => {
    const res = await toApply({
      changeset: {
        adds: [],
        updates: [
          { id: 'f1', claim: 'First word', tags: [] },
          { id: 'f1', claim: 'Last word', tags: ['backend'] },
        ],
        skips: [],
      },
    })
    const body = (await res.json()) as { profile: Profile; updated: number }
    expect(body.updated).toBe(1)
    expect(body.profile.facts[0]).toMatchObject({ claim: 'Last word', tags: ['backend'] })
  })

  it('leaves everything but the facts exactly as it was', async () => {
    const res = await toApply({ changeset: changeset() })
    const { profile } = (await res.json()) as { profile: Profile }
    expect(profile.standardAnswers).toEqual(stored.standardAnswers)
    expect(profile.voiceRules).toEqual(stored.voiceRules)
    expect(profile.gaps).toEqual(stored.gaps)
  })

  it('applies an all-skips changeset as the no-op it is', async () => {
    const res = await toApply({ changeset: { adds: [], updates: [], skips: changeset().skips } })
    await expect(res.json()).resolves.toEqual({ profile: stored, added: 0, updated: 0 })
  })

  it('400s a body that is not a changeset, without touching the db', async () => {
    for (const bad of [
      null,
      'a string',
      {},
      { changeset: 'no' },
      { changeset: { adds: 'no', updates: [] } },
      { changeset: { adds: [], updates: 'no' } },
      // A tag that is not a string reaches the fact bank as a row the editor cannot render.
      { changeset: { adds: [{ claim: 'c', sourceSnippet: '', tags: [42] }], updates: [] } },
      { changeset: { adds: [], updates: [{ id: 'f1', claim: 'c', tags: 'backend' }] } },
      // An empty claim is a blank row in someone's own record.
      { changeset: { adds: [{ claim: '  ', sourceSnippet: '', tags: [] }], updates: [] } },
      { changeset: { adds: [], updates: [{ id: 'f1', claim: '', tags: [] }] } },
      { changeset: { adds: [], updates: [{ claim: 'no id', tags: [] }] } },
    ]) {
      expect((await toApply(bad)).status).toBe(400)
    }
    expect(setProfile).not.toHaveBeenCalled()
  })

  it('hands back the guard 401 untouched', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await toApply({ changeset: changeset() })).status).toBe(401)
    expect(getProfile).not.toHaveBeenCalled()
    expect(setProfile).not.toHaveBeenCalled()
  })
})
