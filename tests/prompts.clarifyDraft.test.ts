import { describe, it, expect } from 'vitest'
import { buildClarifyDraftPrompt } from '@/ai/prompts/clarifyDraft'
import type { ClarifyAnswer, Fact, Question } from '@/lib/types'

// The system text is the line the whole step turns on, stated to the model word for word:
// positioning, never information; ask only what the facts cannot settle; return nothing when
// they do. A paraphrase would quietly turn this back into a fact-gathering step, so a verbatim
// copy lives here and the build fails if the prompt drifts from it.
const VERBATIM = `You set up one job-application answer before it is written. Your job is to find what the writer must decide that only the candidate can settle — never to ask for a fact.

You are given the question, the raw job posting, and the candidate's facts. First work out, silently, what this role is really screening for — the competencies and signals a strong candidate must show, read from the posting's responsibilities and requirements, not its adjectives. Then find where the candidate's facts could match that in more than one way, or where the strongest answer depends on something the facts do not settle.

Ask only about those. Rules:
- Never ask for a fact you were given or could infer from the facts. Positioning, not information: which experience should lead, which angle to take, whether to address a gap head-on, what the candidate cares about in THIS role that the facts do not say.
- At most 4 questions. Fewer is better. If the answer is clear from the facts and the posting, ask nothing — return an empty list and the answer will be written directly.
- Each question: a short question, a one-line why it changes the answer, 2 to 4 concrete options drawn from the candidate's actual material, a recommended option, and whether more than one option can hold at once.
- Options must be real and specific to this candidate and this role — never generic. The recommended option is the one you would pick if the candidate never answered.
- allowOther only when a free-text answer would genuinely serve better than your options.`

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: '', tags: ['payments'] },
  { id: 'f2', claim: 'Led the migration of 14 services from RabbitMQ to Kafka', sourceSnippet: '', tags: ['infra'] },
]

const question = (over: Partial<Question> = {}): Question => ({
  q: 'Why do you want to work here? Write a short cover letter.',
  constraints: { limit: 200, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
  ...over,
})

const input = (over: Partial<Parameters<typeof buildClarifyDraftPrompt>[0]> = {}) => ({
  question: question(),
  jdText: 'Own the payments platform. Deep reliability work. Minimum 5 years backend.',
  facts,
  standardAnswers: {},
  clarifyAnswers: [] as ClarifyAnswer[],
  ...over,
})

/** Every text part joined — what the model actually reads, whatever the split. */
const body = (over: Partial<Parameters<typeof buildClarifyDraftPrompt>[0]> = {}) =>
  buildClarifyDraftPrompt(input(over))
    .parts.map((p) => ('text' in p ? p.text : ''))
    .join('\n\n')

describe('buildClarifyDraftPrompt system text', () => {
  const system = () => buildClarifyDraftPrompt(input()).system

  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(VERBATIM)
  })

  it('draws the line the step turns on — positioning, never a fact', () => {
    const s = system()
    expect(s).toContain('never to ask for a fact')
    expect(s).toContain('Never ask for a fact you were given or could infer from the facts.')
    expect(s).toContain('Positioning, not information')
  })

  it('caps the round at four and lets it be empty when the facts settle the answer', () => {
    const s = system()
    expect(s).toContain('At most 4 questions. Fewer is better.')
    expect(s).toContain('ask nothing — return an empty list')
  })

  it('demands concrete options and a recommended default drawn from real material', () => {
    const s = system()
    expect(s).toContain("2 to 4 concrete options drawn from the candidate's actual material")
    expect(s).toContain('Options must be real and specific to this candidate and this role — never generic.')
    expect(s).toContain('The recommended option is the one you would pick if the candidate never answered.')
  })

  it('is the same text whatever the inputs are', () => {
    expect(buildClarifyDraftPrompt(input({ facts: [] })).system).toBe(system())
  })
})

describe('buildClarifyDraftPrompt parts', () => {
  it('leads with the question the answer will address', () => {
    const parts = buildClarifyDraftPrompt(input()).parts
    const first = parts[0] as { text: string }
    expect(first.text).toContain('The question the answer will address:')
    expect(first.text).toContain('Why do you want to work here?')
  })

  it('sends the raw posting as its own part — the depth source the screens are read from', () => {
    const text = body({ jdText: 'Own the payments platform. Deep reliability work.' })
    expect(text).toContain('The job posting:')
    expect(text).toContain('Own the payments platform. Deep reliability work.')
  })

  it('sends the facts as f<id>: claim lines, so every option can be drawn from them', () => {
    const text = body()
    expect(text).toContain('f1: Owns a payments service handling 12,000 requests/day')
    expect(text).toContain('f2: Led the migration of 14 services from RabbitMQ to Kafka')
  })

  it('says there are no facts rather than dropping the section', () => {
    const text = body({ facts: [] })
    expect(text).toMatch(/facts/i)
    expect(text).toContain('(none)')
  })

  it('sends the standard answers the candidate has settled, skipping the UNKNOWNs', () => {
    const text = body({
      standardAnswers: { work_authorization: 'US citizen', salary_expectation: 'UNKNOWN', relocation: '' },
    })
    expect(text).toContain('work_authorization: US citizen')
    expect(text).not.toContain('salary_expectation')
    expect(text).not.toContain('relocation')
  })

  it('feeds back positioning already settled so the model does not ask it again', () => {
    const clarifyAnswers: ClarifyAnswer[] = [
      { id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] },
    ]
    const text = body({ clarifyAnswers })
    expect(text).toContain('do not ask them again')
    expect(text).toContain('Q: Which experience should lead?')
    expect(text).toContain('Chose: The payments service')
  })

  it('leaves out an unanswered prior card — it is still open, not settled', () => {
    const clarifyAnswers: ClarifyAnswer[] = [{ id: 'c1', question: 'Which experience should lead?', answer: [] }]
    const text = body({ clarifyAnswers })
    expect(text).not.toContain('do not ask them again')
  })

  it('tells the model to number its questions c1, c2, …', () => {
    expect(body()).toContain('Number your questions c1, c2, c3 … in order.')
  })

  it('sends text only — there is nothing here for the model to look at', () => {
    expect(buildClarifyDraftPrompt(input()).parts.every((p) => 'text' in p)).toBe(true)
  })

  it('refuses to set up an answer to no question', () => {
    expect(() => buildClarifyDraftPrompt(input({ question: question({ q: '  ' }) }))).toThrow(
      /clarifyDraft needs a question/,
    )
  })

  it('refuses to reason about a role with no posting', () => {
    expect(() => buildClarifyDraftPrompt(input({ jdText: '   ' }))).toThrow(/clarifyDraft needs the job posting/)
  })
})
