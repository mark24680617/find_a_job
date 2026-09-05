import { describe, it, expect } from 'vitest'
import { buildMockDebriefPrompt, MOCK_DEBRIEF_SYSTEM } from '@/ai/prompts/mockDebrief'
import {
  buildMockTurnPrompt,
  describeStage,
  transcriptText,
  MOCK_TURN_SYSTEM,
} from '@/ai/prompts/mockTurn'
import { summarizeStage } from '@/ai/prompts/prepBrief'
import type { MockTurn, ProcessMap } from '@/lib/types'

// Both system texts are the design spec's, word for word. The first is what keeps the
// interviewer from answering its own question, coaching mid-round, or saying anything about
// the candidate that is not one of their facts; the second is what makes the debrief quote
// the candidate rather than paraphrase them, and ends on the sentence that is the whole
// product ("It does not script lies"). A paraphrase of either would quietly change what the
// model does, so verbatim copies live here and the build fails if a prompt drifts from one.

const TURN_VERBATIM = `You are the interviewer for one stage of one company's loop, running a mock for the candidate.
Ask one thing at a time. Prefer the questions people report being asked at this company when
one fits this stage — ask it word for word and give its sourceId; otherwise ask your own, with
sourceId null. Do not ask a question asked in an earlier session. After an answer, either
follow up once (kind "follow-up") the way a real interviewer would — for the decision, the
number, the date, what they decided against — or move to the next question (kind "question").
Never answer your own question, never evaluate or coach during the mock, and never state
anything about the candidate that is not one of their facts; you may quote a fact back to them
to probe it. When questions asked so far reaches 6, ask nothing further; the mock ends there.
Mode coding: set one practical, multi-part problem of the kind this stage is reported to use,
say any language is fine, and ask for working code plus the assumptions made; a follow-up adds
a constraint. Mode design: set one design prompt and ask for the components, the data flow and
the trade-offs, in text; a follow-up probes a failure mode. Mode conversation: ask, then probe.
Say only what an interviewer would say out loud.`

const DEBRIEF_VERBATIM = `You debrief a mock interview for the candidate who just gave it. Write for them, plainly.
overall: two or three sentences on how the round went, tied to what this stage probes.
answers: one entry per question the candidate answered — a turn labelled question that a
candidate turn follows — in order; a question left unanswered when the mock ended is not an
entry; what was said in answer to a follow-up belongs to the entry of the question it
followed. landed: what in the answer would have worked for this interviewer, specific to what
they said. vague: where the answer stayed general — a claim without a number, a date, a
decision, or a result — and what would have made it concrete. unsupported: every sentence in
which the candidate stated something about their own experience, skills or results that is not
among their facts. Quote the sentence exactly as they wrote it in \`said\`, and in \`why\` say what
fact would need to exist for it to be citable. The facts may be empty; then every such sentence
is unsupported. Do not decide whether it is true — only they know.
code, in mode coding only: strengths and gaps of the code as written — structure, edge cases,
naming, whether the stated assumptions hold. You read it; you did not run it. Say nothing
about whether it runs. Otherwise null.
rehearse: the candidate's facts, quoted verbatim, that this round most needs them to have on
the tip of their tongue.
Nothing here is written for the candidate to recite. It does not script lies.`

const map: ProcessMap = {
  stages: [
    { order: 1, name: 'Recruiter screen', kind: 'recruiter-screen', format: 'call', duration: '30 min', whatItProbes: 'Fit and motivation.', tips: ['Be brief.'], sourceIds: ['s1'], confidence: 'community' },
    { order: 2, name: 'Coding round', kind: 'technical', format: 'video', duration: '60 min', whatItProbes: 'Practical coding.', tips: ['Say your assumptions out loud.'], sourceIds: ['s1'], confidence: 'community' },
    { order: 3, name: 'Hiring manager', kind: 'behavioral', format: 'video', whatItProbes: 'Ownership.', tips: [], sourceIds: [], confidence: 'inferred' },
  ],
  takeHome: { present: 'no', description: '', tips: [], sourceIds: [] },
  sources: [{ id: 's1', title: 'Thread', url: 'https://www.reddit.com/r/x/1', host: 'reddit.com', kind: 'community', snippet: '', fetched: true }],
  guides: [{ sourceId: 's1', takeaways: [], questionsReported: ['Walk me through the ledger rewrite'], quotes: [], stale: false, firstHand: true }],
  askRecruiter: [],
  caveats: [],
  grounded: true,
  researchedAt: '2026-09-03T00:00:00.000Z',
}

const AT = '2026-09-03T10:00:00.000Z'

const transcript: MockTurn[] = [
  { role: 'model', text: 'Walk me through the ledger rewrite.', kind: 'question', sourceId: 's1', at: AT },
  { role: 'user', text: 'I led it over two quarters.', at: AT },
  { role: 'model', text: 'What did you decide against?', kind: 'follow-up', at: AT },
  { role: 'user', text: 'A dual-write. Too much drift.', at: AT },
  { role: 'model', text: 'That’s all I had. End the mock for the feedback.', kind: 'closing', at: AT },
]

describe('system texts', () => {
  it('are the spec’s, verbatim', () => {
    expect(MOCK_TURN_SYSTEM).toBe(TURN_VERBATIM)
    expect(MOCK_DEBRIEF_SYSTEM).toBe(DEBRIEF_VERBATIM)
  })

  it('are the same text whatever the input is', () => {
    const a = buildMockTurnPrompt({ jobSummary: '', stageSummary: '', reportedSummary: '', factsSummary: '', mode: 'coding', questionsAsked: 0, previousQuestions: [], transcript: [] })
    const b = buildMockTurnPrompt({ jobSummary: 'x', stageSummary: 'y', reportedSummary: 'z', factsSummary: 'f', mode: 'design', questionsAsked: 5, previousQuestions: ['q'], transcript })
    expect(a.system).toBe(b.system)
    expect(buildMockDebriefPrompt({ jobSummary: '', stageSummary: '', mode: 'coding', factsSummary: '', transcript: [] }).system).toBe(MOCK_DEBRIEF_SYSTEM)
  })
})

describe('describeStage', () => {
  it('summarises the stage the session started against', () => {
    const line = describeStage('technical', { stageOrder: 2, researchedAt: map.researchedAt }, map)
    expect(line).toBe(summarizeStage({ stage: map.stages[1], of: 3 }))
    expect(line).toContain('Stage 2 of 3')
  })

  it('says a round is not on the loop when the session recorded a map but no stage', () => {
    expect(describeStage('panel', { researchedAt: map.researchedAt }, map)).toBe(
      'Round type: panel — not placed on the reported loop',
    )
  })

  it('says the loop moved when the map was re-researched under the session', () => {
    expect(describeStage('technical', { stageOrder: 2, researchedAt: '2026-08-01T00:00:00.000Z' }, map)).toBe(
      'Round type: technical — the loop was re-researched during this mock',
    )
  })

  it('says there is no research when the session recorded none and there is still none', () => {
    expect(describeStage('behavioral', {}, undefined)).toBe(
      'Round type: behavioral — the loop has not been researched',
    )
  })

  it('says the research landed mid-session when a map exists now but did not at the start', () => {
    expect(describeStage('behavioral', {}, map)).toBe(
      'Round type: behavioral — the loop was researched during this mock',
    )
  })
})

describe('transcriptText', () => {
  it('labels every interviewer turn by kind, and the candidate as Candidate', () => {
    expect(transcriptText(transcript, 'conversation')).toBe(
      [
        'Interviewer (question): Walk me through the ledger rewrite.',
        'Candidate: I led it over two quarters.',
        'Interviewer (follow-up): What did you decide against?',
        'Candidate: A dual-write. Too much drift.',
        'Interviewer (closing): That’s all I had. End the mock for the feedback.',
      ].join('\n'),
    )
  })

  it('fences the candidate’s turns in coding mode, and only there', () => {
    expect(transcriptText(transcript, 'coding')).toContain('Candidate:\n````\nI led it over two quarters.\n````')
    expect(transcriptText(transcript, 'conversation')).not.toContain('```')
    expect(transcriptText(transcript, 'design')).not.toContain('```')
  })

  it('keeps a pasted fence inside the turn it was pasted into', () => {
    // Coding mode is the mode people paste code in, and code pasted out of a README, a chat or
    // a markdown comment brings its own fence. A three-backtick fence would end the turn on
    // their first line — and the boundary between their words and the transcript's structure is
    // what tells the interviewer, and the debrief that shares this text, whose sentence is whose.
    const pasted: MockTurn[] = [{ role: 'user', text: '```go\nfunc main() {}\n```', at: AT }]
    expect(transcriptText(pasted, 'coding')).toBe('Candidate:\n````\n```go\nfunc main() {}\n```\n````')
  })

  it('says the transcript is empty rather than sending nothing', () => {
    expect(transcriptText([], 'conversation')).toBe('(none yet — this is the first question)')
  })
})

describe('buildMockTurnPrompt parts', () => {
  it('sends the job, the stage, what people were asked, the facts, the mode, the count, the earlier questions, then the transcript', () => {
    const { parts } = buildMockTurnPrompt({
      jobSummary: 'Company: Marram Systems',
      stageSummary: 'Stage 2 of 3: Coding round · video · 60 min',
      reportedSummary: 's1 [first-hand; 2026]: Walk me through the ledger rewrite',
      factsSummary: 'f1: Owns a payments service at 99.95% success',
      mode: 'coding',
      questionsAsked: 1,
      previousQuestions: ['How do you test?'],
      transcript: [],
    })
    expect(parts).toEqual([
      { text: 'The job:\nCompany: Marram Systems' },
      { text: 'The stage:\nStage 2 of 3: Coding round · video · 60 min' },
      { text: 'Questions people report being asked at this company:\ns1 [first-hand; 2026]: Walk me through the ledger rewrite' },
      { text: 'Candidate facts:\nf1: Owns a payments service at 99.95% success' },
      { text: 'Mode: coding' },
      { text: 'Questions asked so far: 1 of 6' },
      { text: 'Asked in earlier sessions:\nHow do you test?' },
      { text: 'Transcript:\n(none yet — this is the first question)' },
    ])
  })

  it('counts the questions against the cap the route enforces', () => {
    const { parts } = buildMockTurnPrompt({
      jobSummary: '', stageSummary: '', reportedSummary: '', factsSummary: '',
      mode: 'conversation', questionsAsked: 5, previousQuestions: [], transcript,
    })
    expect(parts.map((p) => ('text' in p ? p.text : '')).join('\n')).toContain('Questions asked so far: 5 of 6')
  })

  it('says (none) for an empty reported list, an empty bank and a first session', () => {
    const { parts } = buildMockTurnPrompt({
      jobSummary: 'Company: Marram Systems',
      stageSummary: 'Round type: technical — the loop has not been researched',
      reportedSummary: '',
      factsSummary: '',
      mode: 'conversation',
      questionsAsked: 0,
      previousQuestions: [],
      transcript: [],
    })
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('\n')
    expect(text).toContain('Questions people report being asked at this company:\n(none)')
    expect(text).toContain('Candidate facts:\n(none)')
    expect(text).toContain('Asked in earlier sessions:\n(none)')
  })
})

describe('buildMockDebriefPrompt parts', () => {
  it('sends the job, the stage, the mode, the facts and the transcript', () => {
    const { parts } = buildMockDebriefPrompt({
      jobSummary: 'Company: Marram Systems',
      stageSummary: 'Round type: technical — the loop has not been researched',
      mode: 'conversation',
      factsSummary: '',
      transcript,
    })
    expect(parts).toEqual([
      { text: 'The job:\nCompany: Marram Systems' },
      { text: 'The stage:\nRound type: technical — the loop has not been researched' },
      { text: 'Mode: conversation' },
      { text: 'Candidate facts:\n(none)' },
      { text: `Transcript:\n${transcriptText(transcript, 'conversation')}` },
    ])
  })

  it('fences the code it is asked to read', () => {
    const { parts } = buildMockDebriefPrompt({
      jobSummary: '', stageSummary: '', mode: 'coding', factsSummary: 'f1: Ships Go services', transcript,
    })
    expect(parts.at(-1)).toEqual({ text: `Transcript:\n${transcriptText(transcript, 'coding')}` })
  })
})
