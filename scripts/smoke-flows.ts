/**
 * Live smoke for one flow: runs it against the real model and prints what came back.
 *
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts profileIngest tests/fixtures/tom-resume.txt
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts jobInterpret
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts formParse text
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts formParse image
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts answerDraft
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts clarifyDraft
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts feedbackDistill
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts story
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts interview
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts reconcile
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts process "<company>" "<role>"
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts brief <process-transcript.txt> [stageOrder]
 * npx tsx --env-file=.env.local scripts/smoke-flows.ts mock <process-transcript.txt> [stageOrder]
 *
 * This spends a real API call, so it is a thing you run deliberately — the unit suite
 * never touches the network. `--env-file` is what supplies GEMINI_API_KEY.
 *
 * No top-level await: tsx compiles this to CJS, where it is a syntax error.
 */
import { readFileSync } from 'node:fs'
import { parseAshby } from '../src/adapters/ashby'
import { runProfileIngest } from '../src/ai/flows/profileIngest'
import { runJobInterpret } from '../src/ai/flows/jobInterpret'
import { runFormParse } from '../src/ai/flows/formParse'
import { runAnswerDraft } from '../src/ai/flows/answerDraft'
import { runClarifyDraft } from '../src/ai/flows/clarifyDraft'
import { runFeedbackDistill } from '../src/ai/flows/feedbackDistill'
import { runInterviewInterpret } from '../src/ai/flows/interviewInterpret'
import { runReconcileFacts } from '../src/ai/flows/reconcileFacts'
import { runPrepBrief } from '../src/ai/flows/prepBrief'
import { runMockTurn } from '../src/ai/flows/mockTurn'
import { runMockDebrief } from '../src/ai/flows/mockDebrief'
import { describeStage } from '../src/ai/prompts/mockTurn'
import { mergeStory } from '../src/lib/profileMerge'
import { researchProcess, type GatherTrace } from '../src/lib/research/pipeline'
import {
  placeRound,
  practiceMode,
  reportedQuestions,
  type ReportedQuestion,
  type StagePlacement,
} from '../src/lib/practice'
import { normalizeWs } from '../src/lib/research/quotes'
import { roleFamily } from '../src/lib/research/roleFamily'
import type {
  AnswerDraftOut,
  ClarifyDraftOut,
  FeedbackDistillOut,
  FormParseOut,
  InterviewInterpretOut,
  JobInterpretOut,
  MockDebriefOut,
  MockTurnOut,
  ProfileIngestOut,
  ReconcileOut,
} from '../src/ai/schemas'
import { countUnits } from '../src/lib/countText'
import type {
  ClarifyAnswer,
  Fact,
  InterviewRound,
  MockTurn,
  ParsedJob,
  PracticeMode,
  PrepBrief,
  ProcessMap,
  ProcessStage,
  Profile,
  Question,
  RoundType,
} from '../src/lib/types'

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * The one thing worth checking mechanically: a fact whose sourceSnippet is not actually
 * in the input is a fabricated fact, which is the failure this whole product exists to
 * avoid. Whitespace is normalised on both sides — a model re-wrapping a line is fine.
 */
function report(out: ProfileIngestOut, input: string): void {
  const haystack = collapse(input)
  let grounded = 0

  console.log(`\nfacts (${out.facts.length})`)
  for (const fact of out.facts) {
    const snippet = collapse(fact.sourceSnippet)
    const found = snippet !== '' && haystack.includes(snippet)
    if (found) grounded += 1
    console.log(`  ${fact.id}  [${fact.tags.join(', ')}] ${fact.claim}`)
    const verdict = found ? 'source ok' : 'SOURCE NOT IN INPUT'
    console.log(`      ${verdict}: ${JSON.stringify(fact.sourceSnippet)}`)
  }

  console.log('\nstandardAnswers')
  for (const [key, value] of Object.entries(out.standardAnswers)) {
    console.log(`  ${key}: ${value}`)
  }

  console.log(`\ngaps (${out.gaps.length})`)
  for (const gap of out.gaps) console.log(`  - ${gap}`)

  console.log(`\n${grounded}/${out.facts.length} facts carry a snippet found verbatim in the input`)
}

// Tom Candidate as a profile would hold him — the salient claims from tests/fixtures/
// tom-resume.txt, not the whole document. He is a backend engineer, and the fixture posting
// is a defence-sector sales role in Canada, so the gates land squarely on facts he lacks:
// that mismatch is the point, it exercises the met/posture/advisory path with something to
// decide. Running profileIngest for real facts would cost a second call this smoke skips.
const TOM_FACTS: Fact[] = [
  { id: 'f1', claim: 'Senior Backend Engineer at Northwind Logistics since March 2024', sourceSnippet: '', tags: ['backend'] },
  { id: 'f2', claim: 'Owns a payments service handling 12,000 requests/day at 99.95% success', sourceSnippet: '', tags: ['payments'] },
  { id: 'f3', claim: 'Cut p99 checkout latency from 840ms to 210ms by batching ledger writes', sourceSnippet: '', tags: ['performance'] },
  { id: 'f4', claim: 'Led the migration of 14 services from RabbitMQ to Kafka', sourceSnippet: '', tags: ['infra'] },
  { id: 'f5', claim: 'Backend Engineer at Fenwick Software, June 2020 to November 2022', sourceSnippet: '', tags: ['backend'] },
  { id: 'f6', claim: 'B.S. Computer Science, Cascadia State University, 2020', sourceSnippet: '', tags: ['education'] },
  { id: 'f7', claim: 'Works in Go, Python, PostgreSQL, Kafka, Terraform, gRPC, AWS', sourceSnippet: '', tags: ['skills'] },
  { id: 'f8', claim: 'Based in Portland, Oregon; English native, Portuguese conversational', sourceSnippet: '', tags: ['location'] },
]

const ASHBY_FIXTURE = new URL('../tests/fixtures/ashby.json', import.meta.url)
const ASHBY_JOB_ID = 'deae2da1-6f6a-40ed-b64e-6596775a5473'

const POSTURES = new Set(['escape-clause', 'explicit', 'silent'])

/**
 * The two things worth checking mechanically. Every gate must carry one of the three
 * posture labels — an unlabelled gate is a gate the UI cannot render as a decision. And the
 * advisory must be present exactly when a gate is genuinely unmet (met=no, posture explicit
 * or silent): a missing advisory there hides a skip, and a stray one on a clean role is noise.
 */
function reportJob(out: JobInterpretOut): void {
  console.log(`\ncompany: ${out.company}`)
  console.log(`role: ${out.role}`)

  console.log(`\nroleFacts (${out.roleFacts.length})`)
  for (const fact of out.roleFacts) console.log(`  - ${fact}`)

  let allLabelled = true
  console.log(`\ngates (${out.gates.length})`)
  for (const gate of out.gates) {
    if (!POSTURES.has(gate.posture)) allLabelled = false
    const label = POSTURES.has(gate.posture) ? gate.posture : `UNLABELLED(${gate.posture})`
    console.log(`  [met=${gate.met}, ${label}] ${gate.requirement}`)
    console.log(`      note: ${JSON.stringify(gate.note)}`)
  }

  console.log(`\nthemes: ${out.themes.join(', ')}`)
  console.log(`scope: ${out.scope}`)
  console.log(`\nadvisory: ${out.advisory.trim() ? JSON.stringify(out.advisory) : '(none)'}`)

  const unmet = out.gates.some(
    (g) => g.met === 'no' && (g.posture === 'explicit' || g.posture === 'silent'),
  )
  const hasAdvisory = out.advisory.trim() !== ''
  console.log('\nchecks')
  console.log(`  every gate carries a posture label: ${allLabelled ? 'ok' : 'FAILED'}`)
  console.log(
    `  advisory present iff a gate is unmet: ${unmet === hasAdvisory ? 'ok' : 'FAILED'}` +
      ` (unmet=${unmet}, advisory=${hasAdvisory})`,
  )
}

const FORM_TEXT_FIXTURE = new URL('../tests/fixtures/form-questions.txt', import.meta.url)
// A real, public Ashby application form (TRM Labs, the same posting the jobInterpret smoke
// uses), captured blank at 1080x1400 — one screenful, which is what a user actually
// screenshots. The slice is chosen for the contrast the prompt exists to read: "Search
// Motivation: Please describe the reason for your selection" is a single-line input while
// "Describe the fastest #1 measurable outcome…" is a textarea, and neither states a limit.
const FORM_IMAGE_FIXTURE = new URL('../tests/fixtures/form-screenshot.png', import.meta.url)

/**
 * The two things worth checking mechanically. A limit must carry a unit and a unit a limit
 * — half a constraint renders as nothing the writer can aim at. And when the form arrived
 * as text, every limit the model reports has to appear in that text: a limit that is not
 * in the form is an invented one, which is exactly what this prompt is written to prevent.
 * A screenshot cannot be checked that way, so those lines print for the eye instead.
 */
function reportForm(out: FormParseOut, input?: string): void {
  console.log(`\nquestions (${out.questions.length})`)
  let pairsOk = true
  let grounded = true

  for (const { q, constraints } of out.questions) {
    const { limit, unit, type, required } = constraints
    const shown = limit === undefined && unit === undefined ? 'no limit' : `${limit} ${unit}`
    console.log(`  [${type}${required ? ', required' : ''}] ${q}`)
    console.log(`      limit: ${shown}`)
    if ((limit === undefined) !== (unit === undefined)) {
      pairsOk = false
      console.log('      HALF A CONSTRAINT: a limit and a unit only mean something together')
    }
    if (input && limit !== undefined && !input.includes(String(limit))) {
      grounded = false
      console.log(`      LIMIT NOT IN THE FORM: ${limit} appears nowhere in the pasted text`)
    }
  }

  console.log(`\nscope: ${out.scope}`)
  console.log(`scopeEvidence: ${JSON.stringify(out.scopeEvidence)}`)

  console.log('\nchecks')
  console.log(`  every limit carries a unit: ${pairsOk ? 'ok' : 'FAILED'}`)
  console.log(`  scopeEvidence is not empty: ${out.scopeEvidence.trim() ? 'ok' : 'FAILED'}`)
  if (input) {
    console.log(`  every limit appears in the form: ${grounded ? 'ok' : 'FAILED'}`)
    // The evidence usually stitches two places in the form together, joined by whatever
    // punctuation the model reached for ("A ... B", "A; B"), so it is split on those and
    // each fragment checked on its own. Splitting can only make the check more permissive
    // about the joins, never about the words: every piece still has to be in the form.
    const haystack = collapse(input)
    const quoted = out.scopeEvidence
      .split(/\s*(?:\.\.\.|…|;|\n)\s*/)
      .map(collapse)
      .filter((fragment) => fragment.length > 12)
      .every((fragment) => haystack.includes(fragment))
    console.log(`  scopeEvidence quoted from the form: ${quoted ? 'ok' : 'NOT IN INPUT'}`)
  }
}

// The other half of the form fixture: the same Marram Systems posting, as jobInterpret would
// have parsed it. Written out rather than produced by a second live call — this smoke is
// about the draft, and one flow per run keeps what failed unambiguous. scope is
// "per-application", so rule 4's per-profile prohibitions are deliberately NOT in force here.
const MARRAM: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: [
    'Remote within the UK, with UK working hours',
    'Owns the ledger and settlement services',
    'Go and PostgreSQL, moving to event-driven ingest',
  ],
  gates: [
    { requirement: 'Legally authorised to work in the United Kingdom', met: 'no', posture: 'explicit', note: 'Are you legally authorised to work in the United Kingdom?' },
    { requirement: '5+ years backend experience', met: 'yes', posture: 'explicit', note: 'Minimum 5 years building backend services' },
  ],
  themes: ['payments', 'performance', 'infra'],
  scope: 'per-application',
  advisory: 'Skip unless UK authorisation is obtainable: the requirement is explicit.',
}

// The raw posting behind MARRAM — rule 8 reads the role's real screens from this. Short and
// synthesised, since Marram is a fictional posting; enough for the draft to match against.
const MARRAM_JD = `Senior Backend Engineer — Marram Systems
Remote within the UK, UK working hours. You will own the ledger and settlement services:
correctness under load, clean failure, and the move to event-driven ingest. Go and
PostgreSQL. We care about people who have carried a payments or ledger system in production.
Minimum 5 years building backend services. Must be legally authorised to work in the UK.`

// Straight off tests/fixtures/form-questions.txt, except for the limit: the form says 250
// words and this asks for 100, because a tight limit is where the guard earns its keep.
const MARRAM_QUESTION: Question = {
  q: 'Describe a backend system you designed end to end, and what you would change about it today.',
  constraints: { limit: 100, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
}

const TOM_STANDARD_ANSWERS: Record<string, string> = {
  work_authorization: 'US citizen, authorised to work in the United States',
  visa_sponsorship_needed: 'UNKNOWN',
  relocation: 'UNKNOWN',
  remote_onsite_preference: 'Remote',
  earliest_start_date: 'UNKNOWN',
  notice_period: 'UNKNOWN',
  salary_expectation: 'UNKNOWN',
  security_clearance: 'UNKNOWN',
}

const TOM_VOICE_RULES = [
  'Starts with the fact, not with an opener',
  'Replaces adjectives with the number behind them',
  'Keeps sentences under 20 words',
]

/**
 * The three checks that ARE the product. A claimSpan the UI cannot find in the text renders
 * as no underline at all, so an uncited claim reads as a cited one. A factId naming no fact
 * is a citation that leads nowhere — worse than none, because it looks verified. And a limit
 * is the one number an application form enforces on the candidate's behalf. The flow already
 * guards all three; this is the check that the guard is checking the real thing.
 */
function reportDraft(out: AnswerDraftOut, question: Question, facts: Fact[]): void {
  console.log(`\nanswer:\n${out.text}\n`)

  const { limit, unit } = question.constraints
  const count = limit !== undefined && unit !== undefined ? countUnits(out.text, unit) : undefined

  console.log(`citations (${out.citations.length})`)
  const known = new Map(facts.map((f) => [f.id, f.claim]))
  let spansOk = true
  let idsOk = true
  for (const { claimSpan, factId } of out.citations) {
    const inText = out.text.includes(claimSpan)
    const real = known.has(factId)
    if (!inText) spansOk = false
    if (!real) idsOk = false
    console.log(`  ${factId} -> ${JSON.stringify(claimSpan)}`)
    console.log(`      span in the answer: ${inText ? 'ok' : 'NOT IN THE ANSWER'}`)
    console.log(`      fact: ${real ? known.get(factId) : 'NO SUCH FACT'}`)
  }

  console.log(`\naskHuman (${out.askHuman.length})`)
  for (const ask of out.askHuman) console.log(`  ${ask.question}\n      why: ${ask.why}`)

  console.log('\nchecks')
  console.log(`  every claimSpan is verbatim in the answer: ${spansOk ? 'ok' : 'FAILED'}`)
  console.log(`  every factId names a provided fact: ${idsOk ? 'ok' : 'FAILED'}`)
  if (count !== undefined) {
    console.log(`  within the limit: ${count <= limit! ? 'ok' : 'FAILED'} (${count}/${limit} ${unit})`)
  }
  console.log(`  something is cited or something is asked: ${out.citations.length + out.askHuman.length > 0 ? 'ok' : 'FAILED'}`)
}

async function smokeAnswerDraft(): Promise<void> {
  console.log(
    `answerDraft: "${MARRAM_QUESTION.q}" (${MARRAM_QUESTION.constraints.limit} ${MARRAM_QUESTION.constraints.unit} max)` +
      ` x ${TOM_FACTS.length} facts`,
  )
  const out = await runAnswerDraft({
    question: MARRAM_QUESTION,
    parsed: MARRAM,
    jdText: MARRAM_JD,
    facts: TOM_FACTS,
    standardAnswers: TOM_STANDARD_ANSWERS,
    voiceRules: TOM_VOICE_RULES,
    humanAnswers: [],
    clarifyAnswers: [],
  })
  reportDraft(out, MARRAM_QUESTION, TOM_FACTS)
}

// A draft loaded with the two things a voice edit strips — openers ("I am excited to…") and
// adjectives standing in for numbers ("amazing, blazing-fast") — and the human's edit that
// cuts both and puts the figures back. The two known rules are unrelated, so a good run
// learns a NEW rule (about openers or about numbers) rather than restating either.
const FEEDBACK_DRAFT =
  'I am really excited to say that I am deeply passionate about backend systems, and I would ' +
  'love the chance to bring my skills to your team. I built an amazing, blazing-fast payments ' +
  'service that handled a huge amount of traffic every single day with incredible reliability.'
const FEEDBACK_FINAL =
  'I own a payments service handling 12,000 requests a day at 99.95% success. I cut p99 ' +
  'checkout latency from 840ms to 210ms by batching ledger writes.'
const FEEDBACK_EXISTING = ['Keeps sentences under 20 words', 'Never uses the word "synergy"']

/**
 * The two things worth checking mechanically. A rule with no evidence is a claim the profile
 * editor cannot trace back to the edit it came from, and an empty rule string is nothing a
 * future draft can follow. The schema already caps the list at three; this run exists to see
 * that an edit which plainly cuts openers and swaps adjectives for numbers yields at least
 * one sensible, evidenced rule rather than none.
 */
function reportFeedback(out: FeedbackDistillOut): void {
  console.log(`\nrules (${out.rules.length})`)
  let evidenced = true
  for (const { rule, evidence } of out.rules) {
    if (!rule.trim() || !evidence.trim()) evidenced = false
    console.log(`  - ${rule}`)
    console.log(`      evidence: ${JSON.stringify(evidence)}`)
  }

  console.log('\nchecks')
  console.log(`  at least one rule was learned: ${out.rules.length >= 1 ? 'ok' : 'NONE LEARNED'}`)
  console.log(`  no more than three rules: ${out.rules.length <= 3 ? 'ok' : 'FAILED'}`)
  console.log(`  every rule carries rule text and evidence: ${evidenced ? 'ok' : 'FAILED'}`)
}

async function smokeFeedbackDistill(): Promise<void> {
  console.log(
    `feedbackDistill: a ${FEEDBACK_DRAFT.length}-char draft vs a ${FEEDBACK_FINAL.length}-char` +
      ` human edit that cut the openers and adjectives`,
  )
  reportFeedback(
    await runFeedbackDistill({
      draft: FEEDBACK_DRAFT,
      final: FEEDBACK_FINAL,
      existingRules: FEEDBACK_EXISTING,
    }),
  )
}

async function smokeFormParse(mode: string): Promise<void> {
  if (mode === 'image') {
    const base64 = readFileSync(FORM_IMAGE_FIXTURE).toString('base64')
    console.log(`formParse: screenshot of an Ashby form (${base64.length} base64 chars)`)
    reportForm(await runFormParse({ images: [{ base64, mime: 'image/png' }] }))
    return
  }
  const text = readFileSync(FORM_TEXT_FIXTURE, 'utf8')
  console.log(`formParse: pasted form text (${text.length} chars)`)
  reportForm(await runFormParse({ text, images: [] }), text)
}

async function smokeProfileIngest(file: string): Promise<void> {
  const input = readFileSync(file, 'utf8')
  console.log(`profileIngest: ${file} (${input.length} chars)`)
  report(await runProfileIngest({ pastedText: input }), input)
}

async function smokeJobInterpret(): Promise<void> {
  const board: unknown = JSON.parse(readFileSync(ASHBY_FIXTURE, 'utf8'))
  const { jdText } = parseAshby(board, ASHBY_JOB_ID)
  console.log(`jobInterpret: recorded Ashby posting (${jdText.length} chars) x ${TOM_FACTS.length} facts`)
  reportJob(await runJobInterpret({ jdText, facts: TOM_FACTS }))
}

// ---- clarifyDraft: the depth fix -----------------------------------------------------
// A founding-product-engineer role and a candidate who could lead the answer from several
// different strengths — which is exactly what the clarify step exists to resolve before the
// draft is written. Everything here is fictional: no real person, company, or project, and
// no PII. The candidate is a Mark-style founder/product engineer (iOS + WebGL + on-device AI,
// a video-platform backend internship, a UN exhibition) — a profile deep enough that a draft
// which merely lists it reads very differently from one that positions it for THIS role.

const FOUNDING_ENGINEER_JD = `Founding Product Engineer — Lumen Learning

We are building an AI tutor that meets each student where they are. As one of our first
engineers you will own features end to end: designing the interaction, building the iOS and
web clients, and wiring them to our model layer. We want people who ship fast, sweat the
interaction detail, and can reason about how a model behaves in a product — not just call an
API. You will work directly with the founders and talk to students every week.

What we look for: strong product instinct; comfort across the stack — mobile, web, and
backend; real experience putting AI/ML into something people actually use; a bias to ship.
Nice to have: graphics or rendering work; having founded or led a project of your own.`

// Fictional, Mark-style. No sourceSnippet — this smoke is about the draft, not ingest.
const MARK_FACTS: Fact[] = [
  { id: 'f1', claim: 'Founded and shipped Prism, an iOS app pairing on-device AI with a WebGL canvas, to 4,200 weekly active users, solo', sourceSnippet: '', tags: ['founder', 'product', 'ai'] },
  { id: 'f2', claim: 'Built the Prism rendering pipeline in Metal and WebGL, holding 60fps on a three-year-old iPhone', sourceSnippet: '', tags: ['graphics', 'performance'] },
  { id: 'f3', claim: 'Backend engineering intern at a large video-streaming platform, owned a recommendation-ranking service behind 30M requests/day', sourceSnippet: '', tags: ['backend', 'scale'] },
  { id: 'f4', claim: 'Built an AI writing assistant that reached #3 of the day in its category on a product-launch site', sourceSnippet: '', tags: ['ai', 'product'] },
  { id: 'f5', claim: 'Exhibited an interactive generative-art installation at a United Nations cultural event', sourceSnippet: '', tags: ['graphics', 'art'] },
  { id: 'f6', claim: 'Ships end to end: product design, Swift/SwiftUI frontend, Node backend, and the model-inference layer', sourceSnippet: '', tags: ['fullstack'] },
  { id: 'f7', claim: 'Works in Swift, TypeScript, Python, WebGL/Three.js and Metal; fine-tunes small models to run on device', sourceSnippet: '', tags: ['skills', 'ai'] },
  { id: 'f8', claim: 'Studies computer science and leads a six-person student build club shipping one app a month', sourceSnippet: '', tags: ['leadership', 'education'] },
]

const FOUNDING_ENGINEER: ParsedJob = {
  company: 'Lumen Learning',
  role: 'Founding Product Engineer',
  roleFacts: [
    'One of the first engineers; owns features end to end',
    'iOS and web clients wired to a model layer',
    'Works directly with founders; talks to students weekly',
  ],
  gates: [],
  themes: ['ai-in-product', 'full-stack', 'founder', 'graphics'],
  scope: 'per-application',
  advisory: '',
}

const COVER_LETTER_QUESTION: Question = {
  q: 'Why do you want to join Lumen, and what makes you a fit? Write a short cover letter.',
  constraints: { limit: 250, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
}

const MARK_STANDARD_ANSWERS: Record<string, string> = {
  work_authorization: 'Authorised to work; open to relocation',
  remote_onsite_preference: 'Either, leaning in-person for a founding role',
  earliest_start_date: 'UNKNOWN',
  salary_expectation: 'UNKNOWN',
}

const MARK_VOICE_RULES = [
  'Starts with the fact, not with an opener',
  'Replaces adjectives with the number behind them',
  'Keeps sentences short',
]

/**
 * Prints the positioning round and checks the one thing that is not a shape: every
 * recommended option is a real option. Returns the recommended choice for each question as a
 * ClarifyAnswer, which is what a human who accepted every default would send back — the input
 * the WITH-positioning draft then runs on.
 */
function reportClarify(out: ClarifyDraftOut): ClarifyAnswer[] {
  console.log(`\nclarify questions (${out.questions.length})`)
  let recommendedOk = true
  const chosen: ClarifyAnswer[] = []

  for (const q of out.questions) {
    const values = new Set(q.options.map((o) => o.value))
    const real = values.has(q.recommended)
    if (!real) recommendedOk = false
    console.log(`\n  ${q.id}  ${q.question}`)
    console.log(`      why: ${q.why}`)
    console.log(`      multiple: ${q.allowMultiple}  other: ${q.allowOther}`)
    for (const o of q.options) {
      const mark = o.value === q.recommended ? ' ← recommended' : ''
      console.log(`      - [${o.value}] ${o.label}${mark}`)
    }
    if (!real) console.log(`      RECOMMENDED NOT AN OPTION: ${JSON.stringify(q.recommended)}`)
    chosen.push({ id: q.id, question: q.question, answer: [q.recommended] })
  }

  console.log('\nchecks')
  console.log(`  1 to 4 questions returned: ${out.questions.length >= 1 && out.questions.length <= 4 ? 'ok' : 'FAILED'} (${out.questions.length})`)
  console.log(`  every recommended option is a real option: ${recommendedOk ? 'ok' : 'FAILED'}`)
  return chosen
}

async function smokeClarifyDraft(): Promise<void> {
  console.log(
    `clarifyDraft: "${COVER_LETTER_QUESTION.q}" for ${FOUNDING_ENGINEER.role} @ ${FOUNDING_ENGINEER.company}` +
      ` x ${MARK_FACTS.length} facts`,
  )
  const clarify = await runClarifyDraft({
    question: COVER_LETTER_QUESTION,
    jdText: FOUNDING_ENGINEER_JD,
    facts: MARK_FACTS,
    standardAnswers: MARK_STANDARD_ANSWERS,
    clarifyAnswers: [],
  })
  const chosen = reportClarify(clarify)

  const drive = (clarifyAnswers: ClarifyAnswer[]) =>
    runAnswerDraft({
      question: COVER_LETTER_QUESTION,
      parsed: FOUNDING_ENGINEER,
      jdText: FOUNDING_ENGINEER_JD,
      facts: MARK_FACTS,
      standardAnswers: MARK_STANDARD_ANSWERS,
      voiceRules: MARK_VOICE_RULES,
      humanAnswers: [],
      clarifyAnswers,
    })

  console.log('\n\n=== draft WITHOUT positioning (the shallow path) ===')
  reportDraft(await drive([]), COVER_LETTER_QUESTION, MARK_FACTS)

  console.log('\n\n=== draft WITH the recommended positioning (the deep path) ===')
  console.log('chose: ' + chosen.map((c) => `${c.id}=${c.answer.join('/')}`).join(', '))
  reportDraft(await drive(chosen), COVER_LETTER_QUESTION, MARK_FACTS)
}

/**
 * The story behind one answer, as somebody would actually type it: rough, out of order, with
 * the numbers in it because they remember them. Fictional. Deliberately about an incident the
 * fact bank below does NOT contain — the whole question is whether the second draft can say
 * things the first one had no way to know.
 */
const LAUNCH_STORY = `Prism's launch week nearly killed it. The launch post went up on a Tuesday and by lunchtime the on-device model was crashing about every third session on older phones — I watched the crash-free rate fall from 99% to 71% and could not reproduce it once on my own device. It turned out the WebGL canvas and the model were each holding their own copy of a Metal texture, and the memory ceiling on an iPhone 11 was a lot lower than I had assumed. I spent two nights rewriting the texture pool so they share one allocation, shipped 1.2.1 on the Thursday, and crash-free was back to 99.4% by Friday. Around 900 of the people who bounced that week came back over the weekend, and I have watched that number before every release since.`

const STORY_QUESTION: Question = {
  q: 'Tell us about a time something you shipped broke in front of users. What did you do?',
  constraints: { limit: 200, unit: 'words', type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
}

/**
 * Task 28 end to end, and the only check that matters is a reading one: the SAME question
 * drafted twice, once from the fact bank alone and once after the candidate tells the story
 * behind it. In between, the telling goes through the real ingest and the real merge — so the
 * second draft is citing fact ids that did not exist when the first one ran, with snippets
 * that are the candidate's own words.
 *
 * Three model calls. Run it when the answer-side behaviour is what is in doubt.
 */
async function smokeStory(): Promise<void> {
  const stored: Profile = {
    facts: MARK_FACTS,
    standardAnswers: MARK_STANDARD_ANSWERS,
    voiceRules: MARK_VOICE_RULES.map((rule) => ({ rule, evidence: '', createdAt: '2026-08-01T00:00:00.000Z' })),
    gaps: ['no dates on the build club', 'no link to the UN installation'],
  }

  const drive = (facts: Fact[], story?: string) =>
    runAnswerDraft({
      question: STORY_QUESTION,
      parsed: FOUNDING_ENGINEER,
      jdText: FOUNDING_ENGINEER_JD,
      facts,
      standardAnswers: stored.standardAnswers,
      voiceRules: MARK_VOICE_RULES,
      humanAnswers: [],
      clarifyAnswers: [],
      story,
    })

  console.log(`story: "${STORY_QUESTION.q}" (${STORY_QUESTION.constraints.limit} words max)`)

  console.log('\n\n=== BEFORE — drafted from the fact bank alone ===')
  reportDraft(await drive(stored.facts), STORY_QUESTION, stored.facts)

  console.log('\n\n=== the telling, run through profileIngest ===')
  console.log(LAUNCH_STORY)
  const ingested = await runProfileIngest({ pastedText: LAUNCH_STORY })
  report(ingested, LAUNCH_STORY)

  const merged = mergeStory(stored, ingested)
  const learned = merged.facts.slice(stored.facts.length)
  console.log(`\nmerged: ${stored.facts.length} facts -> ${merged.facts.length} (${learned.length} new)`)
  for (const fact of learned) console.log(`  ${fact.id}: ${fact.claim}`)
  console.log(`  gaps kept: ${JSON.stringify(merged.gaps)}`)
  console.log(
    `  existing ids untouched: ${merged.facts.slice(0, stored.facts.length).every((f, i) => f.id === stored.facts[i].id) ? 'ok' : 'FAILED'}`,
  )

  console.log('\n\n=== AFTER — drafted with the telling, against the profile it just grew ===')
  const after = await drive(merged.facts, LAUNCH_STORY)
  reportDraft(after, STORY_QUESTION, merged.facts)

  const newIds = new Set(learned.map((f) => f.id))
  const onNew = after.citations.filter((c) => newIds.has(c.factId))
  console.log(`\n  citations onto facts learned from the story: ${onNew.length}/${after.citations.length}`)
  for (const c of onNew) console.log(`    ${c.factId} -> ${JSON.stringify(c.claimSpan)}`)
}


// ---- interview: the notice, then the brief written for the round it turned out to be -----
// A fictional notice, written the way a recruiter actually writes one: a relative date ("next
// Thursday") and no year, which is the case the prompt exists to refuse. A round type is
// inferable from it; a calendar date is not.
const INTERVIEW_NOTICE = `Hi Tom — thanks for your application. I would like to set up a 30-min
call with our recruiter Ana Reyes next Thursday at 2pm PT. We will cover your background and
the role. Let me know if that works and I will send an invite.

Ana Reyes
Recruiting, Marram Systems`

/**
 * The one thing worth checking mechanically on the notice: a relative date is not a date. The
 * notice above says "next Thursday" and nothing else, so either `datetime` is null and an
 * askHuman entry says which Thursday, or the model has invented a date on somebody's calendar.
 */
function reportInterview(out: InterviewInterpretOut): void {
  console.log(`\nroundType: ${out.roundType}`)
  console.log(`datetime: ${out.datetime ?? '(null — not stated)'}`)
  console.log(`people: ${out.people.join(', ') || '(none named)'}`)

  console.log(`\naskHuman (${out.askHuman.length})`)
  for (const ask of out.askHuman) console.log(`  ${ask.question}\n      why: ${ask.why}`)

  console.log('\nchecks')
  console.log(`  read as a recruiter screen: ${out.roundType === 'recruiter-screen' ? 'ok' : `NO (${out.roundType})`}`)
  console.log(`  no date invented from "next Thursday": ${out.datetime === null ? 'ok' : `INVENTED (${out.datetime})`}`)
  console.log(`  something was asked rather than guessed: ${out.askHuman.length > 0 ? 'ok' : 'NOTHING ASKED'}`)
}

/**
 * The brief's own claim, checked: five sections, none of them empty, and every angle and
 * rehearsal line traceable to a fact that was actually provided. An angle naming no fact id is
 * the failure this prompt is written to prevent — a brief that invents an experience for the
 * candidate to tell is worse than no brief. A citation is the second such claim: `citeReported`
 * has already dropped anything that did not check out, so the two citation lines below are the
 * guard's receipt — a NOT here means the guard did not run, not that the model misbehaved.
 */
function reportBrief(
  out: Omit<PrepBrief, 'basis'>,
  facts: Fact[],
  reported: ReportedQuestion[] = [],
): void {
  console.log(`\nlikelyTopics (${out.likelyTopics.length})`)
  for (const t of out.likelyTopics) console.log(`  - ${t}`)

  console.log(`\nquestionsToPrepare (${out.questionsToPrepare.length})`)
  let cited = 0
  let wordForWord = 0
  for (const { q, angle, sourceId } of out.questionsToPrepare) {
    console.log(`  ${q}`)
    if (sourceId) {
      cited += 1
      // The reported list is the only place a legal sourceId can come from, so it answers both
      // questions at once: who reported it, and whether this is their question or a rewrite.
      const source = reported.find((r) => r.sourceId === sourceId)
      const asked = reported.some(
        (r) => r.sourceId === sourceId && normalizeWs(r.text) === normalizeWs(q),
      )
      if (asked) wordForWord += 1
      console.log(
        source
          ? `      reported by ${source.host} — ${source.url}`
          : `      reported by ${sourceId} — NOT A SOURCE WE HANDED OVER`,
      )
      if (!asked) console.log('      NOT WORD FOR WORD A QUESTION THAT SOURCE REPORTED')
    }
    console.log(`      angle: ${angle}`)
  }

  console.log(`\nquestionsToAsk (${out.questionsToAsk.length})`)
  for (const q of out.questionsToAsk) console.log(`  - ${q}`)

  console.log(`\nfactsToRehearse (${out.factsToRehearse.length})`)
  const claims = facts.map((f) => collapse(f.claim))
  let verbatim = 0
  for (const line of out.factsToRehearse) {
    const quoted = claims.some((c) => c.includes(collapse(line)) || collapse(line).includes(c))
    if (quoted) verbatim += 1
    console.log(`  - ${line}${quoted ? '' : '   [NOT A PROVIDED CLAIM]'}`)
  }

  console.log(`\nredFlags (${out.redFlags.length})`)
  for (const f of out.redFlags) console.log(`  - ${f}`)

  const sections = [
    out.likelyTopics,
    out.questionsToPrepare,
    out.questionsToAsk,
    out.factsToRehearse,
    out.redFlags,
  ]
  const populated = sections.filter((s) => s.length > 0).length
  const ids = new Set(facts.map((f) => f.id))
  const angled = out.questionsToPrepare.filter((q) => [...ids].some((id) => q.angle.includes(id)))

  console.log('\nchecks')
  console.log(`  all five sections populated: ${populated === 5 ? 'ok' : `${populated}/5`}`)
  console.log(`  rehearsal lines quoted from the provided claims: ${verbatim}/${out.factsToRehearse.length}`)
  console.log(`  questions cited to a guide: ${cited}/${out.questionsToPrepare.length} (of ${reported.length} reported)`)
  console.log(`  citations that are that guide's own question, word for word: ${wordForWord}/${cited}`)
  // Informational, not a verdict: the prompt asks for a fact CLUSTER, not an id, and a good
  // angle usually names the claim in words ("the payments service at 99.95%") rather than "f2".
  console.log(`  angles naming a fact id outright: ${angled.length}/${out.questionsToPrepare.length} (informational)`)
}

/**
 * Task 29 end to end, minus the route: the notice read into a round, then the brief written
 * for that round against the posting the record already holds. Two model calls, in the order
 * the route makes them.
 */
async function smokeInterview(): Promise<void> {
  console.log(`interviewInterpret: a ${INTERVIEW_NOTICE.length}-char notice with a relative date`)
  const round = await runInterviewInterpret({ noticeText: INTERVIEW_NOTICE })
  reportInterview(round)

  console.log(`\n\n=== prepBrief for a ${round.roundType} at ${MARRAM.company} ===`)
  reportBrief(await runPrepBrief({ roundType: round.roundType, parsed: MARRAM, facts: TOM_FACTS }), TOM_FACTS)
}

/**
 * A blurb of the kind a candidate actually pastes in after their resume is already loaded.
 * It is built to force all three verdicts out of one reconcile:
 *   - the Kafka sentence restates f4 word for word           → skip
 *   - the Northwind sentence is f1 plus a number it lacked   → update
 *   - Tideline is nowhere in the bank, and it is named       → add, with an entity tag
 * Fictional throughout, like every other fixture in this file.
 */
const TOM_BLURB = `A few things I never wrote down properly.

At Northwind Logistics I have been the Senior Backend Engineer since March 2024, and since
January I have been leading a team of four.

I led the migration of 14 services from RabbitMQ to Kafka.

Last year I built and open-sourced Tideline, a Postgres migration linter. It has 900 stars on
GitHub and is used by three other teams inside Northwind.`

const ENTITY_PREFIX = 'entity:'

/** Just the entity tags, so a run can be read at a glance for whether they were written. */
const entityTags = (tags: string[]) => tags.filter((t) => t.toLowerCase().startsWith(ENTITY_PREFIX))

function reportReconcile(out: ReconcileOut, bank: Fact[]): void {
  const claimOf = new Map(bank.map((f) => [f.id, f.claim]))
  const known = new Set(bank.map((f) => f.id))

  console.log(
    `\nchangeset: ${out.adds.length} add / ${out.updates.length} update /` +
      ` ${out.skips.length} skip / ${out.questions.length} question`,
  )

  console.log(`\nadds (${out.adds.length})`)
  for (const add of out.adds) {
    console.log(`  + [${add.tags.join(', ')}] ${add.claim}`)
    console.log(`      from: ${JSON.stringify(add.sourceSnippet)}`)
  }

  console.log(`\nupdates (${out.updates.length})`)
  for (const update of out.updates) {
    const before = claimOf.get(update.id)
    console.log(`  ~ ${update.id} [${update.tags.join(', ')}]`)
    console.log(`      was:  ${before ?? 'NO SUCH FACT IN THE BANK'}`)
    console.log(`      now:  ${update.claim}`)
    // The route refuses this rather than applying it to nothing; here it is worth seeing.
    if (!known.has(update.id)) console.log('      UNKNOWN ID — apply would 400 on this')
  }

  // The route drops a skip whose fact is also being revised — the two rows contradict each
  // other on screen — so the smoke marks them rather than pretending the panel would show them.
  const revised = new Set(out.updates.map((u) => u.id))
  console.log(`\nskips (${out.skips.length})`)
  for (const skip of out.skips) {
    console.log(`  = ${skip.id ?? '(no id)'}: ${skip.reason}`)
    if (skip.id && !known.has(skip.id)) console.log('      UNKNOWN ID')
    if (skip.id && revised.has(skip.id)) console.log('      DROPPED BY THE ROUTE — also revised')
  }

  for (const q of out.questions) {
    console.log(`\n? ${q.id}: ${q.question}`)
    console.log(`    why: ${q.why}`)
    for (const o of q.options) {
      console.log(`    ${o.value === q.recommended ? '*' : ' '} ${o.label} (${o.value})`)
    }
  }

  const tagged = [...out.adds, ...out.updates].filter((c) => entityTags(c.tags).length > 0)
  console.log(
    `\n${tagged.length}/${out.adds.length + out.updates.length} proposed rows carry an entity tag:` +
      ` ${tagged.flatMap((c) => entityTags(c.tags)).join(', ') || '(none)'}`,
  )
}

/**
 * The reconcile path end to end, as the screen runs it: extract the pasted blurb, then read
 * that extraction against a bank that already holds most of it. Two calls, and a third only if
 * the model asks something — in which case its own recommendation is sent back as the answer,
 * which is exactly the shape the panel's "Use my answers" button posts.
 */
async function smokeReconcile(): Promise<void> {
  console.log(`profileIngest: a ${TOM_BLURB.length}-char blurb, against ${TOM_FACTS.length} stored facts`)
  const extraction = await runProfileIngest({ pastedText: TOM_BLURB })
  report(extraction, TOM_BLURB)

  console.log('\n\n=== reconcile ===')
  const out = await runReconcileFacts({ facts: TOM_FACTS, extracted: extraction.facts })
  reportReconcile(out, TOM_FACTS)

  if (out.questions.length === 0) return
  console.log('\n\n=== reconcile again, with the recommended answers ===')
  const answers: ClarifyAnswer[] = out.questions.map((q) => ({
    id: q.id,
    question: q.question,
    answer: [q.recommended],
  }))
  reportReconcile(
    await runReconcileFacts({ facts: TOM_FACTS, extracted: extraction.facts, answers }),
    TOM_FACTS,
  )
}

/**
 * What the five searches came back with, which the finished map no longer says: the query
 * each one ran, whether it came back at all, the observations it made, and the pages behind
 * its grounding chunks. A URL still on `vertexaisearch.cloud.google.com` here is one whose
 * redirect would not resolve — the link works, but nothing downstream knows its host.
 */
function reportGathers(traces: GatherTrace[]): void {
  console.log(`\nqueries (${traces.length})`)
  for (const t of traces) console.log(`  ${t.query}`)

  const ok = traces.filter((t) => t.ok).length
  console.log(`\ngathers (${ok}/${traces.length} came back)`)
  for (const t of traces) {
    console.log(`\n  ${t.ok ? 'ok' : 'FAILED'}: ${t.query}`)
    for (const note of t.notes) console.log(`    - ${note}`)
    for (const url of t.urls) console.log(`    @ ${url}`)
  }
}

function reportProcess(map: ProcessMap, reads: { attempted: number; landed: number }): void {
  console.log(`\nsources (${map.sources.length})`)
  for (const s of map.sources) {
    console.log(`  ${s.id}  ${s.host}  ${s.kind}  ${s.fetched ? 'fetched' : 'link'}  ${s.title}`)
  }

  console.log(`\nguides (${map.guides.length})`)
  for (const g of map.guides) {
    console.log(`\n  ${g.sourceId}${g.stale ? '  (stale)' : ''}`)
    for (const t of g.takeaways) console.log(`    - ${t}`)
    for (const q of g.questionsReported) console.log(`    ? ${q}`)
    for (const q of g.quotes) console.log(`    " ${q}`)
  }

  // The two numbers that say whether the guides channel worked: how far down the ranked list
  // the run had to go, and how much of it came back as something to digest.
  console.log(`\nreads attempted: ${reads.attempted}, digests landed: ${reads.landed}`)

  console.log('\n\n=== the map ===')
  console.log(JSON.stringify(map, null, 2))
}

/**
 * The whole research pipeline, for a company and a role named on the command line — the same
 * function the route runs, with a posting it never had. This one is expensive twice over: six
 * or more model calls, and a dozen live reads of Reddit, Hacker News and whatever the searches
 * turned up. Run it deliberately, and read what it prints against what the map claims.
 */
async function smokeProcess(company: string, role: string): Promise<void> {
  console.log(`process: ${company} — ${role}`)
  // The posting the route would have parsed, reduced to the two fields the research uses. The
  // rest is empty on purpose: this is the map a person gets before anyone has read the JD.
  const parsed: ParsedJob = {
    company, role, roleFacts: [], gates: [], themes: [], scope: 'per-application', advisory: '',
  }
  let reads = { attempted: 0, landed: 0 }
  const map = await researchProcess({
    company, role, jdRaw: '', parsed,
    onGathers: reportGathers,
    onReads: (counts) => { reads = counts },
  })
  reportProcess(map, reads)
}


// ---- brief & mock: a real researched stage, practised ------------------------------------
// Both modes read one of the saved `process` transcripts under
// docs/superpowers/smoke/2026-09-03-process-map/ rather than researching again: that run cost
// six model calls and a dozen live fetches, and the map it produced is the input these two
// flows were designed against. The candidate is TOM_FACTS — the same eight fictional claims
// the interview smoke uses, chosen because they carry numbers and dates a debrief can actually
// check an answer against, and because none of the three postings is his. A fact bank that does
// not fit the role is the ordinary case, and it is what makes the amber items worth reading.

/** What both modes need out of a saved transcript, worked out once. */
interface SmokeRound {
  company: string
  role: string
  map: ProcessMap
  parsed: ParsedJob
  stage: ProcessStage
  placement: StagePlacement
  roundType: RoundType
  mode: PracticeMode
}

/**
 * Reads a saved process run and stands a round up on one of its stages. The transcript's first
 * line is `process: {company} — {role}` and its map is the JSON after the `=== the map ===`
 * line; nothing else in the file matters here.
 */
function setUpRound(file: string, stageOrder: number): SmokeRound {
  const text = readFileSync(file, 'utf8')
  // Lazy on the company so a role containing an em dash still lands in the second group; a
  // company containing one would not, and there is no such company in the three saved runs.
  const header = /^process:\s*(.+?)\s+—\s+(.+)$/.exec(text.split('\n', 1)[0].trim())
  if (!header) throw new Error(`${file}: the first line is not "process: {company} — {role}"`)
  const marker = text.indexOf('=== the map ===')
  if (marker < 0) throw new Error(`${file}: there is no "=== the map ===" line`)
  // Our own output, read back: a cast rather than a validator, because the only thing that
  // writes this file is smokeProcess above, and a file that is not one fails on the first field.
  const map = JSON.parse(text.slice(text.indexOf('{', marker))) as ProcessMap

  const [, company, role] = header
  const stage = map.stages.find((s) => s.order === stageOrder)
  if (!stage) throw new Error(`${file}: no stage ${stageOrder} — the map has ${map.stages.length}`)
  // A take-home is a stage but not a round type: there is no notice to log for it, and the
  // product would never place a round there. Refused rather than typed 'other' quietly.
  if (stage.kind === 'take-home') {
    throw new Error(`stage ${stageOrder} is the take-home — no round is ever of that kind`)
  }
  const roundType: RoundType = stage.kind

  // The posting the route would have parsed, reduced to the two fields the practice reads —
  // the same minimal ParsedJob smokeProcess builds, for the same reason.
  const parsed: ParsedJob = {
    company, role, roleFacts: [], gates: [], themes: [], scope: 'per-application', advisory: '',
  }

  // A round claims the FIRST unclaimed stage of its kind, which is how the product behaves: the
  // third coding round is the third coding stage. So practising stage 4 of a loop with three
  // technical stages before it means logging those three first — otherwise `stageOrder 4` would
  // quietly hand back stage 2 and the run would be filed under a stage it never used.
  const before = map.stages.filter((s) => s.kind === stage.kind && s.order < stage.order).length
  const rounds: InterviewRound[] = Array.from({ length: before + 1 }, (_, i) => ({
    id: `r${i + 1}`,
    noticeRaw: '',
    roundType,
    people: [],
    chat: [],
    createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  }))
  const placement = placeRound(rounds[rounds.length - 1], rounds, map)
  if (!placement || placement.stage.order !== stage.order) {
    throw new Error(
      `the round landed on ${placement ? `stage ${placement.stage.order}` : 'no stage'}, not ${stageOrder}`,
    )
  }

  return {
    company, role, map, parsed, stage, placement, roundType,
    mode: practiceMode(stage.kind, roleFamily(role)),
  }
}

// The two sentences the mock is built around. One is TOM_FACTS f3 word for word, bar the leading
// capital, so it can be dropped into a sentence the candidate is speaking; the other is nowhere
// in the bank. That makes the debrief's only claim about the candidate testable from outside:
// these sentences, and no others, are ones only they can vouch for. The check that reads them is
// case-insensitive for exactly this reason.
const HELD_CLAIM = 'cut p99 checkout latency from 840ms to 210ms by batching ledger writes'
const PLANTED_CLAIM =
  'I ran the on-call rotation for a forty-engineer payments org and cut incident volume by 40% in a quarter.'

// Prose for a conversation or a design stage: an answer that leans on the bank, then one that
// walks off it. Fixed, not generated — a smoke whose input changes between runs compares nothing.
const PROSE_ANSWERS = [
  `At Northwind I owned the payments service — 12,000 requests a day at 99.95% success. The change
I would point at is latency: I ${HELD_CLAIM}, after a week in the traces establishing that the
ledger write, not the gateway, was the tail.`,
  `On the organisational side, ${PLANTED_CLAIM} The habit I would bring here is writing the
runbook before the launch rather than after the first page.`,
]

// The same two answers for a coding stage, with the code the box would hold. No backticks: this
// is a TypeScript template literal, and a Go raw string would end it.
const CODING_ANSWERS = [
  `Assumptions: one charge per idempotency key, the gateway delivers at least once, ledger rows
are append-only.

func ApplyCharge(ctx context.Context, tx *sql.Tx, key string, cents int64) error {
  var seen bool
  err := tx.QueryRowContext(ctx, "select exists(select 1 from charges where idem_key=$1)", key).Scan(&seen)
  if err != nil {
    return err
  }
  if seen {
    return nil
  }
  if _, err := tx.ExecContext(ctx, "insert into charges (idem_key, cents) values ($1, $2)", key, cents); err != nil {
    return err
  }
  return appendLedger(ctx, tx, key, cents)
}

I have written this shape before: I ${HELD_CLAIM}, so appendLedger here would buffer and flush
rather than write once per charge.`,
  `For the added constraint I would take the idempotency key as the partition key and hold the
flush window at 20ms, so a retry lands in the same batch as the original and the ledger stays
single-writer per key.

${PLANTED_CLAIM} Most of that was making retries idempotent exactly like this.`,
]

/**
 * Two-way, case-insensitive containment: a debrief may quote the whole sentence or the clause
 * inside it, and a candidate writes "I cut p99…" where the fact reads "Cut p99…". This is the
 * smoke's own judgment, not the guard's — guardDebrief's substring test is case-sensitive and
 * is checked separately below. Only the planted claim uses this, where a hit either direction is
 * the right answer; for the held claim the direction is the whole question, so it is tested there.
 */
const overlaps = (a: string, b: string): boolean => {
  const x = normalizeWs(a).toLowerCase()
  const y = normalizeWs(b).toLowerCase()
  return x.includes(y) || y.includes(x)
}

/** A model turn as the route stores it: `sourceId` omitted rather than written as undefined. */
const asTurn = (out: MockTurnOut): MockTurn => ({
  role: 'model',
  text: out.say,
  kind: out.kind,
  ...(out.sourceId ? { sourceId: out.sourceId } : {}),
  at: new Date().toISOString(),
})

/**
 * The session as the round page would show it, then the debrief with its amber items marked —
 * amber being the one thing on that page only the candidate can settle. The checks at the end
 * are the two the planted sentences make possible: the claim the bank does not hold has to be
 * flagged, and the claim it does hold must not be.
 */
function reportMock(
  transcript: MockTurn[],
  debrief: MockDebriefOut,
  mode: PracticeMode,
  facts: Fact[],
  reported: ReportedQuestion[],
): void {
  console.log(`\ntranscript (${transcript.length} turns)`)
  for (const turn of transcript) {
    if (turn.role === 'model') {
      const source = turn.sourceId ? reported.find((r) => r.sourceId === turn.sourceId) : undefined
      const cite = turn.sourceId
        ? source
          ? `  · reported by ${source.host} (${turn.sourceId})`
          : `  · cites ${turn.sourceId} — NOT A SOURCE WE HANDED OVER`
        : ''
      console.log(`\n  Interviewer (${turn.kind ?? 'unlabelled'})${cite}`)
    } else {
      console.log('\n  You')
    }
    for (const line of turn.text.split('\n')) console.log(`      ${line}`)
  }

  console.log('\n\ndebrief')
  console.log(`\n  overall\n      ${debrief.overall}`)

  let amber = 0
  debrief.answers.forEach((answer, i) => {
    console.log(`\n  answer ${i + 1}: ${answer.question}`)
    for (const l of answer.landed) console.log(`      landed: ${l}`)
    for (const v of answer.vague) console.log(`      vague:  ${v}`)
    for (const u of answer.unsupported) {
      amber += 1
      console.log(`      AMBER:  ${JSON.stringify(u.said)}`)
      console.log(`              why: ${u.why}`)
    }
  })

  if (debrief.code) {
    console.log('\n  read, not run')
    for (const s of debrief.code.strengths) console.log(`      strength: ${s}`)
    for (const g of debrief.code.gaps) console.log(`      gap:      ${g}`)
  }

  console.log(`\n  rehearse (${debrief.rehearse.length})`)
  const claims = facts.map((f) => normalizeWs(f.claim))
  let quoted = 0
  for (const line of debrief.rehearse) {
    const known = claims.includes(normalizeWs(line))
    if (known) quoted += 1
    console.log(`      - ${line}${known ? '' : '   [NOT A PROVIDED CLAIM]'}`)
  }

  const said = debrief.answers.flatMap((a) => a.unsupported.map((u) => u.said))
  // guardDebrief's own test, run again from outside: normalised, case-sensitive, substring.
  const typed = normalizeWs(
    transcript.filter((t) => t.role === 'user').map((t) => t.text).join('\n'),
  )
  const verbatim = said.filter((s) => typed.includes(normalizeWs(s))).length

  // The held claim needs a sharper test than `overlaps`. Two-way containment cannot tell the two
  // directions apart, and only one of them is a fault: an amber quoting the held claim itself is
  // the guard failing, while an amber quoting a longer sentence that happens to carry the held
  // claim is the model flagging the rest of that sentence — which is its job. The old check called
  // both FALSE POSITIVE, which is how a reader learns to skip the line.
  const held = normalizeWs(HELD_CLAIM).toLowerCase()
  const ambers = said.map((s) => normalizeWs(s).toLowerCase())
  const flagged = ambers.some((s) => held.includes(s))
  const wrapping = ambers.filter((s) => s !== held && s.includes(held)).length

  console.log('\nchecks')
  console.log(`  amber sentences quoted verbatim from what the candidate typed: ${verbatim}/${said.length}`)
  console.log(`  rehearsal lines quoted from the provided claims: ${quoted}/${debrief.rehearse.length}`)
  console.log(`  the claim the bank does not hold was flagged: ${said.some((s) => overlaps(s, PLANTED_CLAIM)) ? 'ok' : 'MISSED'}`)
  console.log(
    `  the claim the bank does hold was not flagged: ${flagged ? 'FALSE POSITIVE: the held claim itself was flagged' : 'ok'}`,
  )
  if (wrapping > 0) {
    console.log(
      `      note: ${wrapping} amber ${wrapping === 1 ? 'sentence wraps' : 'sentences wrap'} the held claim — read the why`,
    )
  }
  console.log(
    `  code section present: ${debrief.code ? 'yes' : 'no'}` +
      ` (mode ${mode} — ${mode === 'coding' ? 'expected' : 'expected none'})`,
  )
  console.log(`  answers written: ${debrief.answers.length}, amber items: ${amber}`)
}

/**
 * One brief, written the way the round page writes it: for a stage of a loop somebody really
 * researched, with every question the guides reported handed to the model beside it. One model
 * call. Read it against what the guides actually said — the citations are the point.
 */
async function smokeBrief(file: string, stageOrder: number): Promise<void> {
  const { company, role, map, parsed, stage, placement, roundType } = setUpRound(file, stageOrder)
  const reported = reportedQuestions(map)
  console.log(`brief: ${company} — ${role}`)
  console.log(`  stage ${stage.order} of ${placement.of}: ${stage.name} [${stage.kind}] → round type ${roundType}`)
  console.log(`  ${reported.length} reported questions from ${map.guides.length} guides, ${TOM_FACTS.length} facts in the bank`)
  const brief = await runPrepBrief({ roundType, parsed, facts: TOM_FACTS, stage: placement, reported })
  reportBrief(brief, TOM_FACTS, reported)
}

/**
 * A whole mock session, scripted: start, two fixed answers, end. Four model calls, made against
 * the flows directly — there is no Firestore here, so the route's session, its token and its
 * write order have nothing to act on; what this exercises is the half that talks to the model.
 * The candidate's answers are the same every run on purpose, so two runs of the same stage are
 * comparable and the debrief's amber items are checkable.
 */
async function smokeMock(file: string, stageOrder: number): Promise<void> {
  const { company, role, map, parsed, stage, roundType, mode } = setUpRound(file, stageOrder)
  const reported = reportedQuestions(map)
  // The stage as a session sees it: from the order the session recorded, against the map it was
  // started on. Frozen here because it is frozen there.
  const stageSummary = describeStage(
    roundType,
    { stageOrder: stage.order, researchedAt: map.researchedAt },
    map,
  )
  const answers = mode === 'coding' ? CODING_ANSWERS : PROSE_ANSWERS

  console.log(`mock: ${company} — ${role}`)
  console.log(`  stage ${stage.order}: ${stage.name} [${stage.kind}] → round type ${roundType}, mode ${mode}`)
  console.log(`  ${reported.length} reported questions in the prompt, ${TOM_FACTS.length} facts in the bank`)

  const transcript: MockTurn[] = []
  const ask = (questionsAsked: number): Promise<MockTurnOut> =>
    runMockTurn({
      parsed, stageSummary, reported, facts: TOM_FACTS, mode,
      questionsAsked,
      // A first session: there is nothing earlier to avoid repeating.
      previousQuestions: [],
      transcript,
    })

  // `start` — the first question, with nothing asked yet.
  transcript.push(asTurn(await ask(0)))
  let questionsAsked = 1

  // Two `answer` actions. The candidate's turn goes down first, exactly as the route writes it
  // before it calls anything; here that only means the transcript the next call reads.
  for (const answer of answers) {
    transcript.push({ role: 'user', text: answer, at: new Date().toISOString() })
    const turn = await ask(questionsAsked)
    transcript.push(asTurn(turn))
    if (turn.kind === 'question') questionsAsked += 1
  }

  // `end`.
  const debrief = await runMockDebrief({ parsed, stageSummary, mode, facts: TOM_FACTS, transcript })
  reportMock(transcript, debrief, mode, TOM_FACTS, reported)
}

/**
 * The third positional: which stage of the saved loop to practise, 1 when it is absent. A typo
 * throws rather than falling back — practising stage 1 and filing it as stage 11 is the one
 * mistake a run of this cannot recover from, because the output looks perfectly fine.
 */
function stageOrderArg(value: string | undefined): number {
  if (value === undefined) return 1
  const order = Number(value)
  if (!Number.isInteger(order) || order < 1) {
    throw new Error(`stageOrder must be a positive integer, not ${JSON.stringify(value)}`)
  }
  return order
}

async function main(): Promise<void> {
  // The second positional is a file for `profileIngest` and a mode for `formParse`; the
  // `process` mode reads it as the company, and takes the role from a third. `brief` and `mock`
  // read it as a saved `process` transcript, and the third as the stage of that loop to run.
  const [flow, file, role] = process.argv.slice(2)
  if (flow === 'profileIngest' && file) return smokeProfileIngest(file)
  if (flow === 'jobInterpret') return smokeJobInterpret()
  if (flow === 'formParse' && (file === 'text' || file === 'image')) return smokeFormParse(file)
  if (flow === 'answerDraft') return smokeAnswerDraft()
  if (flow === 'clarifyDraft') return smokeClarifyDraft()
  if (flow === 'feedbackDistill') return smokeFeedbackDistill()
  if (flow === 'story') return smokeStory()
  if (flow === 'interview') return smokeInterview()
  if (flow === 'reconcile') return smokeReconcile()
  if (flow === 'process' && file && role) return smokeProcess(file, role)
  if (flow === 'brief' && file) return smokeBrief(file, stageOrderArg(role))
  if (flow === 'mock' && file) return smokeMock(file, stageOrderArg(role))

  console.error(
    'usage: tsx scripts/smoke-flows.ts profileIngest <file> | jobInterpret |' +
      ' formParse text|image | answerDraft | clarifyDraft | feedbackDistill | story |' +
      ' interview | reconcile | process "<company>" "<role>" |' +
      ' brief <transcript> [stageOrder] | mock <transcript> [stageOrder]',
  )
  process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
