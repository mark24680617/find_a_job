import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  InterviewRound,
  MockDebrief,
  MockSession,
  MockTurn,
  ProcessStage,
  ResearchSource,
} from '@/lib/types'

// A static render reaches everything this section decides before anybody clicks: which state it
// is in, what it is allowed to offer in that state, and what it says. The two mocks are the pair
// every component test here carries — `apiFetch` reaches for the browser's fetch and the signed-in
// user, and importing the Firebase client starts an app.
vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
  ApiError: class ApiError extends Error {},
}))

import { MockSection, Restarted } from '@/components/interviews/MockSection'

type Props = Parameters<typeof MockSection>[0]

const stage: ProcessStage = {
  order: 2,
  name: 'Coding round',
  kind: 'technical',
  format: 'video',
  whatItProbes: 'Working code.',
  tips: [],
  sourceIds: ['s1'],
  confidence: 'community',
}
const sources: ResearchSource[] = [
  {
    id: 's1',
    title: 'My Marram loop',
    url: 'https://www.reddit.com/r/cscareerquestions/comments/abc/',
    host: 'reddit.com',
    kind: 'community',
    snippet: '',
    fetched: true,
  },
]
const session = (over: Partial<MockSession> = {}): MockSession => ({
  mode: 'conversation',
  startedAt: '2026-09-03T09:00:00.000Z',
  questionsAsked: 1,
  status: 'open',
  previousQuestions: [],
  ...over,
})
const turn = (over: Pick<MockTurn, 'role' | 'text'> & Partial<MockTurn>): MockTurn => ({
  at: '2026-09-03T09:00:00.000Z',
  ...over,
})
const round = (over: Partial<InterviewRound> = {}): InterviewRound => ({
  id: 'r1',
  noticeRaw: '',
  roundType: 'behavioral',
  people: [],
  chat: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  ...over,
})

// Two questions in: one the interviewer copied out of a guide, an answer, a follow-up on it,
// another answer, and the next question. A follow-up does not advance the count — six questions
// is what the mock is, not six turns — so the last line here is question two.
const conversation: MockTurn[] = [
  turn({
    role: 'model',
    kind: 'question',
    sourceId: 's1',
    text: 'Walk me through a payment that failed.',
  }),
  turn({ role: 'user', text: 'We were seeing a 3% failure rate on renewals.' }),
  turn({ role: 'model', kind: 'follow-up', text: 'What did you change first?' }),
  turn({ role: 'user', text: 'We added a retry with a cap.' }),
  turn({ role: 'model', kind: 'question', text: 'How would you test that?' }),
]
const open = round({ roundType: 'technical', mock: session({ questionsAsked: 2 }), chat: conversation })

const base: Props = {
  appId: 'app-1',
  round: round(),
  placement: null,
  family: 'general',
  sources: [],
  facts: [],
  profileFailed: false,
  // Read for the first time in the next task, by the debrief's evidence line. It is required on
  // the interface from this commit, so the fixture carries it from this commit.
  company: 'Marram Systems',
  onRound: () => {},
  onFactsChanged: async () => {},
}
const html = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(MockSection, { ...base, ...over }))

describe('MockSection — before a session', () => {
  it('says what a mock round is, and offers one', () => {
    const out = html()
    expect(out).toContain(
      'A mock Behavioral — the interviewer asks one question at a time, up to six, and follows up the way a real one would. End it after any answer; the feedback comes after.',
    )
    expect(out).not.toContain('Your code is read, not run.')
    expect(out).toContain('Start a mock round')
  })

  it('has the log region on screen before there is anything in it', () => {
    // A live region inserted together with its first line is not announced — the reason
    // `Working` stays mounted, and the reason the first question of a mock was going unread:
    // the transcript arrived with it already inside. Empty, the region draws nothing.
    const out = html()
    expect(out).toContain('role="log"')
    expect(out).not.toContain('divide-y divide-line border-y border-line')
  })

  it('names the stage it will interview for, and promises not to run the code', () => {
    // The mode before a session is the client's to work out, the same way the route will:
    // a technical stage for an engineering role is a coding round.
    const out = html({ placement: { stage, of: 4 }, family: 'software engineering' })
    expect(out).toContain('A mock Coding round — the interviewer asks one question at a time')
    expect(out).toContain('Your code is read, not run.')
  })
})

describe('MockSection — an open mock', () => {
  it('draws the conversation as a ledger and names who reported a copied question', () => {
    const out = html({ round: open, sources })
    expect(out).toContain('role="log"')
    expect(out).toContain('Interviewer')
    // The eyebrow itself, not the bare word: the box's sr-only label and its placeholder both
    // read "Your answer", so a test for `You` alone would hold with no candidate turn on screen.
    expect(out).toContain('text-ink-3">You</p>')
    expect(out).toContain('Walk me through a payment that failed.')
    expect(out).toContain('reported by reddit.com')
    expect(out).toContain('href="https://www.reddit.com/r/cscareerquestions/comments/abc/"')
    expect(out).toContain('Question 2 of 6')
  })

  it('says nothing about a source it is not holding', () => {
    const out = html({ round: open })
    expect(out).toContain('Walk me through a payment that failed.')
    expect(out).not.toContain('reported by')
  })

  it('offers the end only once there is an answer to give feedback on', () => {
    const first = round({ mock: session(), chat: [conversation[0]] })
    expect(html({ round: first })).not.toContain('End and get feedback')
    expect(html({ round: first })).toContain('id="mock-answer"')
    expect(html({ round: open })).toContain('End and get feedback')
  })

  it('takes the box away when the interviewer has said its last, leaving the end', () => {
    const closed = round({
      mock: session({ questionsAsked: 6 }),
      chat: [
        ...conversation,
        turn({ role: 'user', text: 'A table test over the retry cap.' }),
        turn({
          role: 'model',
          kind: 'closing',
          text: 'That’s all I had. End the mock for the feedback.',
        }),
      ],
    })
    const out = html({ round: closed })
    expect(out).toContain('End and get feedback')
    expect(out).not.toContain('Send answer')
    expect(out).not.toContain('id="mock-answer"')
  })

  it('offers another try when the interviewer never replied, and says so', () => {
    // The state a turnFailed lands the screen in — and the state a reload finds afterwards,
    // which is why the line is read off the transcript rather than off the failed request.
    const owed = round({ mock: session(), chat: conversation.slice(0, 2) })
    const out = html({ round: owed })
    expect(out).toContain('Try again')
    expect(out).toContain('The interviewer didn’t reply. Your answer is saved — try again.')
    expect(out).not.toContain('id="mock-answer"')
    expect(out).not.toContain('Send answer')
    // A stalled mock still offers the way out of it: starting over is the only one there is.
    expect(out).toContain('Start over')
  })

  it('sets the candidate’s own words in code only in a coding round', () => {
    expect(html({ round: open })).not.toContain('font-mono')
    const coding = round({ mock: session({ mode: 'coding' }), chat: conversation })
    expect(html({ round: coding })).toContain('font-mono')
  })

  it('offers to start over, and says what that costs', () => {
    const out = html({ round: open })
    expect(out).toContain('Start over')
    expect(out).toContain('Discards this conversation.')
    // There is no feedback yet, so nothing here may promise to discard any.
    expect(out).not.toContain('Discards this conversation and its feedback.')
  })

  it('keeps the way out when the interviewer has said its last', () => {
    const closed = round({
      mock: session({ questionsAsked: 6 }),
      chat: [
        ...conversation,
        turn({ role: 'user', text: 'A table test over the retry cap.' }),
        turn({
          role: 'model',
          kind: 'closing',
          text: 'That’s all I had. End the mock for the feedback.',
        }),
      ],
    })
    expect(html({ round: closed })).toContain('Discards this conversation.')
  })
})

describe('MockSection — debriefed', () => {
  const debrief: MockDebrief = {
    overall: 'You were concrete about the retry and vague about the numbers.',
    answers: [
      {
        question: 'Walk me through a payment that failed.',
        landed: ['The retry cap.'],
        vague: [],
        unsupported: [],
      },
    ],
    rehearse: [],
    factsChecked: 3,
  }

  it('collapses the conversation and offers a fresh one', () => {
    const done = round({
      mock: session({ status: 'debriefed', debrief, debriefedAt: '2026-09-03T09:20:00.000Z' }),
      chat: conversation,
    })
    const out = html({ round: done })
    expect(out).toContain('<details')
    expect(out).toContain('The conversation')
    expect(out).toContain('Start over')
    expect(out).toContain('Discards this conversation and its feedback.')
    expect(out).not.toContain('id="mock-answer"')
  })
})

describe('MockSection — the mock was restarted somewhere else', () => {
  it('says what happened, and offers the one thing that can be done about it', () => {
    // The 409 is reached only through a refused request, and this suite makes none — so the row
    // is rendered on its own. It is the whole state: once the session on screen has gone,
    // nothing else here can be written, and a reload is the only honest way on.
    const out = renderToStaticMarkup(createElement(Restarted))
    expect(out).toContain('This mock was restarted in another tab.')
    expect(out).toContain('Reload')
  })
})

describe('MockSection — the debriefed state', () => {
  const debriefed: InterviewRound = {
    id: 'r1',
    noticeRaw: '',
    roundType: 'technical',
    people: [],
    chat: [
      { role: 'model', text: 'Tell me about a migration you led.', kind: 'question', at: '2026-09-03T10:00:00.000Z' },
      { role: 'user', text: 'We moved the fleet over a weekend.', at: '2026-09-03T10:02:00.000Z' },
    ],
    mock: {
      mode: 'conversation',
      startedAt: '2026-09-03T10:00:00.000Z',
      questionsAsked: 1,
      status: 'debriefed',
      previousQuestions: [],
      debriefedAt: '2026-09-03T10:20:00.000Z',
      debrief: {
        overall: 'You gave the shape of the migration but not its numbers.',
        answers: [],
        rehearse: [],
        factsChecked: 1,
      },
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  }

  it('hands the feedback to the debrief, and offers the way back to a fresh mock', () => {
    const html = renderToStaticMarkup(
      createElement(MockSection, {
        appId: 'app-1',
        round: debriefed,
        placement: null,
        family: 'software engineering',
        sources: [],
        facts: [],
        profileFailed: false,
        company: 'Marram Systems',
        onRound: () => {},
        onFactsChanged: async () => {},
      }),
    )
    expect(html).toContain('You gave the shape of the migration but not its numbers.')
    expect(html).toContain('Start over')
    expect(html).toContain('Discards this conversation and its feedback.')
    // One archive and one way back, not two of either: the debrief owns the folded transcript,
    // and the section keeps the single Start over row at its foot.
    expect(html.match(/The conversation/g)).toHaveLength(1)
    expect(html.match(/Start over/g)).toHaveLength(1)
  })
})
