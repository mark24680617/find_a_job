import { describe, it, expect } from 'vitest'
import { buildAnswerDraftPrompt, statedLimit } from '@/ai/prompts/answerDraft'
import type { AskHuman, ClarifyAnswer, Fact, ParsedJob, Question } from '@/lib/types'

// The system text is the product itself stated to the model: every factual claim carries a
// citation or becomes a question for the human, the limit is exact, and a per-profile answer
// never quotes the posting it was written beside. A paraphrase would quietly loosen any one
// of those, so a verbatim copy lives here and the build fails if the prompt drifts from it.
const VERBATIM = `You draft one job-application answer in the candidate's own voice.
The candidate's story is unique. You refine how it is told. You never replace it.
Hard rules:
1. GROUNDING. Every factual claim must trace to a provided fact (cite factId) or a provided
  standardAnswer / human answer. If the strongest answer needs something you do not have
  (motivation for THIS company, a date, a preference), do NOT write around it and do NOT
  hedge into vagueness — emit an askHuman item: the exact question, and why the answer
  needs it. An answer with an open askHuman is a draft with a hole, and that is correct.
2. citations: map each factual claimSpan (verbatim substring of your text) to its factId.
  Whole-cloth sentences with no possible citation are forbidden — rework or askHuman.
3. LIMIT. Stated limit is exact. Count. Under is fine, over is failure.
4. SCOPE. If parsed.scope is "per-profile": never quote this posting's wording, never
  confess gaps against this posting's requirements, never name a site/office. Those moves
  are only allowed when scope is "per-application".
5. REGISTER. Concrete, specific, understated. Prefer the quantified fact over the
  adjective. Ban: passionate, leverage, cutting-edge, delve, spearheaded, synergy.
6. VOICE RULES. Apply every provided voice rule; they encode how this person writes.
7. One story, one spine: pick the angle of the story that answers THIS question; do not
  reuse a spine that answers a different question.
8. MATCH, do not list. Work out what this role screens for from the posting, and lead with the candidate's single strongest match to it. An answer that recites facts in order is worse than one that makes the case for this candidate in this role. The positioning choices below, if any, are decisions the candidate has already made — follow them.
9. When the candidate's own telling is present, its specifics outrank resume-level phrasing. The answer should read like their story, written well — concrete, in order, still cited. Do not flatten it back into a summary.`

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: 'payments service, 12k req/day', tags: ['payments'] },
  { id: 'f2', claim: 'Cut p99 checkout latency from 840ms to 210ms', sourceSnippet: '840ms to 210ms', tags: ['performance'] },
]

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: ['remote, UK hours'],
  gates: [{ requirement: '5 years backend', met: 'yes', posture: 'explicit', note: 'Minimum 5 years' }],
  themes: ['payments', 'performance'],
  scope: 'per-application',
  advisory: '',
}

const question = (over: Partial<Question> = {}): Question => ({
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
  ...over,
})

const input = (over: Partial<Parameters<typeof buildAnswerDraftPrompt>[0]> = {}) => ({
  question: question(),
  parsed,
  jdText: 'Own the ledger and settlement services. Go and PostgreSQL, moving to event-driven ingest.',
  facts,
  standardAnswers: {},
  voiceRules: [],
  humanAnswers: [] as AskHuman[],
  clarifyAnswers: [] as ClarifyAnswer[],
  ...over,
})

/** Every text part joined — what the model actually reads, whatever the split. */
const body = (over: Partial<Parameters<typeof buildAnswerDraftPrompt>[0]> = {}) =>
  buildAnswerDraftPrompt(input(over))
    .parts.map((p) => ('text' in p ? p.text : ''))
    .join('\n\n')

describe('buildAnswerDraftPrompt system text', () => {
  const system = () => buildAnswerDraftPrompt(input()).system

  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(VERBATIM)
  })

  it('states the grounding rule — cite a fact or ask the human, never write around it', () => {
    const s = system()
    expect(s).toMatch(
      /1\. GROUNDING\. Every factual claim must trace to a provided fact \(cite factId\) or a provided\s+standardAnswer \/ human answer\./,
    )
    expect(s).toMatch(/do NOT write around it and do NOT\s+hedge into vagueness — emit an askHuman item/)
    // The line that makes an unfinished answer a correct outcome rather than a failure.
    expect(s).toContain('An answer with an open askHuman is a draft with a hole, and that is correct.')
  })

  it('demands a verbatim claimSpan per citation and forbids whole-cloth sentences', () => {
    const s = system()
    expect(s).toContain(
      '2. citations: map each factual claimSpan (verbatim substring of your text) to its factId.',
    )
    expect(s).toContain('Whole-cloth sentences with no possible citation are forbidden')
  })

  it('states the scope gate — what a per-profile answer may never do', () => {
    const s = system()
    expect(s).toMatch(
      /4\. SCOPE\. If parsed\.scope is "per-profile": never quote this posting's wording, never\s+confess gaps against this posting's requirements, never name a site\/office\./,
    )
    expect(s).toContain('Those moves')
    expect(s).toContain('are only allowed when scope is "per-application".')
  })

  it('states the register rules and every banned word', () => {
    const s = system()
    expect(s).toMatch(
      /5\. REGISTER\. Concrete, specific, understated\. Prefer the quantified fact over the\s+adjective\./,
    )
    for (const banned of ['passionate', 'leverage', 'cutting-edge', 'delve', 'spearheaded', 'synergy']) {
      expect(s).toContain(banned)
    }
  })

  it('states the limit rule and the one-spine rule', () => {
    const s = system()
    expect(s).toContain('3. LIMIT. Stated limit is exact. Count. Under is fine, over is failure.')
    expect(s).toContain('6. VOICE RULES. Apply every provided voice rule')
    expect(s).toMatch(/7\. One story, one spine: pick the angle of the story that answers THIS question/)
  })

  it('states the match rule — position for the role, do not list, and follow the choices made', () => {
    // The depth rule: a draft that recites facts in order is the shallow failure this adds
    // rule 8 to prevent, and the positioning choices are decisions to follow, not reconsider.
    const s = system()
    expect(s).toContain('8. MATCH, do not list.')
    expect(s).toContain("lead with the candidate's single strongest match to it")
    expect(s).toContain('An answer that recites facts in order is worse')
    expect(s).toContain('are decisions the candidate has already made — follow them.')
  })

  it('states rule 9 — the candidate’s own telling outranks resume-level phrasing', () => {
    // Task 28's whole point. Without it the model reads a story and writes the summary it
    // already had: the specifics arrive and get flattened straight back out.
    const s = system()
    expect(s).toContain("9. When the candidate's own telling is present, its specifics outrank resume-level phrasing.")
    expect(s).toContain('The answer should read like their story, written well — concrete, in order, still cited.')
    expect(s).toContain('Do not flatten it back into a summary.')
  })

  it('is the same text whatever the inputs are', () => {
    expect(buildAnswerDraftPrompt(input({ facts: [], voiceRules: ['short sentences'] })).system).toBe(
      system(),
    )
  })
})

describe('buildAnswerDraftPrompt parts', () => {
  it('leads with the question and the limit the answer has to hit', () => {
    const parts = buildAnswerDraftPrompt(input()).parts
    const first = parts[0] as { text: string }
    expect(first.text).toContain('Describe a backend system you designed end to end.')
    expect(first.text).toContain('100 words')
    expect(first.text).toContain('long-text')
    expect(first.text).toContain('required')
  })

  it('says plainly when the form stated no limit, rather than leaving it out', () => {
    const text = body({ question: question({ constraints: { type: 'short-text', required: false } }) })
    expect(text).toContain('no stated limit')
    expect(text).not.toMatch(/at most \d/)
  })

  it('states no limit when the constraint is half a pair, matching what the guard can check', () => {
    // A limit with no unit is a limit in nothing. Stating it would ask the model to hit a
    // target the guard cannot count, so neither half is used.
    const halves: Question['constraints'][] = [
      { limit: 100, type: 'long-text', required: true },
      { unit: 'words', type: 'long-text', required: true },
    ]
    for (const constraints of halves) {
      expect(body({ question: question({ constraints }) })).toContain('no stated limit')
      expect(statedLimit(constraints)).toBeNull()
    }
    expect(statedLimit({ limit: 100, unit: 'words', type: 'long-text', required: true })).toEqual({
      limit: 100,
      unit: 'words',
    })
  })

  it('sends the parsed posting as compact JSON, scope included', () => {
    const text = body()
    // Rule 4 is judged on scope; a posting sent without it silently drops that rule.
    expect(text).toContain('"scope":"per-application"')
    expect(text).toContain('"company":"Marram Systems"')
    expect(text).toContain('"role":"Senior Backend Engineer"')
    expect(text).toContain('"themes":["payments","performance"]')
    expect(text).toContain('"requirement":"5 years backend"')
    expect(text).toContain('"roleFacts":["remote, UK hours"]')
  })

  it('leaves the apply-or-skip advisory out — it is advice to the human, not material', () => {
    const text = body({ parsed: { ...parsed, advisory: 'Skip: the 8-year minimum is explicit.' } })
    expect(text).not.toContain('Skip: the 8-year minimum is explicit.')
    expect(text).not.toContain('advisory')
  })

  it('sends the raw posting as its own part, headed so rule 8 can match against it', () => {
    // The parsed job is this product's reading of the posting; rule 8 also needs the posting
    // itself, in its own words, to work out what the role really screens for.
    const text = body({ jdText: 'Own the ledger. Deep event-driven ingest work. Minimum 5 years.' })
    expect(text).toContain('The job posting:')
    expect(text).toContain('Own the ledger. Deep event-driven ingest work. Minimum 5 years.')
  })

  it('omits the posting part when there is no posting text, rather than heading an empty one', () => {
    // An application whose posting was never captured still drafts, on the parsed job alone.
    const text = body({ jdText: '   ' })
    expect(text).not.toContain('The job posting:')
  })

  it('sends the facts as f<id>: claim lines and nothing else about them', () => {
    const text = body()
    expect(text).toContain('f1: Owns a payments service handling 12,000 requests/day')
    expect(text).toContain('f2: Cut p99 checkout latency from 840ms to 210ms')
    // The snippet is provenance for the profile editor; the draft cites the claim.
    expect(text).not.toContain('payments service, 12k req/day')
  })

  it('says there are no facts rather than dropping the section', () => {
    // An absent facts section reads as "grounding was not part of this task". An empty one
    // reads as "there is nothing to cite" — which is the truth, and sends the model to askHuman.
    const text = body({ facts: [] })
    expect(text).toMatch(/facts/i)
    expect(text).toContain('(none)')
  })

  it('sends the standard answers the candidate has settled, skipping the UNKNOWNs', () => {
    const text = body({
      standardAnswers: {
        work_authorization: 'UK citizen',
        salary_expectation: 'UNKNOWN',
        notice_period: 'unknown',
        relocation: '',
        earliest_start_date: '2026-10-01',
      },
    })
    expect(text).toContain('work_authorization: UK citizen')
    expect(text).toContain('earliest_start_date: 2026-10-01')
    expect(text).not.toContain('salary_expectation')
    expect(text).not.toContain('notice_period')
    expect(text).not.toContain('relocation')
  })

  it('bullets the voice rules', () => {
    const text = body({ voiceRules: ['cuts openers, starts with the fact', 'sentences under 20 words'] })
    expect(text).toContain('- cuts openers, starts with the fact')
    expect(text).toContain('- sentences under 20 words')
  })

  it('sends what the candidate has already answered, as their own words', () => {
    const humanAnswers: AskHuman[] = [
      { question: 'Why this company?', why: 'not in the profile', answer: 'Their ledger post.' },
    ]
    const text = body({ humanAnswers })
    expect(text).toContain('Q: Why this company?')
    expect(text).toContain('A (from the candidate): Their ledger post.')
    // The reason the agent asked is scaffolding for the human, not material for the answer.
    expect(text).not.toContain('not in the profile')
  })

  it('renders the positioning choices the candidate settled, one line each', () => {
    // Rule 8 treats these as decisions already made; the draft reads them under their heading
    // and follows them. A multi-select answer is joined into the one line.
    const clarifyAnswers: ClarifyAnswer[] = [
      { id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] },
      { id: 'c2', question: 'Which angles to keep?', answer: ['Reliability', 'Ownership'] },
    ]
    const text = body({ clarifyAnswers })
    expect(text).toContain("The candidate's positioning choices:")
    expect(text).toContain('Q: Which experience should lead? / Chose: The payments service')
    expect(text).toContain('Q: Which angles to keep? / Chose: Reliability, Ownership')
  })

  it('drops an unanswered positioning question rather than passing it off as a choice', () => {
    // A clarify question with no selection is still open — feeding it back as a settled choice
    // is the same "write around the hole" move rule 1 forbids for asks.
    const clarifyAnswers: ClarifyAnswer[] = [
      { id: 'c1', question: 'Which experience should lead?', answer: [] },
      { id: 'c2', question: 'Address the gap head-on?', answer: ['   '] },
    ]
    const text = body({ clarifyAnswers })
    expect(text).not.toContain("The candidate's positioning choices:")
    expect(text).not.toContain('Which experience should lead?')
  })

  it('never passes an unanswered question off as an answer', () => {
    const humanAnswers: AskHuman[] = [
      { question: 'Why this company?', why: 'not in the profile' },
      { question: 'Which office?', why: 'not in the profile', answer: '' },
      { question: 'Start date?', why: 'not in the profile', answer: 'March.' },
    ]
    const text = body({ humanAnswers })
    expect(text).toContain('Q: Start date?')
    expect(text).not.toContain('Why this company?')
    expect(text).not.toContain('Which office?')
  })

  it('drops the empty sections rather than sending headers with nothing under them', () => {
    const text = body()
    expect(text).not.toMatch(/voice rule/i)
    expect(text).not.toMatch(/standard answer/i)
    expect(text).not.toMatch(/A \(from the candidate\)/)
  })

  it('sends the candidate’s own telling under its exact heading, verbatim', () => {
    const story = 'The billing job kept double-charging.\nI wrote the idempotency key by hand, on a Sunday.'
    const text = body({ story })
    expect(text).toContain(
      "The candidate's own telling (use its specifics, keep its truth, raise its craft):",
    )
    // Verbatim, line breaks and all: the specifics ARE the value, and these same words are
    // the sourceSnippets behind the facts merged from it.
    expect(text).toContain(story)
  })

  it('omits the telling when there is none, rather than heading an empty section', () => {
    for (const story of [undefined, '', '   \n  ']) {
      expect(body({ story })).not.toContain("The candidate's own telling")
    }
  })

  it('puts the telling straight after the facts, where rule 9’s comparison is', () => {
    // The facts are this product's flattening of a career; the telling is what they were
    // flattened from. Read apart, rule 9 has nothing to weigh.
    const text = body({ story: 'I rewrote the billing job over one weekend.' })
    expect(text.indexOf('Candidate facts')).toBeLessThan(text.indexOf("The candidate's own telling"))
  })

  it('sends text only — there is nothing here for the model to look at', () => {
    expect(buildAnswerDraftPrompt(input()).parts.every((p) => 'text' in p)).toBe(true)
  })

  it('refuses to draft an answer to no question', () => {
    expect(() => buildAnswerDraftPrompt(input({ question: question({ q: '' }) }))).toThrow(
      /answerDraft needs a question/,
    )
    expect(() => buildAnswerDraftPrompt(input({ question: question({ q: '   ' }) }))).toThrow(
      /answerDraft needs a question/,
    )
  })
})
