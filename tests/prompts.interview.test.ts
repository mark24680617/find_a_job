import { describe, it, expect } from 'vitest'
import {
  buildInterviewInterpretPrompt,
} from '@/ai/prompts/interviewInterpret'
import {
  buildPrepBriefPrompt,
  summarizeJob,
  summarizeReported,
  summarizeStage,
} from '@/ai/prompts/prepBrief'
import type { Part } from '@/ai/genkit'
import type { ReportedQuestion, StagePlacement } from '@/lib/practice'
import type { Fact, ParsedJob, ProcessStage } from '@/lib/types'
import { summarizeFacts } from '@/ai/prompts/jobInterpret'

// Both system texts are the design spec's, word for word. The first carries the round
// taxonomy the ics export, the strip and the brief all key on, plus the rule that stops a
// notice saying "next Thursday" from becoming a date on somebody's calendar. The second ends
// on the sentence that is the whole product ("It does not script lies"). A paraphrase of
// either would quietly change what the model does, so verbatim copies live here and the build
// fails if a prompt drifts from one.

const INTERPRET_VERBATIM = `You interpret an interview notice (email text or screenshot).
- roundType: recruiter-screen | technical | system-design | behavioral | panel | onsite | other.
  Judge from the notice's own words (who, how long, "coding", "values", "meet the team").
- datetime: ISO 8601 with timezone if the notice states one, else null. Never guess a date.
- people: names/titles of interviewers if stated.
- askHuman: what the notice does not say that preparation needs (round number? recruiter
  said what to expect? is there a take-home?). Ask, do not guess.`

const BRIEF_VERBATIM = `You write an interview prep brief for one round.
Input: the round type, the parsed job (role facts, gates, themes), the candidate's facts.
Sections:
- likelyTopics: what THIS round type at THIS company probes, tied to the role facts.
- questionsToPrepare: likely questions + angle = which candidate fact cluster answers each.
  Use only provided facts for angles; never invent an experience.
  When questions people report being asked are given, lead questionsToPrepare with the ones
  that fit THIS stage, copied word for word, each with the sourceId of the guide that reported
  it. Write your own only after those, with sourceId null. A reported question that does not
  fit this stage is left out, not adapted.
- questionsToAsk: sharp questions the candidate should ask back, grounded in role facts.
- factsToRehearse: the candidate's facts (verbatim claims) most load-bearing for this round.
- redFlags: pitfalls for this candidate in this round (unmet gates that may come up —
  say how to address honestly, not how to dodge).
The brief prepares the candidate to tell their own story clearly. It does not script lies.`

const NOTICE = `Hi Tom — a 30-minute call with our recruiter Ana Reyes next Thursday at 2pm PT.
We will cover your background and the role.`

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['Owns the ledger write path', 'Seattle, hybrid'],
  gates: [
    {
      requirement: '5 years of production Go',
      met: 'no',
      posture: 'explicit',
      note: 'Minimum 5 years',
    },
  ],
  themes: ['payments', 'ledger'],
  scope: 'per-application',
  advisory: 'The five-year minimum is explicit and you have three; apply only with a referral.',
}

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service at 99.95% success', sourceSnippet: 'Payments', tags: ['payments'] },
  { id: 'f2', claim: 'Three years backend, mostly Go', sourceSnippet: 'Backend engineer', tags: ['go'] },
]

// One stage of a real-looking loop, and the questions three guides reported. `s3` carries no
// firstHand: guides digested before we recorded the flag have none, and the line for one says
// neither rather than guessing which it was.
const stage: ProcessStage = {
  order: 2,
  name: 'Hiring manager screen',
  kind: 'behavioral',
  format: 'video',
  duration: '45 minutes',
  whatItProbes: 'How you work with the people around you.',
  tips: ['Bring one story per theme.', 'Have a number in each of them.'],
  sourceIds: ['s1'],
  confidence: 'community',
}

const placement: StagePlacement = { stage, of: 5 }

const reported: ReportedQuestion[] = [
  {
    sourceId: 's1',
    host: 'reddit.com',
    url: 'https://www.reddit.com/r/cscareerquestions/comments/a',
    text: 'Tell me about a time you disagreed with your manager.',
    firstHand: true,
    stale: false,
    year: '2025',
  },
  {
    sourceId: 's2',
    host: 'prepsite.example',
    url: 'https://prepsite.example/marram',
    text: 'Why this company?',
    firstHand: false,
    stale: true,
  },
  {
    sourceId: 's3',
    host: 'news.ycombinator.com',
    url: 'https://news.ycombinator.com/item?id=1',
    text: 'Walk me through your last project.',
    stale: false,
    year: '2023',
  },
]

const textOf = (parts: Part[]) => parts.map((p) => ('text' in p ? p.text : '')).join('\n')

describe('buildInterviewInterpretPrompt system text', () => {
  const system = () => buildInterviewInterpretPrompt({ noticeText: NOTICE }).system

  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(INTERPRET_VERBATIM)
  })

  it('names every round type in the taxonomy the record stores', () => {
    const s = system()
    for (const type of ['recruiter-screen', 'technical', 'system-design', 'behavioral', 'panel', 'onsite', 'other']) {
      expect(s).toContain(type)
    }
  })

  it('forbids guessing a date and demands the questions be asked instead', () => {
    const s = system()
    expect(s).toContain('Never guess a date')
    expect(s).toContain('Ask, do not guess')
  })

  it('is the same text whatever the notice is', () => {
    expect(buildInterviewInterpretPrompt({ noticeText: 'something else' }).system).toBe(system())
  })
})

describe('buildInterviewInterpretPrompt parts', () => {
  it('puts the notice in front of the model', () => {
    expect(textOf(buildInterviewInterpretPrompt({ noticeText: NOTICE }).parts)).toContain(NOTICE)
  })

  it('refuses an empty notice rather than asking the model to invent one', () => {
    expect(() => buildInterviewInterpretPrompt({ noticeText: '   ' })).toThrow(/noticeText/)
  })
})

describe('buildPrepBriefPrompt system text', () => {
  const built = () =>
    buildPrepBriefPrompt({
      roundType: 'recruiter-screen',
      jobSummary: summarizeJob(parsed),
      factsSummary: summarizeFacts(facts),
    })

  it('carries the spec system text verbatim', () => {
    expect(built().system).toContain(BRIEF_VERBATIM)
  })

  it('demands all five sections', () => {
    const s = built().system
    for (const section of [
      'likelyTopics',
      'questionsToPrepare',
      'questionsToAsk',
      'factsToRehearse',
      'redFlags',
    ]) {
      expect(s).toContain(`- ${section}:`)
    }
  })

  it('holds the angle to the facts actually provided', () => {
    expect(built().system).toContain('Use only provided facts for angles; never invent an experience')
  })

  it('asks for reported questions word for word, cited, and never adapted', () => {
    const s = built().system
    expect(s).toContain('copied word for word, each with the sourceId of the guide that reported')
    expect(s).toContain('A reported question that does not\n  fit this stage is left out, not adapted.')
  })

  it('says what the brief is for, and what it is not', () => {
    expect(built().system).toContain(
      'The brief prepares the candidate to tell their own story clearly. It does not script lies.',
    )
  })

  it('is the same text whatever the round is', () => {
    const other = buildPrepBriefPrompt({ roundType: 'onsite', jobSummary: '', factsSummary: '' })
    expect(other.system).toBe(built().system)
  })
})

describe('buildPrepBriefPrompt parts', () => {
  const parts = () =>
    buildPrepBriefPrompt({
      roundType: 'technical',
      jobSummary: summarizeJob(parsed),
      factsSummary: summarizeFacts(facts),
    }).parts

  it('names the round the brief is for', () => {
    expect(textOf(parts())).toContain('Round type: technical')
  })

  it('carries the role facts, the gates and the themes', () => {
    const text = textOf(parts())
    expect(text).toContain('Owns the ledger write path')
    expect(text).toContain('[met=no, explicit] 5 years of production Go — Minimum 5 years')
    expect(text).toContain('Themes: payments, ledger')
  })

  it('carries every fact id and claim', () => {
    const text = textOf(parts())
    for (const f of facts) {
      expect(text).toContain(f.id)
      expect(text).toContain(f.claim)
    }
  })

  it('leaves both map parts out when the application has not been researched', () => {
    expect(buildPrepBriefPrompt({ roundType: 'onsite', jobSummary: 'JOB', factsSummary: 'FACTS' }).parts).toEqual([
      { text: 'Round type: onsite' },
      { text: 'The job:\nJOB' },
      { text: 'Candidate facts:\nFACTS' },
    ])
  })

  // The stage sits directly behind the round type — it is what this round actually is — and the
  // reported questions come last, after the facts, because they are read against what the
  // candidate can actually answer.
  it('puts the stage behind the round type and the reported questions last', () => {
    const built = buildPrepBriefPrompt({
      roundType: 'technical',
      jobSummary: 'JOB',
      factsSummary: 'FACTS',
      stageSummary: 'STAGE',
      reportedSummary: 'REPORTED',
    })
    expect(built.parts).toEqual([
      { text: 'Round type: technical' },
      { text: 'The stage this round is:\nSTAGE' },
      { text: 'The job:\nJOB' },
      { text: 'Candidate facts:\nFACTS' },
      { text: 'Questions people report being asked at this company:\nREPORTED' },
    ])
  })
})

describe('summarizeStage', () => {
  it('places the round on the loop, says how it runs and how long, then what it probes and what people advise', () => {
    expect(summarizeStage(placement)).toBe(
      [
        'Stage 2 of 5: Hiring manager screen · video · 45 minutes',
        'What it probes: How you work with the people around you.',
        'Tips:',
        '- Bring one story per theme.',
        '- Have a number in each of them.',
      ].join('\n'),
    )
  })

  it('states a missing length rather than leaving a gap the model fills in', () => {
    expect(summarizeStage({ stage: { ...stage, duration: undefined }, of: 5 })).toContain(
      'Stage 2 of 5: Hiring manager screen · video · length not stated',
    )
  })

  it('omits the Tips block entirely when the stage has no tips — an empty heading reads as an instruction to fill it', () => {
    const bare = summarizeStage({ stage: { ...stage, tips: [] }, of: 5 })
    expect(bare).not.toContain('Tips:')
    expect(bare).toBe(
      [
        'Stage 2 of 5: Hiring manager screen · video · 45 minutes',
        'What it probes: How you work with the people around you.',
      ].join('\n'),
    )
  })
})

describe('summarizeReported', () => {
  it('leads each line with the source id the model must cite, then how much the line is worth', () => {
    expect(summarizeReported(reported)).toBe(
      [
        's1 [first-hand; 2025]: Tell me about a time you disagreed with your manager.',
        's2 [second-hand; undated; stale]: Why this company?',
        's3 [2023]: Walk me through your last project.',
      ].join('\n'),
    )
  })

  it('says (none) rather than nothing when no guide reported a question', () => {
    expect(summarizeReported([])).toBe('(none)')
  })
})

describe('summarizeJob', () => {
  it('leaves out the apply-or-skip advisory — that decision was taken before the round was booked', () => {
    expect(summarizeJob(parsed)).not.toContain(parsed.advisory)
  })

  it('leaves out the scope — where a document attaches is not prep material', () => {
    expect(summarizeJob(parsed)).not.toContain('per-application')
  })

  it('keeps the verdict and posture on each gate, which is what a red flag is written from', () => {
    expect(summarizeJob(parsed)).toContain('[met=no, explicit]')
  })
})
