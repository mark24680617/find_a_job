import { describe, it, expect } from 'vitest'
import {
  AnswerDraftOutSchema,
  ClarifyDraftOutSchema,
  FeedbackDistillOutSchema,
  FormParseOutSchema,
  InterviewInterpretOutSchema,
  JobInterpretOutSchema,
  MockDebriefOutSchema,
  MockTurnOutSchema,
  PrepBriefOutSchema,
  ProfileIngestOutSchema,
  ReconcileOutSchema,
} from '@/ai/schemas'

// Fixtures are what a flow would plausibly get back for the Tom Candidate persona. Each
// schema gets one shape it must accept verbatim and one it must reject — the reject case
// is always a field a model realistically gets wrong (invented enum, dropped key).

/** A fixture minus one required key — what a model does when it just skips a field. */
const without = <T extends object>(obj: T, key: keyof T & string) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))

describe('ProfileIngestOutSchema', () => {
  const valid = {
    facts: [
      {
        id: 'f1',
        claim: 'Tom Candidate shipped a payments service handling 12k requests/day',
        sourceSnippet: 'Built and shipped the payments service (12k req/day)',
        tags: ['backend', 'payments'],
      },
      {
        id: 'f2',
        claim: 'Tom Candidate graduated with a 3.6 GPA',
        sourceSnippet: 'B.S. Computer Science, GPA 3.6',
        tags: ['education'],
      },
    ],
    standardAnswers: { work_authorization: 'UNKNOWN', notice_period: 'two weeks' },
    gaps: ['no employment dates for the 2024 role'],
  }

  it('accepts a fully populated ingest result', () => {
    expect(ProfileIngestOutSchema.parse(valid)).toEqual(valid)
  })

  it('accepts empty facts, answers and gaps', () => {
    expect(ProfileIngestOutSchema.parse({ facts: [], standardAnswers: {}, gaps: [] })).toEqual({
      facts: [],
      standardAnswers: {},
      gaps: [],
    })
  })

  it('rejects a fact without its source snippet', () => {
    const bad = { ...valid, facts: [{ id: 'f1', claim: 'Tom is great', tags: ['soft'] }] }
    expect(ProfileIngestOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a fact id that is not f<n>, and says what f<n> means', () => {
    const bad = { ...valid, facts: [{ ...valid.facts[0], id: 'fact-1' }] }
    const result = ProfileIngestOutSchema.safeParse(bad)
    expect(result.success).toBe(false)
    // The retry is only as good as this message — "Invalid" would tell the model nothing.
    expect(result.error?.issues[0]).toMatchObject({
      path: ['facts', 0, 'id'],
      message: 'must be f<n>, e.g. f1',
    })
  })

  it('rejects a non-string standard answer', () => {
    const bad = { ...valid, standardAnswers: { relocation: true } }
    expect(ProfileIngestOutSchema.safeParse(bad).success).toBe(false)
  })
})

describe('JobInterpretOutSchema', () => {
  const valid = {
    company: 'Northwind',
    role: 'Backend Engineer',
    roleFacts: ['owns the payments service', 'on-call one week in six'],
    gates: [
      {
        requirement: '5+ years of Go',
        met: 'no' as const,
        posture: 'escape-clause' as const,
        note: 'Tom Candidate has 3 years, JD says "or equivalent"',
      },
    ],
    themes: ['ownership', 'reliability'],
    scope: 'per-application' as const,
    advisory: 'Apply: the years gate carries an escape clause.',
  }

  it('accepts a fully populated parse', () => {
    expect(JobInterpretOutSchema.parse(valid)).toEqual(valid)
  })

  it('rejects an invented gate verdict', () => {
    const bad = { ...valid, gates: [{ ...valid.gates[0], met: 'maybe' }] }
    expect(JobInterpretOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an invented posture', () => {
    const bad = { ...valid, gates: [{ ...valid.gates[0], posture: 'implied' }] }
    expect(JobInterpretOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a missing advisory — the empty string is the "no advice" value', () => {
    expect(JobInterpretOutSchema.safeParse(without(valid, 'advisory')).success).toBe(false)
  })
})

describe('FormParseOutSchema', () => {
  const valid = {
    questions: [
      {
        q: 'Why do you want to work at Northwind?',
        constraints: {
          limit: 150,
          unit: 'words' as const,
          type: 'long-text' as const,
          required: true,
        },
      },
      { q: 'Upload your resume', constraints: { type: 'file' as const, required: true } },
    ],
    scope: 'per-application' as const,
    scopeEvidence: 'The form names the team and asks about this role specifically.',
  }

  it('accepts questions with and without a length limit', () => {
    expect(FormParseOutSchema.parse(valid)).toEqual(valid)
  })

  it('rejects an artifact scope outside the enum', () => {
    expect(FormParseOutSchema.safeParse({ ...valid, scope: 'per-team' }).success).toBe(false)
  })

  it('rejects a question with an unknown input type', () => {
    const bad = {
      ...valid,
      questions: [{ q: 'Salary?', constraints: { type: 'number', required: false } }],
    }
    expect(FormParseOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a question missing its required flag', () => {
    const bad = { ...valid, questions: [{ q: 'Salary?', constraints: { type: 'short-text' } }] }
    expect(FormParseOutSchema.safeParse(bad).success).toBe(false)
  })
})

describe('AnswerDraftOutSchema', () => {
  const valid = {
    text:
      'Three years on payments infra, most of it on the service that moved 12k requests a day.',
    citations: [{ claimSpan: 'the service that moved 12k requests a day', factId: 'f1' }],
    askHuman: [
      { question: 'What specifically draws you to Northwind?', why: 'Only Tom knows his motivation.' },
    ],
  }

  it('accepts a cited draft', () => {
    expect(AnswerDraftOutSchema.parse(valid)).toEqual(valid)
  })

  it('accepts a draft with nothing to ask', () => {
    expect(AnswerDraftOutSchema.parse({ ...valid, askHuman: [] }).askHuman).toEqual([])
  })

  it('rejects a citation without a fact id', () => {
    const bad = { ...valid, citations: [{ claimSpan: 'three years on payments' }] }
    expect(AnswerDraftOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a citation whose fact id could not name a fact', () => {
    const bad = { ...valid, citations: [{ ...valid.citations[0], factId: 'fact-1' }] }
    const result = AnswerDraftOutSchema.safeParse(bad)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['citations', 0, 'factId'],
      message: 'must be f<n>, e.g. f1',
    })
  })

  it('rejects an ask-human entry without its reason', () => {
    const bad = { ...valid, askHuman: [{ question: 'Desired salary?' }] }
    expect(AnswerDraftOutSchema.safeParse(bad).success).toBe(false)
  })
})

describe('ClarifyDraftOutSchema', () => {
  const question = {
    id: 'c1',
    question: 'Which experience should lead this answer?',
    why: 'The role rewards payments depth over breadth.',
    options: [
      { label: 'The payments service', value: 'payments' },
      { label: 'The Kafka migration', value: 'kafka' },
    ],
    recommended: 'payments',
    allowMultiple: false,
    allowOther: true,
  }
  const valid = { questions: [question] }

  it('accepts a well-formed round of positioning questions', () => {
    expect(ClarifyDraftOutSchema.parse(valid)).toEqual(valid)
  })

  it('accepts an empty round — the facts already settle the answer', () => {
    expect(ClarifyDraftOutSchema.parse({ questions: [] }).questions).toEqual([])
  })

  it('rejects a fifth question — at most four', () => {
    const bad = { questions: Array.from({ length: 5 }, (_, i) => ({ ...question, id: `c${i + 1}` })) }
    expect(ClarifyDraftOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a question id that is not c<n>, and says what c<n> means', () => {
    const bad = { questions: [{ ...question, id: 'question-1' }] }
    const result = ClarifyDraftOutSchema.safeParse(bad)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['questions', 0, 'id'],
      message: 'must be c<n>, e.g. c1',
    })
  })

  it('rejects a single-option question — one option is not a choice', () => {
    const bad = { questions: [{ ...question, options: [question.options[0]] }] }
    expect(ClarifyDraftOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a fifth option on one question — at most four', () => {
    const bad = {
      questions: [{ ...question, options: Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, value: `v${i}` })) }],
    }
    expect(ClarifyDraftOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an empty question or why — a blank card renders as nothing', () => {
    expect(ClarifyDraftOutSchema.safeParse({ questions: [{ ...question, question: '' }] }).success).toBe(false)
    expect(ClarifyDraftOutSchema.safeParse({ questions: [{ ...question, why: '' }] }).success).toBe(false)
  })

  it('rejects a question missing its allow flags', () => {
    const { allowMultiple: _drop, ...noFlag } = question
    void _drop
    expect(ClarifyDraftOutSchema.safeParse({ questions: [noFlag] }).success).toBe(false)
  })
})

describe('ReconcileOutSchema', () => {
  const valid = {
    adds: [
      {
        claim: 'Mentors two junior engineers',
        sourceSnippet: 'mentors two juniors',
        tags: ['leadership', 'entity:Fenwick'],
      },
    ],
    updates: [
      {
        id: 'f1',
        claim: 'Owns the payments service handling 12,000 requests/day',
        tags: ['backend', 'entity:Fenwick'],
      },
    ],
    skips: [{ id: 'f2', reason: 'Already stated word for word.' }],
    questions: [],
  }

  it('accepts a well-formed changeset', () => {
    expect(ReconcileOutSchema.parse(valid)).toEqual(valid)
  })

  it('accepts an all-skips changeset — the document said nothing new', () => {
    const nothing = { ...valid, adds: [], updates: [] }
    expect(ReconcileOutSchema.parse(nothing)).toEqual(nothing)
  })

  it('accepts a skip with no id — already covered, but not by one particular row', () => {
    const loose = { ...valid, skips: [{ reason: 'The profile covers this across two facts.' }] }
    expect(ReconcileOutSchema.parse(loose)).toEqual(loose)
  })

  it('rejects a skip with no reason — that is the silent drop this step exists to prevent', () => {
    expect(ReconcileOutSchema.safeParse({ ...valid, skips: [{ id: 'f2' }] }).success).toBe(false)
    expect(
      ReconcileOutSchema.safeParse({ ...valid, skips: [{ id: 'f2', reason: '' }] }).success,
    ).toBe(false)
  })

  it('rejects an id an update or a skip made up in the wrong shape', () => {
    const badUpdate = ReconcileOutSchema.safeParse({
      ...valid,
      updates: [{ ...valid.updates[0], id: 'fact-1' }],
    })
    expect(badUpdate.success).toBe(false)
    expect(badUpdate.error?.issues[0]).toMatchObject({
      path: ['updates', 0, 'id'],
      message: 'must be f<n>, e.g. f1',
    })
    expect(
      ReconcileOutSchema.safeParse({ ...valid, skips: [{ id: '1', reason: 'known' }] }).success,
    ).toBe(false)
  })

  it('rejects an add that carries an id — the bank allocates those, not the model', () => {
    const withId = { ...valid, adds: [{ ...valid.adds[0], id: 'f9' }] }
    // Extra keys are stripped rather than thrown on, so what matters is that the id never
    // reaches the caller and cannot become a fact id by accident.
    expect(ReconcileOutSchema.parse(withId).adds[0]).not.toHaveProperty('id')
  })

  it('rejects an empty claim on an add or an update', () => {
    expect(
      ReconcileOutSchema.safeParse({ ...valid, adds: [{ ...valid.adds[0], claim: '' }] }).success,
    ).toBe(false)
    expect(
      ReconcileOutSchema.safeParse({ ...valid, updates: [{ ...valid.updates[0], claim: '' }] })
        .success,
    ).toBe(false)
  })

  it('rejects a fifth question — at most four, exactly as a clarify round is', () => {
    const question = {
      id: 'c1',
      question: 'Is that the same payments service?',
      why: 'One is an update, the other is a second service.',
      options: [
        { label: 'Merge it', value: 'merge' },
        { label: 'Add it', value: 'add' },
      ],
      recommended: 'merge',
      allowMultiple: false,
      allowOther: false,
    }
    expect(ReconcileOutSchema.parse({ ...valid, questions: [question] }).questions).toHaveLength(1)
    const five = Array.from({ length: 5 }, (_, i) => ({ ...question, id: `c${i + 1}` }))
    expect(ReconcileOutSchema.safeParse({ ...valid, questions: five }).success).toBe(false)
  })

  it('rejects a changeset missing one of its three halves', () => {
    for (const key of ['adds', 'updates', 'skips', 'questions'] as const) {
      expect(ReconcileOutSchema.safeParse(without(valid, key)).success).toBe(false)
    }
  })
})

describe('FeedbackDistillOutSchema', () => {
  const valid = {
    rules: [
      {
        rule: 'Never open with "I am passionate about"',
        evidence: 'Tom cut that line from both drafts',
      },
      {
        rule: 'Lead with the number, then the story',
        evidence: 'Tom moved "12k req/day" to the first sentence',
      },
    ],
  }

  it('accepts up to three rules', () => {
    expect(FeedbackDistillOutSchema.parse(valid)).toEqual(valid)
    expect(FeedbackDistillOutSchema.parse({ rules: [] }).rules).toEqual([])
  })

  it('rejects a fourth rule', () => {
    const bad = { rules: [...valid.rules, ...valid.rules] }
    expect(FeedbackDistillOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a rule without evidence', () => {
    expect(FeedbackDistillOutSchema.safeParse({ rules: [{ rule: 'Be terse' }] }).success).toBe(false)
  })
})

describe('InterviewInterpretOutSchema', () => {
  const valid = {
    roundType: 'recruiter-screen' as const,
    datetime: '2026-09-03T10:00:00Z',
    people: ['Dana Reyes'],
    askHuman: [{ question: 'Which timezone is 10am in?', why: 'The notice gives no timezone.' }],
  }

  it('accepts a scheduled round', () => {
    expect(InterviewInterpretOutSchema.parse(valid)).toEqual(valid)
  })

  it('accepts a null datetime when the notice gives no date', () => {
    expect(InterviewInterpretOutSchema.parse({ ...valid, datetime: null }).datetime).toBeNull()
  })

  it('rejects an omitted datetime — unknown must be spelled null', () => {
    expect(InterviewInterpretOutSchema.safeParse(without(valid, 'datetime')).success).toBe(false)
  })

  it('rejects an invented round type', () => {
    expect(InterviewInterpretOutSchema.safeParse({ ...valid, roundType: 'coffee-chat' }).success).toBe(
      false,
    )
  })

  it('accepts the system-design round type the map’s stages already had', () => {
    expect(InterviewInterpretOutSchema.parse({ ...valid, roundType: 'system-design' }).roundType).toBe(
      'system-design',
    )
  })
})

describe('PrepBriefOutSchema', () => {
  const valid = {
    likelyTopics: ['payments reliability', 'on-call practice'],
    // One question lifted from a guide, one the model wrote itself. Both say where they came
    // from, which is what lets the screen put "reported by" on exactly one of them.
    questionsToPrepare: [
      { q: 'How do you test a payment retry?', angle: 'f1 — the payments service', sourceId: 's3' },
      { q: 'Walk me through the payments service', angle: 'lead with the 12k req/day number', sourceId: null },
    ],
    questionsToAsk: ['How is on-call rotated across the team?'],
    factsToRehearse: ['f1', 'f2'],
    redFlags: ['the JD lists two different reporting lines'],
  }

  it('accepts a full brief', () => {
    expect(PrepBriefOutSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a prepared question without an angle', () => {
    const bad = { ...valid, questionsToPrepare: [{ q: 'Tell me about yourself', sourceId: null }] }
    expect(PrepBriefOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an omitted sourceId — a question with no guide behind it has to say so', () => {
    const bad = { ...valid, questionsToPrepare: [{ q: 'Tell me about yourself', angle: 'f1' }] }
    expect(PrepBriefOutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a brief missing a section', () => {
    expect(PrepBriefOutSchema.safeParse(without(valid, 'redFlags')).success).toBe(false)
  })
})

describe('MockTurnOutSchema', () => {
  const valid = {
    say: 'Tell me about a time you disagreed with your manager.',
    sourceId: 's1',
    kind: 'question' as const,
  }

  it('accepts a cited question and an uncited follow-up', () => {
    expect(MockTurnOutSchema.parse(valid)).toEqual(valid)
    const followUp = { ...valid, sourceId: null, kind: 'follow-up' as const }
    expect(MockTurnOutSchema.parse(followUp)).toEqual(followUp)
  })

  it('rejects a turn with nothing to say', () => {
    expect(MockTurnOutSchema.safeParse({ ...valid, say: '' }).success).toBe(false)
  })

  it('rejects the closing kind — the route writes that line, not the model', () => {
    expect(MockTurnOutSchema.safeParse({ ...valid, kind: 'closing' }).success).toBe(false)
  })

  it('rejects an omitted sourceId — uncited must be spelled null', () => {
    expect(MockTurnOutSchema.safeParse(without(valid, 'sourceId')).success).toBe(false)
  })
})

describe('MockDebriefOutSchema', () => {
  const valid = {
    overall: 'You told the migration story well and stayed general on the sharding.',
    answers: [
      {
        question: 'Tell me about a time you disagreed with your manager.',
        landed: ['The date change was concrete.'],
        vague: ['No number for what the delay cost.'],
        unsupported: [{ said: 'We moved it two weeks', why: 'No fact records that migration.' }],
      },
    ],
    code: null,
    rehearse: ['Led a team of six for three years'],
  }

  it('accepts a debrief whose round had no code box', () => {
    expect(MockDebriefOutSchema.parse(valid)).toEqual(valid)
  })

  it('accepts the code block a coding round gets', () => {
    const coding = { ...valid, code: { strengths: ['the names are clear'], gaps: ['no empty-input case'] } }
    expect(MockDebriefOutSchema.parse(coding)).toEqual(coding)
  })

  it('rejects an omitted code — no code block must be spelled null', () => {
    expect(MockDebriefOutSchema.safeParse(without(valid, 'code')).success).toBe(false)
  })

  it('rejects an unsupported sentence with no reason beside it', () => {
    const bad = { ...valid, answers: [{ ...valid.answers[0], unsupported: [{ said: 'We moved it two weeks' }] }] }
    expect(MockDebriefOutSchema.safeParse(bad).success).toBe(false)
  })
})
