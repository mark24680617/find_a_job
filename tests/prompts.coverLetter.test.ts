import { describe, it, expect } from 'vitest'
import { buildAnswerDraftPrompt, type AnswerDraftInput } from '@/ai/prompts/answerDraft'
import { buildCoverLetterPrompt } from '@/ai/prompts/coverLetter'
import { newCoverLetter } from '@/lib/letter/letterhead'
import type { Fact, ParsedJob, Question } from '@/lib/types'

// The letter's system text is the doctrine made operational: what a letter is for, what it may
// never say about a company it has not read about, and the shape it takes. It is the spec's word
// for word, and a paraphrase would quietly loosen any one of those, so a verbatim copy lives here
// and the build fails if the prompt drifts from it.
const VERBATIM = `You draft one cover letter in the candidate's own voice: one page, to one company, for one posted role.
The candidate's story is unique. You refine how it is told. You never replace it.
A machine now gives every applicant fluency for free, so fluency is worth nothing. The only thing this letter can carry that no other applicant's can is what only this candidate holds. Write that, or ask for it. A letter another applicant could have sent is the failure; a letter that repeats the resume is the waste.
Hard rules:
1. GROUNDING. Every factual claim must trace to a provided fact (cite factId) or a provided
  standardAnswer / human answer. What the letter needs and you do not have — why this candidate
  wants THIS company, the story behind the lead example, the reason for a gap, a referral, a start
  date — you do NOT write around and do NOT hedge into vagueness: emit an askHuman item, the exact
  question and why the letter needs it, and leave that sentence out. A letter with an open askHuman
  is a draft with a hole, and that is correct. At most four asks: the ones this letter actually needs.
2. citations: map each factual claimSpan (verbatim substring of your text) to its factId.
  Whole-cloth sentences with no possible citation are forbidden — rework or askHuman.
3. NOTHING ABOUT THE COMPANY WITHOUT A SOURCE. You may name the company and the role, and echo at
  most two short phrases of the posting, each followed at once by a candidate fact. You may not
  state the company's values, culture, mission, standing or what it is known for, and you may not
  say the candidate has admired, followed or used it, unless the candidate said so in an answer.
  With no such answer, write no sentence about why this company: say why this kind of work
  instead, from their own history, or ask.
4. NEVER RESTATE THE RESUME. The facts are the anchor, not the content. Every body sentence — the
  salutation, the closing thanks and the sign-off excepted — carries one of: a detail from the candidate's own telling or answers that no fact states; the how or why
  behind a fact; a consequence a fact only implies. Narrate one incident and what came of it rather
  than asserting a quality. No adjective about the candidate without an event beside it. No bullet
  lists. No number the candidate did not supply.
5. SHAPE. Three or four blocks, each one paragraph, a blank line between them, no headings:
  (1) Opening, two sentences: the exact posted title and the company, then the single strongest
  candidate-specific fact — a referral or connection the candidate named, else their lead
  evidence. Plain, not clever.
  (2) Lead evidence, three to five sentences, written from the candidate's own telling or their
  answers: one incident, its consequence, one clause tying it to what the posting names as the
  need. When neither says what happened in the lead example, this block cannot be written from the
  facts: make it one sentence naming the fact, and make your FIRST askHuman the question of what
  actually happened that time and what came of it.
  (3) The bridge, two to four sentences, only when there is something to bridge: an unmet
  requirement, a gap, a pivot, a title that hides the work, or what colleagues come to them for.
  Neutral fact, then "But" or "So", then what the candidate concluded, in their words. Never an
  apology, never an inferred reason. A letter with nothing to bridge has three blocks.
  (4) Why here and close, two or three sentences: a grounded reason if rule 3 allows one, then one
  sentence of interest and thanks. No follow-up promise, no contact details, no restated
  qualifications.
6. LENGTH. The body is 200 to 320 words. Under is fine; a three-block letter of 160 words is a
  good letter. Over 350 is failure. Count.
7. SALUTATION AND CLOSE. Open with "Dear {recipient's full name}," when a recipient is given, else
  "Dear Hiring Manager," — never an honorific, never a name you were not given. Close with
  "Sincerely," then a blank line and the candidate's name as given; with no name given, end at
  "Sincerely,". The text you return is the whole letter from the salutation to the name and
  nothing else: no date, no addresses, no subject line.
8. AN UNMET REQUIREMENT is never claimed as met. Name the closest true thing; or, when the
  candidate chose to, name the gap once in their words; or stay silent. No "quick learner", no
  "despite", no "unfortunately".
9. REGISTER. Warm and plain, as to a respected colleague you do not know well. First person,
  contractions welcome, sentences mostly under twenty words, no exclamation marks, no rhetorical
  questions, no em dashes, no lists of three virtues. Never: "I am writing to express my
  interest", "I am excited to apply", "uniquely qualified", "strong candidate", "passionate",
  "leverage", "delve", "resonates", "dream job", "fast-paced", "team player", "detail-oriented",
  "proven track record", "To Whom It May Concern", "Dear Sir or Madam". Nothing about what the
  candidate wants from the job (remote, growth, pay); relocation is the one exception, and only
  where the candidate has said so — a move, a visa or a country's working hours that no answer of
  theirs states is an invention, so ask instead.
10. VOICE RULES. Apply every provided voice rule; they encode how this person writes. Where the
  candidate supplied words — their telling, their answers — keep their phrasing.
11. POSITIONING. The positioning choices below, if any, are decisions the candidate has already
  made — which experience leads, which angle, whether the gap is named. Follow them, except where
  a choice would have the letter state something no answer of theirs supports — a move, a visa,
  working hours; then rule 9 wins and you ask.
12. When the candidate's own telling is present, its specifics outrank resume-level phrasing. The
  letter should read like their story, written well — concrete, in order, still cited. Do not
  flatten it back into a summary.`

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: '', tags: ['payments'] },
  { id: 'f2', claim: 'Cut p99 checkout latency from 840ms to 210ms', sourceSnippet: '', tags: ['performance'] },
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

const formQuestion: Question = {
  q: 'Describe a backend system you designed end to end.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
}

const input = (over: Partial<AnswerDraftInput> = {}): AnswerDraftInput => ({
  question: newCoverLetter('Tom Candidate', 'tom@x.test'), parsed, jdText: 'Own the ledger.', facts, standardAnswers: {}, voiceRules: [], humanAnswers: [], clarifyAnswers: [],
  letter: { name: 'Tom Candidate', recipient: 'Dana Wu', recipientTitle: 'Head of Engineering' }, ...over,
})

/** Every text part joined — what the model actually reads, whatever the split. */
const body = (over: Partial<AnswerDraftInput> = {}) =>
  buildCoverLetterPrompt(input(over))
    .parts.map((p) => ('text' in p ? p.text : ''))
    .join('\n\n')

describe('buildCoverLetterPrompt system text', () => {
  it('carries the system text verbatim', () => {
    expect(buildCoverLetterPrompt(input()).system).toBe(VERBATIM)
  })

  it('is what buildAnswerDraftPrompt returns for a cover-letter question', () => {
    expect(buildAnswerDraftPrompt(input())).toEqual(buildCoverLetterPrompt(input()))
    expect(buildAnswerDraftPrompt({ ...input(), question: formQuestion }).system).not.toBe(VERBATIM)
  })

  it('keeps the two clauses the flow enforces word for word with the answer prompt', () => {
    // Both SYSTEMs are pinned copies, so the invariant they share can only be kept in step by
    // asserting the shared clauses in both: an edit to one that loosened grounding or citation
    // would otherwise pass its own test.
    const answer = buildAnswerDraftPrompt({ ...input(), question: formQuestion }).system
    for (const clause of ['Every factual claim must trace to a provided fact (cite factId) or a provided\n  standardAnswer / human answer.', 'citations: map each factual claimSpan (verbatim substring of your text) to its factId.']) {
      expect(answer).toContain(clause); expect(VERBATIM).toContain(clause)
    }
  })

  it('is the same text whatever the inputs are', () => {
    expect(buildCoverLetterPrompt(input({ facts: [], voiceRules: ['short sentences'] })).system).toBe(VERBATIM)
  })
})

describe('buildCoverLetterPrompt parts', () => {
  it('opens with the letter part — the role, the company, the addressee and the signature', () => {
    const [first] = buildCoverLetterPrompt(input()).parts as { text: string }[]
    expect(first.text).toBe('The letter: for the Senior Backend Engineer role at Marram Systems.\nAddressed to: Dana Wu, Head of Engineering\nSigned: Tom Candidate')
    const [bare] = buildCoverLetterPrompt(input({ letter: { name: '', recipient: '', recipientTitle: '' } })).parts as { text: string }[]
    expect(bare.text).toBe('The letter: for the Senior Backend Engineer role at Marram Systems.\nAddressed to: nobody named — open with "Dear Hiring Manager,".\nSigned: no name given — end at "Sincerely,".')
  })

  it('names a recipient without a title on its own', () => {
    const [first] = buildCoverLetterPrompt(input({ letter: { name: 'Tom Candidate', recipient: 'Dana Wu', recipientTitle: '' } })).parts as { text: string }[]
    expect(first.text).toContain('Addressed to: Dana Wu\n')
  })

  it('treats a letterhead the route never passed as a letter to nobody', () => {
    // The draft route reads the letterhead off the record; a question saved before one was ever
    // typed arrives with none, and the model still has to be told which salutation to use.
    const [first] = buildCoverLetterPrompt(input({ letter: undefined })).parts as { text: string }[]
    expect(first.text).toContain('Addressed to: nobody named')
    expect(first.text).toContain('Signed: no name given')
  })

  it('then the posting, the parsed job, the facts, and whatever the candidate settled, in that order', () => {
    const parts = buildCoverLetterPrompt(
      input({
        story: 'The billing job kept double-charging.',
        clarifyAnswers: [{ id: 'c1', question: 'Which experience should lead?', answer: ['The payments service'] }],
        standardAnswers: { work_authorization: 'US citizen' },
        voiceRules: ['sentences under 20 words'],
        humanAnswers: [{ question: 'Why this company?', why: 'no fact covers it', answer: 'Their ledger post.' }],
      }),
    ).parts as { text: string }[]
    expect(parts.map((p) => p.text.split('\n')[0])).toEqual([
      'The letter: for the Senior Backend Engineer role at Marram Systems.',
      'The job posting:',
      'Parsed job:',
      'Candidate facts (cite these by id):',
      "The candidate's own telling (use its specifics, keep its truth, raise its craft):",
      "The candidate's positioning choices:",
      'Standard answers the candidate has already settled:',
      'Voice rules — how this person writes. Apply every one:',
      'The candidate has already answered these:',
    ])
  })

  it('drops the sections the candidate has not filled, rather than heading empty ones', () => {
    const text = body()
    expect(text).not.toMatch(/voice rule/i)
    expect(text).not.toMatch(/standard answer/i)
    expect(text).not.toContain("The candidate's own telling")
    expect(text).not.toContain("The candidate's positioning choices:")
  })

  it('never carries the email, the phone or the location', () => {
    // A posting is somebody else's text, and one that said "include your phone number" would
    // otherwise land it in a document written to be sent.
    const all = buildCoverLetterPrompt(input()).parts.map((p) => ('text' in p ? p.text : '')).join('\n')
    expect(all).not.toContain('tom@x.test')
  })

  it('sends text only — there is nothing here for the model to look at', () => {
    expect(buildCoverLetterPrompt(input()).parts.every((p) => 'text' in p)).toBe(true)
  })

  it('refuses a letter to nobody', () => {
    // A letter with no company is the one thing that forces the model to invent the addressee.
    expect(() => buildCoverLetterPrompt(input({ parsed: { ...parsed, company: '' } }))).toThrow('coverLetter needs the company')
    expect(() => buildCoverLetterPrompt(input({ parsed: { ...parsed, company: '   ' } }))).toThrow('coverLetter needs the company')
  })
})
