import { describe, it, expect } from 'vitest'
import {
  buildInterviewInterpretPrompt,
} from '@/ai/prompts/interviewInterpret'
import { buildPrepBriefPrompt, summarizeJob } from '@/ai/prompts/prepBrief'
import type { Part } from '@/ai/genkit'
import type { Fact, ParsedJob } from '@/lib/types'
import { summarizeFacts } from '@/ai/prompts/jobInterpret'

// Both system texts are the design spec's, word for word. The first carries the round
// taxonomy the ics export, the strip and the brief all key on, plus the rule that stops a
// notice saying "next Thursday" from becoming a date on somebody's calendar. The second ends
// on the sentence that is the whole product ("It does not script lies"). A paraphrase of
// either would quietly change what the model does, so verbatim copies live here and the build
// fails if a prompt drifts from one.

const INTERPRET_VERBATIM = `You interpret an interview notice (email text or screenshot).
- roundType: recruiter-screen | technical | behavioral | panel | onsite | other.
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

const textOf = (parts: Part[]) => parts.map((p) => ('text' in p ? p.text : '')).join('\n')

describe('buildInterviewInterpretPrompt system text', () => {
  const system = () => buildInterviewInterpretPrompt({ noticeText: NOTICE }).system

  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(INTERPRET_VERBATIM)
  })

  it('names every round type in the taxonomy the record stores', () => {
    const s = system()
    for (const type of ['recruiter-screen', 'technical', 'behavioral', 'panel', 'onsite', 'other']) {
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
