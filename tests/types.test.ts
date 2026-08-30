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
  'behavioral',
  'panel',
  'onsite',
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
    { role: 'model', text: 'Tell me about yourself.' },
    { role: 'user', text: 'I build products end to end.' },
  ],
  createdAt: '2026-08-27T00:00:00Z',
}

describe('domain types', () => {
  it('enumerates every union member', () => {
    expect(APP_STATUSES).toHaveLength(5)
    expect(GATE_POSTURES).toHaveLength(3)
    expect(ARTIFACT_SCOPES).toHaveLength(3)
    expect(ROUND_TYPES).toHaveLength(6)
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
})
