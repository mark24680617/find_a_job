import { describe, it, expect } from 'vitest'
import type { MockDebriefOut, MockTurnOut } from '@/ai/schemas'
import { answeredQuestionTexts, guardDebrief, guardTurn } from '@/lib/mockGuard'
import type { ReportedQuestion } from '@/lib/practice'
import type { Fact, MockTurn } from '@/lib/types'

// The mock's two honesty rules, in code: the interviewer cites a reported question only when it
// actually asked it, and the debrief quotes the candidate only from what they typed. Both sides
// of every comparison are whitespace-normalised — model prose wraps where it likes, and code in
// the answer box has line breaks the needle never had.

const reported: ReportedQuestion[] = [
  {
    sourceId: 's1',
    host: 'reddit.com',
    url: 'https://www.reddit.com/r/cscareerquestions/comments/1/',
    text: 'Tell me about a time you disagreed with your manager',
    firstHand: true,
    stale: false,
    year: '2025',
  },
  {
    sourceId: 's2',
    host: 'glassdoor.com',
    url: 'https://www.glassdoor.com/Interview/2.htm',
    text: 'How would you shard a payments ledger?',
    stale: true,
  },
]

const model = (text: string, kind: MockTurn['kind'], sourceId?: string): MockTurn => ({
  role: 'model',
  text,
  kind,
  ...(sourceId ? { sourceId } : {}),
  at: '2026-09-03T10:00:00.000Z',
})
const said = (text: string): MockTurn => ({ role: 'user', text, at: '2026-09-03T10:01:00.000Z' })

const turn = (over: Partial<MockTurnOut> = {}): MockTurnOut => ({
  say: 'Tell me about a time you disagreed with your manager.',
  sourceId: 's1',
  kind: 'question',
  ...over,
})

describe('guardTurn', () => {
  it('keeps a citation when the interviewer really asked that question, wrapped or not', () => {
    expect(guardTurn(turn(), reported, undefined).sourceId).toBe('s1')
    // The interviewer frames the question before asking it, and the model wraps its prose;
    // neither of those makes it a different question, so the match is a substring after
    // normalising, not an equality.
    const wrapped = turn({
      say: 'To start:\n  Tell me about a time you\n  disagreed with your manager.\n\nTake your time.',
    })
    expect(guardTurn(wrapped, reported, undefined).sourceId).toBe('s1')
  })

  it('drops a citation onto a source that was never handed over', () => {
    expect(guardTurn(turn({ sourceId: 's9' }), reported, undefined).sourceId).toBeNull()
  })

  it('drops a citation when the question was paraphrased rather than asked', () => {
    const paraphrased = turn({ say: 'Tell me about a disagreement you had with a manager.' })
    expect(guardTurn(paraphrased, reported, undefined).sourceId).toBeNull()
  })

  it('keeps the question itself when it drops the citation', () => {
    const guarded = guardTurn(turn({ sourceId: 's9' }), reported, undefined)
    expect(guarded.say).toBe(turn().say)
    expect(guarded.kind).toBe('question')
  })

  it('lets a follow-up follow a question', () => {
    const previous = model('Tell me about a time you disagreed with your manager.', 'question', 's1')
    expect(guardTurn(turn({ kind: 'follow-up', sourceId: null }), reported, previous).kind).toBe('follow-up')
  })

  it('turns a second consecutive follow-up into a question', () => {
    // "Follow up once" is a property of the record, not a request — and it is what keeps the
    // six-question count moving.
    const previous = model('What did that cost you?', 'follow-up')
    expect(guardTurn(turn({ kind: 'follow-up', sourceId: null }), reported, previous).kind).toBe('question')
  })

  it('leaves the first turn of a session alone — there is nothing before it', () => {
    expect(guardTurn(turn({ kind: 'follow-up' }), reported, undefined).kind).toBe('follow-up')
    expect(guardTurn(turn(), reported, undefined).kind).toBe('question')
  })
})

const transcript: MockTurn[] = [
  model('Tell me about a time you disagreed with your manager.', 'question', 's1'),
  said('I pushed back on the migration date.\nWe moved it two weeks and shipped it clean.'),
  model('What did you give up for those two weeks?', 'follow-up'),
  said('The dashboard rewrite. I have led a team of six for three years.'),
  model('How would you shard a payments ledger?', 'question', 's2'),
  said('By customer id, with a lookup table for the hot accounts.'),
  model('What breaks when one customer is 40% of the volume?', 'question'),
]

const facts: Fact[] = [
  { id: 'f1', claim: 'Led a team of six for three years', sourceSnippet: 'Led a team of six', tags: ['leadership'] },
  {
    id: 'f2',
    claim: 'Shipped a payments service handling 12k requests a day',
    sourceSnippet: 'Built and shipped the payments service (12k req/day)',
    tags: ['backend'],
  },
]

const debrief = (over: Partial<MockDebriefOut> = {}): MockDebriefOut => ({
  overall: 'You told the migration story well and stayed general on the sharding.',
  answers: [
    {
      question: 'Tell me about a time you disagreed with your manager.',
      landed: ['The date change was concrete.'],
      vague: ['No number for what the delay cost.'],
      unsupported: [
        { said: 'I pushed back on the migration date. We moved it two weeks', why: 'No fact records that migration or its date.' },
        { said: 'I have shipped payments at three companies.', why: 'The bank holds one payments service, not three.' },
      ],
    },
    { question: 'How would you shard a payments ledger?', landed: [], vague: ['No mention of rebalancing.'], unsupported: [] },
    { question: 'What breaks when one customer is 40% of the volume?', landed: [], vague: [], unsupported: [] },
  ],
  code: { strengths: ['The lookup table is named.'], gaps: ['No test for the hot-account path.'] },
  rehearse: [
    'Led a team of six for three years',
    '  Shipped a payments service handling   12k requests a day  ',
    'Say you have led a team of ten',
  ],
  ...over,
})

describe('guardDebrief', () => {
  it('keeps a sentence the candidate really wrote, even across a line break', () => {
    const out = guardDebrief(debrief(), transcript, facts, 'conversation')
    expect(out.answers[0].unsupported.map((u) => u.said)).toEqual([
      'I pushed back on the migration date. We moved it two weeks',
    ])
  })

  it('drops a sentence the candidate never wrote', () => {
    const out = guardDebrief(debrief(), transcript, facts, 'conversation')
    expect(out.answers[0].unsupported.map((u) => u.why)).not.toContain('The bank holds one payments service, not three.')
  })

  it('drops an empty quote — every text contains one', () => {
    const empty = debrief({
      answers: [{ ...debrief().answers[0], unsupported: [{ said: '   ', why: 'x' }] }],
    })
    expect(guardDebrief(empty, transcript, facts, 'conversation').answers[0].unsupported).toEqual([])
  })

  it('drops a sentence lifted from the interviewer rather than the candidate', () => {
    // The boundary that stops prompt-injected interviewer prose being quoted back as the
    // candidate's own words and offered into their fact bank. The text is in the transcript;
    // it is just not theirs.
    const theirs = debrief({
      answers: [
        {
          ...debrief().answers[0],
          unsupported: [{ said: 'How would you shard a payments ledger?', why: 'x' }],
        },
      ],
    })
    expect(guardDebrief(theirs, transcript, facts, 'conversation').answers[0].unsupported).toEqual([])
  })

  it('drops a sentence stitched out of two separate answers', () => {
    // Every word is the candidate's; the sentence is not. A real answer is submitted whole, so
    // nothing legitimate spans two turns — and this one becomes a claim on the amber.
    const spliced = debrief({
      answers: [
        {
          ...debrief().answers[0],
          unsupported: [{ said: 'shipped it clean. The dashboard rewrite.', why: 'x' }],
        },
      ],
    })
    expect(guardDebrief(spliced, transcript, facts, 'conversation').answers[0].unsupported).toEqual([])
  })

  it('drops a quote longer than a quote is allowed to be', () => {
    // `said` is the one piece of model output on this screen with a path into the fact bank, and
    // an answer can run to 12,000 characters. The cap is `verifyQuotes`'s, for its reason.
    const long = `I ran the migration. ${'x'.repeat(260)}`
    const spoken = [model('What did you run?', 'question'), said(long)]
    const quoting = (text: string) =>
      debrief({ answers: [{ ...debrief().answers[0], unsupported: [{ said: text, why: 'x' }] }] })

    expect(guardDebrief(quoting(long), spoken, facts, 'conversation').answers[0].unsupported).toEqual([])
    // Exactly the cap still passes: it is a cap, not a limit one short of it.
    const at240 = long.slice(0, 240)
    expect(
      guardDebrief(quoting(at240), spoken, facts, 'conversation').answers[0].unsupported,
    ).toHaveLength(1)
  })

  it('replaces a paraphrased heading with the question that was asked', () => {
    // Every other quoted-looking string on this screen is checked against the record. The
    // heading sits above the answer it belongs to, so it is the question, not a memory of it.
    const paraphrased = debrief({
      answers: [
        { ...debrief().answers[0], question: 'Tell me about a disagreement with a manager.' },
        { ...debrief().answers[1], question: 'How do you shard a ledger?' },
      ],
    })
    const out = guardDebrief(paraphrased, transcript, facts, 'conversation')
    expect(out.answers.map((a) => a.question)).toEqual([
      'Tell me about a time you disagreed with your manager.',
      'How would you shard a payments ledger?',
    ])
  })

  it('keeps only rehearsal lines that are one of the candidate’s own claims', () => {
    const out = guardDebrief(debrief(), transcript, facts, 'conversation')
    // Kept as the model wrote them, not rewritten: the filter is the brief's, and the second
    // line differs from f2's claim in whitespace only.
    expect(out.rehearse).toEqual([
      'Led a team of six for three years',
      '  Shipped a payments service handling   12k requests a day  ',
    ])
  })

  it('drops the code block outside a coding round', () => {
    expect(guardDebrief(debrief(), transcript, facts, 'conversation').code).toBeNull()
    expect(guardDebrief(debrief(), transcript, facts, 'design').code).toBeNull()
  })

  it('keeps the code block in a coding round', () => {
    expect(guardDebrief(debrief(), transcript, facts, 'coding').code).toEqual({
      strengths: ['The lookup table is named.'],
      gaps: ['No test for the hot-account path.'],
    })
  })

  it('cuts the entries to the questions the candidate answered', () => {
    // The third question was asked and the mock ended; there is nothing to debrief about it.
    // The follow-up is not a question of its own, or there would be three answered.
    const out = guardDebrief(debrief(), transcript, facts, 'conversation')
    expect(out.answers.map((a) => a.question)).toEqual([
      'Tell me about a time you disagreed with your manager.',
      'How would you shard a payments ledger?',
    ])
  })

  it('leaves an empty answers array empty rather than inventing an entry', () => {
    expect(guardDebrief(debrief({ answers: [] }), transcript, facts, 'conversation').answers).toEqual([])
  })
})

describe('answeredQuestionTexts', () => {
  it('names the questions an answer followed, in the order they were asked', () => {
    expect(answeredQuestionTexts(transcript)).toEqual([
      'Tell me about a time you disagreed with your manager.',
      'How would you shard a payments ledger?',
    ])
    expect(answeredQuestionTexts([])).toEqual([])
  })

  it('counts a question as answered only once a candidate turn follows it', () => {
    expect(answeredQuestionTexts(transcript.slice(0, 1))).toEqual([])
    // question, answer, follow-up, answer: one question, answered — the follow-up is not a
    // question of its own, or there would be two.
    expect(answeredQuestionTexts(transcript.slice(0, 4))).toEqual([
      'Tell me about a time you disagreed with your manager.',
    ])
  })
})
