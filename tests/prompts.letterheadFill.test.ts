import { describe, it, expect } from 'vitest'
import { buildLetterheadFillPrompt } from '@/ai/prompts/letterheadFill'
import type { Fact } from '@/lib/types'

// The fill's system text says which document each field may come from and forbids everything
// else, so a paraphrase of it is a different flow. It is the design note's word for word, and a
// verbatim copy lives here so the build fails if the prompt drifts from it.
const VERBATIM = `You fill in the letterhead of a cover letter from two documents, and you never guess.
From the candidate's facts, and only from them: their phone number, and where they are based as "City, State" or "City, Country".
From the job posting, and only from it: the full name of the person applications go to, the hiring manager, or whom the role reports to; that person's title; and the office or headquarters address the posting states for this role — the full address when it gives one, else the city and state.
Rules:
1. Every value carries a quote: a verbatim span of the fact or of the posting that states it. No quote, no value — return null.
2. Never infer. A company's city is not the candidate's; a recruiter's first name is not a full name; "remote" is not an address; a name signing a posting is the recipient only when the posting says applications or the role go to that person.
3. Never an honorific, never a street address for the candidate, never a value from anywhere but the document named for it.`

const facts: Fact[] = [
  {
    id: 'f1',
    claim: 'Based in Portland, Oregon.',
    sourceSnippet: 'Tom Candidate — Portland, Oregon — (503) 555-0161',
    tags: ['contact'],
  },
]

const parsed = { company: 'Marram Systems', role: 'Senior Backend Engineer' }

const texts = (parts: { text: string }[]) => parts.map((p) => p.text)

describe('buildLetterheadFillPrompt — the system text', () => {
  it('is the design note’s, word for word', () => {
    expect(buildLetterheadFillPrompt({ facts, jdText: 'Apply to Dana Wu.', parsed }).system).toBe(
      VERBATIM,
    )
  })
})

describe('buildLetterheadFillPrompt — the parts', () => {
  it('lays out the facts with their sources, then the role, then the posting', () => {
    const { parts } = buildLetterheadFillPrompt({
      facts,
      jdText: 'Applications go to Dana Wu, Head of Engineering.',
      parsed,
    })
    expect(texts(parts as { text: string }[])).toEqual([
      "The candidate's facts, with the words each came from:\n" +
        'f1: Based in Portland, Oregon. — "Tom Candidate — Portland, Oregon — (503) 555-0161"',
      'Company: Marram Systems. Role: Senior Backend Engineer.',
      'The job posting:\nApplications go to Dana Wu, Head of Engineering.',
    ])
  })

  it('says there are no facts rather than dropping the section', () => {
    const { parts } = buildLetterheadFillPrompt({ facts: [], jdText: 'Apply to Dana Wu.', parsed })
    expect(texts(parts as { text: string }[])[0]).toBe(
      "The candidate's facts, with the words each came from:\n(none)",
    )
  })

  it('drops the posting when there is none, and keeps the facts', () => {
    const { parts } = buildLetterheadFillPrompt({ facts, jdText: '   ', parsed })
    expect(texts(parts as { text: string }[])).toHaveLength(2)
    expect(texts(parts as { text: string }[])[1]).toBe(
      'Company: Marram Systems. Role: Senior Backend Engineer.',
    )
  })

  it('refuses when there is nothing at all to read', () => {
    expect(() => buildLetterheadFillPrompt({ facts: [], jdText: '', parsed })).toThrow(
      'letterheadFill needs the facts or the posting',
    )
  })
})
