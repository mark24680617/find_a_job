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
import { mergeStory } from '../src/lib/profileMerge'
import type {
  AnswerDraftOut,
  ClarifyDraftOut,
  FeedbackDistillOut,
  FormParseOut,
  InterviewInterpretOut,
  JobInterpretOut,
  PrepBriefOut,
  ProfileIngestOut,
  ReconcileOut,
} from '../src/ai/schemas'
import { countUnits } from '../src/lib/countText'
import type { ClarifyAnswer, Fact, ParsedJob, Profile, Question } from '../src/lib/types'

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
 * candidate to tell is worse than no brief.
 */
function reportBrief(out: PrepBriefOut, facts: Fact[]): void {
  console.log(`\nlikelyTopics (${out.likelyTopics.length})`)
  for (const t of out.likelyTopics) console.log(`  - ${t}`)

  console.log(`\nquestionsToPrepare (${out.questionsToPrepare.length})`)
  for (const { q, angle } of out.questionsToPrepare) console.log(`  ${q}\n      angle: ${angle}`)

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

async function main(): Promise<void> {
  const [flow, file] = process.argv.slice(2)
  if (flow === 'profileIngest' && file) return smokeProfileIngest(file)
  if (flow === 'jobInterpret') return smokeJobInterpret()
  if (flow === 'formParse' && (file === 'text' || file === 'image')) return smokeFormParse(file)
  if (flow === 'answerDraft') return smokeAnswerDraft()
  if (flow === 'clarifyDraft') return smokeClarifyDraft()
  if (flow === 'feedbackDistill') return smokeFeedbackDistill()
  if (flow === 'story') return smokeStory()
  if (flow === 'interview') return smokeInterview()
  if (flow === 'reconcile') return smokeReconcile()

  console.error(
    'usage: tsx scripts/smoke-flows.ts profileIngest <file> | jobInterpret |' +
      ' formParse text|image | answerDraft | clarifyDraft | feedbackDistill | story |' +
      ' interview | reconcile',
  )
  process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
