/**
 * The coverLetter prompt: the same candidate, posting and facts the answer prompt reads, and a
 * different set of instructions for the one document in an application the resume cannot stand
 * in for. The system text below is the design spec's, word for word — it is where the doctrine
 * (`docs/notes/cover-letter-doctrine.md`) is stated to the model: that fluency is now free and
 * therefore worth nothing, that nothing may be said about the company without a source, and
 * that a gap is bridged in the candidate's own words or not at all. `tests/prompts.coverLetter.test.ts`
 * holds a copy that fails the build if this one drifts.
 *
 * A second SYSTEM rather than a branch inside the answer prompt's: that string is pinned by its
 * own test and governs every other answer in the product, and a letter rule added there would
 * change all of them. Its rules 4 (scope) and 7 (one spine) are deliberately absent here — a
 * cover letter is always per-application, so it names the company and reads the posting, which
 * is exactly what a per-profile answer may not do, and it takes the two or three beats a letter
 * needs rather than one. The part builders are imported from the answer prompt rather than
 * copied: the two prompts differ in what they instruct, not in what they are given.
 */
import {
  factsPart,
  humanAnswersPart,
  jobPart,
  jobPostingPart,
  positioningChoicesPart,
  standardAnswersPart,
  storyPart,
  todayPart,
  voiceRulesPart,
  type AnswerDraftInput,
} from '@/ai/prompts/answerDraft'
import type { Part } from '@/ai/genkit'

const SYSTEM = `You draft one cover letter in the candidate's own voice: one page, to one company, for one posted role.
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

/**
 * Who the letter is for, who it is to and who signs it — the three letterhead fields rule 7 is
 * judged on. The absent forms are spelled out rather than left off: told nothing about the
 * addressee the model invents one, and "Dear Ms. Wu" to a Dana Wu nobody titled is the mistake
 * this document cannot survive. Email, phone and location are typeset by the layout and never
 * appear here (spec §4.1).
 */
function letterPart(
  parsed: AnswerDraftInput['parsed'],
  letter: AnswerDraftInput['letter'],
): string {
  const recipient = letter?.recipient.trim() ?? ''
  const title = letter?.recipientTitle.trim() ?? ''
  const name = letter?.name.trim() ?? ''
  return [
    `The letter: for the ${parsed.role} role at ${parsed.company}.`,
    recipient
      ? `Addressed to: ${recipient}${title ? `, ${title}` : ''}`
      : 'Addressed to: nobody named — open with "Dear Hiring Manager,".',
    name ? `Signed: ${name}` : 'Signed: no name given — end at "Sincerely,".',
  ].join('\n')
}

/**
 * The letter first — it names the role, the company and the addressee, and every other section
 * is read through it — then the posting, the parsed job, today's date, the facts, and whatever the
 * candidate has settled. Empty sections are dropped rather than sent as bare headers, as they are
 * for an answer. A blank company is refused: a letter to nobody is the one situation that forces
 * the model to invent the addressee, and it is the addressee that makes this a letter at all.
 */
export function buildCoverLetterPrompt(input: AnswerDraftInput): {
  system: string
  parts: Part[]
} {
  if (!input.parsed.company.trim()) throw new Error('coverLetter needs the company')
  const sections = [
    letterPart(input.parsed, input.letter),
    jobPostingPart(input.jdText),
    jobPart(input.parsed),
    todayPart(input.today),
    factsPart(input.facts),
    storyPart(input.story),
    positioningChoicesPart(input.clarifyAnswers),
    standardAnswersPart(input.standardAnswers),
    voiceRulesPart(input.voiceRules),
    humanAnswersPart(input.humanAnswers),
  ]
  return { system: SYSTEM, parts: sections.filter((s) => s !== null).map((text) => ({ text })) }
}
