import { describe, it, expect } from 'vitest'
import { countUnits } from '@/lib/countText'
import type {
  AppStatus,
  Application,
  ArtifactScope,
  GatePosture,
  InterviewRound,
  Profile,
  RoundType,
} from '@/lib/types'

// These fixtures are the assertion: they only compile if the domain types accept the
// shapes the rest of the app builds. `npm run build` is the gate; the expects below just
// keep the file honest as a test.

const APP_STATUSES: AppStatus[] = ['draft', 'applied', 'interviewing', 'offer', 'rejected']
const GATE_POSTURES: GatePosture[] = ['escape-clause', 'silent', 'explicit']
const ARTIFACT_SCOPES: ArtifactScope[] = ['per-application', 'per-profile', 'unknown']
const ROUND_TYPES: RoundType[] = [
  'recruiter-screen',
  'technical',
  'system-design',
  'behavioral',
  'panel',
  'onsite',
  'take-home',
  'other',
]

// Exhaustive over AppStatus: adding a status without handling it here fails to compile.
function statusLabel(status: AppStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'applied':
      return 'Applied'
    case 'interviewing':
      return 'Interviewing'
    case 'offer':
      return 'Offer'
    case 'rejected':
      return 'Rejected'
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

const profile: Profile = {
  facts: [
    {
      id: 'f1',
      claim: 'Shipped LuqLabs to 4k weekly users',
      sourceSnippet: 'portfolio.md line 12',
      tags: ['product', 'metrics'],
    },
  ],
  standardAnswers: { workAuthorization: 'UNKNOWN' },
  voiceRules: [{ rule: 'No "passionate"', evidence: 'resume.txt', createdAt: '2026-08-27T00:00:00Z' }],
  gaps: ['desired compensation'],
}

const application: Application = {
  id: 'app1',
  company: 'Acme',
  role: 'Product Engineer',
  jdRaw: 'We are hiring...',
  sourceUrl: 'https://jobs.example.test/acme/pe',
  adapter: 'greenhouse',
  parsed: {
    company: 'Acme',
    role: 'Product Engineer',
    roleFacts: ['ships to production weekly'],
    gates: [{ requirement: '5 years experience', met: 'no', posture: 'explicit', note: 'has 3' }],
    themes: ['ownership'],
    scope: 'per-application',
    advisory: 'Apply anyway; the gate is soft.',
  },
  questions: [
    {
      q: 'Why this company?',
      constraints: { limit: 150, unit: 'words', type: 'long-text', required: true },
      draft: { text: 'Because...', citations: [{ claimSpan: 'Because', factId: 'f1' }] },
      askHuman: [{ question: 'What draws you to Acme?', why: 'only Mark knows' }],
      status: 'drafted',
    },
    {
      q: 'Resume',
      constraints: { type: 'file', required: true },
      askHuman: [],
      status: 'pending',
    },
  ],
  status: 'applied',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00Z' }],
  createdAt: '2026-08-27T00:00:00Z',
}

const round: InterviewRound = {
  id: 'r1',
  noticeRaw: 'Your screen is Thursday at 10.',
  roundType: 'recruiter-screen',
  datetime: '2026-09-03T10:00:00Z',
  people: ['Dana Reyes'],
  prepBrief: {
    likelyTopics: ['motivation'],
    questionsToPrepare: [{ q: 'Walk me through your resume', angle: 'lead with LuqLabs' }],
    questionsToAsk: ['How is the team structured?'],
    factsToRehearse: ['f1'],
    redFlags: ['role scope shifted twice in the JD'],
  },
  chat: [
    { role: 'model', text: 'Tell me about yourself.', at: '2026-08-27T09:00:00.000Z' },
    { role: 'user', text: 'I build products end to end.', at: '2026-08-27T09:01:30.000Z' },
  ],
  createdAt: '2026-08-27T00:00:00Z',
}

// A take-home round, which is a different animal: a deadline instead of a start time, a brief
// the candidate added, a plan drawn from it — and no mock session and no transcript, because a
// take-home is not practised. This fixture is the assertion for the five shapes this task adds;
// it only compiles if Assignment, Quoted, Cited, TakeHomeDigest and TakeHomeGuide say what the
// spec says they say. Every quote in the guide is really a span of the assignment's text, so
// the fixture is also a legal record and not merely a legal type.
const takeHomeRound: InterviewRound = {
  id: 'r2',
  noticeRaw: 'Please complete the attached exercise by Friday 12 September.',
  roundType: 'take-home',
  datetime: '2026-09-12T23:59:00+01:00',
  people: [],
  chat: [],
  assignment: {
    text:
      'Build a small service that reconciles two ledgers. Please spend no more than four hours ' +
      'on it; we read the README first. Hand in a repository and a README.',
    source: 'pdf',
    addedAt: '2026-09-06T09:00:00.000Z',
    cut: false,
  },
  takeHome: {
    brief: {
      task: 'Reconcile two ledgers and hand in a repository with a README.',
      timeLimit: { text: 'Four hours, self-timed.', quote: 'Please spend no more than four hours' },
      deliverables: [{ text: 'A repository and a README.', quote: 'Hand in a repository and a README' }],
      constraints: [{ text: 'Four hours, self-timed.', quote: 'Please spend no more than four hours' }],
      evaluation: [{ text: 'The README is read first.', quote: 'we read the README first' }],
    },
    reported: {
      tasks: [{ text: 'Others were given the same ledger exercise.', sourceIds: ['s1'] }],
      evaluation: [{ text: 'Reviewers read the tests first.', sourceIds: ['s1', 's2'] }],
      pitfalls: [{ text: 'People say they over-built it.', sourceIds: ['s2'] }],
      time: [{ text: 'Most report spending a day on it.', sourceIds: ['s1'] }],
    },
    plan: [
      { step: 'Read the brief and list what has to be handed in.', budget: '15 minutes' },
      // No budget on this one: budget is optional, and a plan whose every step carried one
      // would stop proving that.
      { step: 'Write the README last, from what the service actually does.' },
    ],
    askRecruiter: ['Is a partial submission reviewed?'],
    caveats: ['Two write-ups, both from 2024.'],
    sources: [
      {
        id: 's1',
        title: 'My Acme take-home',
        url: 'https://www.reddit.com/r/cscareerquestions/comments/abc/',
        host: 'reddit.com',
        kind: 'community',
        snippet: '',
        publishedAt: '2024-05-01T00:00:00.000Z',
        fetched: true,
      },
      {
        id: 's2',
        title: 'What Acme looks for',
        url: 'https://news.ycombinator.com/item?id=1',
        host: 'news.ycombinator.com',
        kind: 'community',
        snippet: '',
        fetched: true,
      },
    ],
    guides: [
      {
        sourceId: 's1',
        takeaways: ['They read the README before the code.'],
        quotes: ['we read the README first'],
        stale: false,
        firstHand: true,
      },
    ],
    grounded: true,
    plannedFrom: '2026-09-06T09:00:00.000Z',
    plannedAt: '2026-09-06T09:30:00.000Z',
  },
  createdAt: '2026-09-05T00:00:00.000Z',
}

describe('domain types', () => {
  it('enumerates every union member', () => {
    expect(APP_STATUSES).toHaveLength(5)
    expect(GATE_POSTURES).toHaveLength(3)
    expect(ARTIFACT_SCOPES).toHaveLength(3)
    expect(ROUND_TYPES).toHaveLength(8)
  })

  it('narrows AppStatus exhaustively', () => {
    expect(APP_STATUSES.map(statusLabel)).toEqual([
      'Draft',
      'Applied',
      'Interviewing',
      'Offer',
      'Rejected',
    ])
  })

  it('builds a fully populated application', () => {
    expect(application.parsed?.gates[0].met).toBe('no')
    expect(application.questions[0].draft?.citations[0].factId).toBe(profile.facts[0].id)
    // A file question carries no limit — countUnits is only reachable for text questions.
    expect(application.questions[1].constraints.limit).toBeUndefined()
  })

  it('counts a draft against its own limit', () => {
    const { constraints, draft } = application.questions[0]
    expect(countUnits(draft!.text, constraints.unit ?? 'chars')).toBeLessThan(constraints.limit!)
  })

  it('builds a fully populated interview round', () => {
    expect(round.chat.map((m) => m.role)).toEqual(['model', 'user'])
    expect(round.prepBrief?.questionsToPrepare[0].angle).toContain('LuqLabs')
  })

  it('builds a take-home round: the brief that was added and the plan drawn from it', () => {
    expect(takeHomeRound.assignment?.source).toBe('pdf')
    // The plan is pinned to the brief it was drawn from. A brief added after it makes the plan
    // stale, and that comparison is the whole reason `plannedFrom` is a stored field.
    expect(takeHomeRound.takeHome?.plannedFrom).toBe(takeHomeRound.assignment?.addedAt)
    expect(takeHomeRound.takeHome?.brief.deliverables[0].quote).toBe(
      'Hand in a repository and a README',
    )
    // Not practised: a take-home round never has a session, and its transcript stays empty.
    expect(takeHomeRound.mock).toBeUndefined()
    expect(takeHomeRound.chat).toEqual([])
  })
})
