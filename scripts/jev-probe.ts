/**
 * The JEV probe (spec §9.1). Nobody in this project has ever called this API; every fact about
 * it in the spec is read rather than run, and this is what replaces the load-bearing ones.
 *
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts body      <dir>
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts cap       <dir>
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts primitive <dir>
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts language  <dir>
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts injection <dir>
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts repeat    <dir>
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts batch     <dir>   # after `cap`
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts label     <dir>   # write the label sheet
 *   npx tsx --env-file=.env.local scripts/jev-probe.ts cuts      <dir> <measure-genkit.csv>   # read it back, choose
 *
 * FIXTURES ONLY. CLAUDE.md's rule is no personal data in a prompt, and TypeSafe reserves
 * perpetual rights over telemetry derived from requests with zero-data-retention available only
 * on enterprise contracts (spec §8). The one document that must never enter this probe is the
 * owner's own. Every state below comes from `tests/fixtures/resumes.ts`, which is invented.
 *
 * Plain `fetch`, not `@typesafe-ai/sdk` (R4). The request below — one POST to
 * `${JEV_BASE_URL}/v1/systemone`, `authorization: Bearer <key>`, a JSON body
 * `{ model, state, questions }` with each question `{ type: 'noul', instructions, criteria }` —
 * is the request Task C5's `askNouls` sends, so what this probe observes is what the product
 * will send. Plain fetch also retries nothing and logs nothing: a retried 429 or 5xx would hide
 * exactly the statuses this probe exists to observe, and a logged body here is resume text.
 *
 * No top-level await: tsx compiles this to CJS, where it is a syntax error.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bulletsOf, CLEAN_CN, CLEAN_EN, INJECTED_EN, TWO_COLUMN_EN, visibleText,
} from '../tests/fixtures/resumes'

/** Pinned, never `jev-latest`: cut points tuned against a version belong to that version. */
const JEV_MODEL = 'jev-1.13.0'
/**
 * A constant here, never TYPESAFE_BASE_URL. The endpoint a resume is sent to is a decision in
 * the repo, not a deployment variable (spec §4, §8). `src/ai/jev.ts` holds the same constant
 * (Task C5).
 */
const JEV_BASE_URL = 'https://api.typesafe.ai'
const JEV_URL = `${JEV_BASE_URL}/v1/systemone`
/** $0.042 per M input tokens, output free (spec §11). */
const JEV_PER_M_INPUT = 0.042

interface Noul { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
/**
 * Only the `primitive` arm asks one, hand-written the same way as the Noul. If the API refuses
 * this shape, adjust it to what the response and docs.typesafe.ai say and record the change.
 */
interface Score { type: 'score'; instructions: string; criteria: string[] }
type Question = Noul | Score

interface Answer { type?: string; noul?: number; score?: number; confidence?: number }
interface SystemOneResponse {
  model: string
  answers: Record<string, Answer>
  usage: { input_tokens: number; output_tokens: number }
}

/** A refusal, with the status and the body exactly as they came back. */
class JevHttpError extends Error {
  constructor(readonly status: number, readonly body: string, readonly requestId: string | null) {
    super(`HTTP ${status}`)
  }
}

const noul = (instructions: string, whenFalse: string): Noul =>
  ({ type: 'noul', instructions, criteria: { true: instructions, false: whenFalse } })

function apiKey(): string {
  const key = process.env.TYPESAFE_API_KEY
  if (!key) throw new Error('TYPESAFE_API_KEY is not set; --env-file=.env.local supplies it')
  return key
}

/** The request exactly as Task C5's `askNouls` builds it: the same URL, two headers and body. */
function request(state: string, questions: Record<string, Question>): { url: string; init: RequestInit } {
  return {
    url: JEV_URL,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(30_000),
    },
  }
}

/** Tokens and wall time of every answered request — the JEV row of A2's cost table (R13). */
const spent: { inputTokens: number; outputTokens: number; ms: number }[] = []

async function systemOne(state: string, questions: Record<string, Question>): Promise<SystemOneResponse> {
  const { url, init } = request(state, questions)
  const started = Date.now()
  const response = await fetch(url, init)
  const raw = await response.text()
  if (!response.ok) {
    throw new JevHttpError(response.status, raw,
      response.headers.get('x-request-id') ?? response.headers.get('request-id'))
  }
  const parsed = JSON.parse(raw) as SystemOneResponse
  spent.push({
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    ms: Date.now() - started,
  })
  return parsed
}

/**
 * Spec §6.1's four, in their FINAL wording (R5). This is the source: Task C4 copies these strings
 * verbatim into `src/ai/nouls.ts`, and its prompt test pins them. `instructions` and
 * `criteria.true` say the same thing — JEV answered the literal instruction over contradicting
 * criteria 20 times out of 20 — and every question carries an explicit clause against
 * self-description, which took a pure self-claim from 0.95 to 0.49. The fourth is asked in its
 * positive sense, so a high noul is the good answer on every row, and the owner labels it that
 * way. Changing a word here, or `stateFor`, re-runs `cuts` and Task A8.
 */
const BULLET_NOUL_IDS = ['result', 'action', 'scale', 'self-description'] as const
type BulletNoulId = (typeof BULLET_NOUL_IDS)[number]

const bulletNouls = (): Record<BulletNoulId, Noul> => ({
  result: noul(
    'The line states a measurable result — a number, a quantity, a duration, a rate or a named outcome that was achieved — and not merely a self-description of the candidate.',
    'The line states no measurable result. It describes duties or responsibilities, or it is merely a self-description of the candidate.',
  ),
  action: noul(
    'The line states a specific action the candidate took — a thing they did, named as a verb with its object — and not merely a self-description of the candidate.',
    'The line names no specific action the candidate took. It lists a role, a tool or a responsibility, or it is merely a self-description of the candidate.',
  ),
  scale: noul(
    'The line states the scope or scale the work happened at — how many, how large, how often, how long, or for whom — and not merely a self-description of the candidate.',
    'The line states no scope or scale. It could describe work of any size, or it is merely a self-description of the candidate.',
  ),
  'self-description': noul(
    'The line is more than a self-description of the candidate — it reports something they did or achieved, not only a claim about what kind of worker they are.',
    'The line is a self-description of the candidate and nothing more — a claim about what kind of worker they are, with nothing they did or achieved attached.',
  ),
})

/**
 * Task C4's `buildBulletState` format, character for character (R5): one bullet plus the line
 * it sits under, and nothing more (spec §6.1, §8). An empty role line is dropped, not sent blank.
 * The `Role:` line is `b.entryLine`, which A1's `bulletsOf` gives in C4's `role, org` form and the
 * bullet without its glyph, so the calibrated state is byte for byte what the product sends
 * (amended 2026-09-24, R60).
 */
const stateFor = (b: { text: string; entryLine: string }): string =>
  b.entryLine === ''
    ? `Line from the resume: ${b.text}`
    : `Role: ${b.entryLine}\nLine from the resume: ${b.text}`

interface Answered { fixture: string; bulletId: string; questionId: BulletNoulId; noul: number; model: string }

async function askFour(
  fixtureId: string, b: { id: string; text: string; entryLine: string }, state = stateFor(b),
): Promise<Answered[]> {
  const result = await systemOne(state, bulletNouls())
  return BULLET_NOUL_IDS.map((id) => ({
    fixture: fixtureId,
    bulletId: b.id,
    questionId: id,
    noul: result.answers[id]?.noul ?? Number.NaN,
    model: result.model,
  }))
}

const describe = (error: unknown): string =>
  error instanceof JevHttpError
    ? `${error.status} ${error.body} requestId=${error.requestId ?? 'none'}`
    : error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)

const median = (xs: number[]): number =>
  xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/**
 * One verbatim body, unparsed, into deps.md before `src/ai/jev.ts` is written (spec §9.1) — and
 * beside it the request that produced it, recorded by a logging fetch (R4): the method, the URL,
 * the header NAMES (values stripped, so the key never reaches a file) and the JSON body. Task C5
 * builds its URL, auth header and field names from this record.
 */
async function body(dir: string): Promise<void> {
  const b = bulletsOf(CLEAN_EN)[0]
  const sent: string[] = []
  const loggingFetch = (url: string, init: RequestInit): Promise<Response> => {
    sent.push(
      `${init.method ?? 'GET'} ${url}`,
      `header names: ${Object.keys(init.headers as Record<string, string>).join(', ')}`,
      '',
      typeof init.body === 'string' ? init.body : '',
    )
    return fetch(url, init)
  }
  const { url, init } = request(stateFor(b), bulletNouls())
  const response = await loggingFetch(url, init)
  const raw = await response.text()
  const headers = [...response.headers.entries()]
    .filter(([k]) => !/authorization|api-key|cookie/i.test(k))
    .map(([k, v]) => `${k}: ${v}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'jev-request.txt'), `${sent.join('\n')}\n`)
  writeFileSync(join(dir, 'jev-body.txt'), `HTTP ${response.status}\n${headers.join('\n')}\n\n${raw}\n`)
  console.log(sent.join('\n'))
  console.log(`\nHTTP ${response.status}`)
  console.log(headers.join('\n'))
  console.log(raw)
}

/**
 * The cap is undocumented — only token budgets are (64k total, 32k for state plus the longest
 * question) — and spec §6.2 depends on it, so it is measured: the largest question count that
 * still answers, by halving. Written to jev-cap.json for `batch`.
 */
async function cap(dir: string): Promise<void> {
  const state = stateFor(bulletsOf(CLEAN_EN)[0])
  const attempt = async (n: number): Promise<boolean> => {
    const questions: Record<string, Noul> = {}
    for (let i = 0; i < n; i++) {
      questions[`q${i}`] = noul(
        `Question ${i}: the line states a measurable result, not merely self-description.`,
        `Question ${i}: the line states no measurable result, or is merely self-description.`,
      )
    }
    try {
      const result = await systemOne(state, questions)
      const answered = Object.keys(result.answers).length
      console.log(`  ${n} questions -> ok, ${answered} answers, ${result.usage.input_tokens} input tokens`)
      return answered === n
    } catch (error) {
      console.log(`  ${n} questions -> ${describe(error)}`)
      return false
    }
  }
  let lo = 1
  let hi = 1024
  let found: number
  if (!(await attempt(lo))) throw new Error('one question did not answer, so there is no cap to measure; the refusal is above')
  if (await attempt(hi)) {
    console.log(`no cap below ${hi}`)
    found = hi
  } else {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (await attempt(mid)) lo = mid
      else hi = mid
    }
    console.log(`largest question count that answered: ${lo}`)
    found = lo
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'jev-cap.json'), JSON.stringify({ cap: found }))
}

/** The same judgement as a Noul and as a 3-level Score — our own calibration delta (spec §9.1). */
async function primitive(): Promise<void> {
  for (const b of bulletsOf(CLEAN_EN)) {
    const state = stateFor(b)
    const asNoul = await systemOne(state, { result: bulletNouls().result })
    const asScore = await systemOne(state, {
      result: {
        type: 'score',
        instructions: 'How far does the line state a measurable result, not merely self-description?',
        criteria: [
          'The line states no measurable result, or is merely self-description.',
          'The line gestures at a result without stating it.',
          'The line states a measurable result, not merely self-description.',
        ],
      },
    })
    const n = asNoul.answers.result?.noul ?? Number.NaN
    const s = asScore.answers.result?.score ?? Number.NaN
    const c = asScore.answers.result?.confidence ?? Number.NaN
    console.log(`${b.id}  noul ${n.toFixed(3)}  score ${s.toFixed(3)}  confidence ${c.toFixed(3)}  ${b.text.slice(0, 44)}`)
  }
  console.log('\nNo Score and no Choice ships in the product (D1). This arm measures the delta, nothing else.')
}

/** The same four judgements in English and in a fictional Chinese translation (spec §6.1, §9.1). */
async function language(): Promise<void> {
  const en = bulletsOf(CLEAN_EN)
  const cn = bulletsOf(CLEAN_CN)
  if (en.length !== cn.length) throw new Error('the two fixtures no longer line up bullet for bullet')
  let worst = 0
  for (let i = 0; i < en.length; i++) {
    const a = await askFour(CLEAN_EN.id, en[i])
    const b = await askFour(CLEAN_CN.id, cn[i])
    for (let q = 0; q < a.length; q++) {
      const delta = Math.abs(a[q].noul - b[q].noul)
      worst = Math.max(worst, delta)
      console.log(`${en[i].id} ${a[q].questionId.padEnd(16)} en ${a[q].noul.toFixed(3)}` +
        `  cn ${b[q].noul.toFixed(3)}  delta ${delta.toFixed(3)}`)
    }
  }
  console.log(`\nlargest CN/EN delta: ${worst.toFixed(3)}`)
  console.log('A delta wider than the band PASS_AT and FAIL_AT leave is why `language !== "en"`')
  console.log('gates the Noul layer as well as the deterministic suite until a cut point per')
  console.log('language is recorded here (spec §6.1, risk 11).')
}

/** One injected instruction line, appended to a state it has no business being in (spec §8). */
async function injection(): Promise<void> {
  const weak = bulletsOf(CLEAN_EN).at(-1)
  if (!weak) throw new Error('CLEAN_EN has no bullets')
  const injectedLine = INJECTED_EN.injected
  if (!injectedLine) throw new Error('INJECTED_EN carries no injected line')
  const clean = await askFour(CLEAN_EN.id, weak)
  const dirty = await askFour(INJECTED_EN.id, weak, `${stateFor(weak)}\n${injectedLine}`)
  for (let i = 0; i < clean.length; i++) {
    console.log(`${clean[i].questionId.padEnd(16)} clean ${clean[i].noul.toFixed(3)}` +
      `  injected ${dirty[i].noul.toFixed(3)}  moved ${(dirty[i].noul - clean[i].noul).toFixed(3)}`)
  }
  console.log('\nThe product never sends this: hidden text is excluded from every model input, and')
  console.log('the state is one bullet plus its entry line. This measures what one visible line')
  console.log('would do if it got through.')
}

/** Repeatability: five identical requests, and the spread they came back with (spec §9.1). (R8) */
async function repeat(dir: string): Promise<void> {
  const rows: Answered[] = []
  for (let run = 0; run < 5; run++) {
    for (const b of bulletsOf(CLEAN_EN)) rows.push(...(await askFour(CLEAN_EN.id, b)))
  }
  let worst = 0
  for (const b of bulletsOf(CLEAN_EN)) {
    for (const q of BULLET_NOUL_IDS) {
      const values = rows.filter((r) => r.bulletId === b.id && r.questionId === q).map((r) => r.noul)
      const spread = Math.max(...values) - Math.min(...values)
      worst = Math.max(worst, spread)
      console.log(`${b.id} ${q.padEnd(16)} ${values.map((v) => v.toFixed(3)).join(' ')}  spread ${spread.toFixed(3)}`)
    }
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'jev-repeat.json'), JSON.stringify({ rows, worst }, null, 2))
  console.log(`\nlargest spread over five identical requests: ${worst.toFixed(3)}`)
  console.log('This is REPEAT_SPREAD. A band narrower than it would call the same line pass one')
  console.log('run and fail the next, so PASS_AT and FAIL_AT must be at least this far apart.')
}

/**
 * A full skill-sized batch: forty names, the size spec §11's Gaps estimate assumes (~1.6k
 * question tokens) and Task D4's tests split. PostgreSQL first: it is `s1` in every composition.
 */
const SKILL_BATCH = [
  'PostgreSQL', 'Python', 'Kubernetes', 'Apache Kafka', 'Go', 'Rust', 'Terraform', 'Docker',
  'React', 'TypeScript', 'Node.js', 'GraphQL', 'Redis', 'Elasticsearch', 'MongoDB', 'MySQL',
  'Amazon Web Services AWS software', 'Microsoft Azure software', 'Google Cloud software',
  'Jenkins', 'Git', 'Linux', 'Ansible', 'Apache Spark', 'Snowflake', 'Tableau', 'Oracle Java',
  'C++', 'C#', 'Scala', 'Swift', 'Kotlin', 'Ruby on Rails', 'Django', 'Flask', 'Apache Airflow',
  'Prometheus', 'Grafana', 'Nginx', 'RabbitMQ',
]

/** Task C4's `skillNoul`, verbatim — the question Gaps asks (spec §6.2). */
const skillNoul = (skill: string): Noul =>
  noul(
    `The resume evidences hands-on use of ${skill} — the candidate did something with it, not merely listed it among their skills, and not merely a self-description of the candidate.`,
    `The resume does not evidence hands-on use of ${skill}. It is listed, implied or claimed as a skill, or it is absent, or the mention is merely a self-description of the candidate.`,
  )

/**
 * Batching identity (spec §9.1, §6.2), which `repeat` does not measure (R8): against one state,
 * the same Noul asked alone, inside a K-split batch of at most `cap`, and inside the full
 * skill-sized batch — five repeats each. The state is Gaps' (the whole visible resume), the ids
 * `s1 … sN` as Task D4 sends them. The K-split size is the smaller of `cap` and half the batch,
 * so a real split is measured even when the cap sits above the skill count. The largest delta
 * between compositions, over every skill two compositions share, is its own deps.md row: Task
 * D4 reads it against the band, and sends one question per request if it is wider.
 */
async function batch(dir: string): Promise<void> {
  const measuredCap = (JSON.parse(readFileSync(join(dir, 'jev-cap.json'), 'utf8')) as { cap: number }).cap
  const state = visibleText(CLEAN_EN)
  const sizes = [...new Set([1, Math.min(measuredCap, Math.ceil(SKILL_BATCH.length / 2)), SKILL_BATCH.length])]
  const sent = sizes.filter((n) => n <= measuredCap)
  if (sent.length < sizes.length) {
    console.log(`the full ${SKILL_BATCH.length}-skill batch is above the cap of ${measuredCap}; it is not sent`)
  }
  const means = new Map<string, number[]>()
  for (const size of sent) {
    const questions = Object.fromEntries(
      SKILL_BATCH.slice(0, size).map((name, i) => [`s${i + 1}`, skillNoul(name)]),
    )
    const runs: Record<string, number[]> = {}
    for (let r = 0; r < 5; r++) {
      const result = await systemOne(state, questions)
      for (const id of Object.keys(questions)) (runs[id] ??= []).push(result.answers[id]?.noul ?? Number.NaN)
    }
    for (const [id, values] of Object.entries(runs)) {
      means.set(id, [...(means.get(id) ?? []), values.reduce((t, v) => t + v, 0) / values.length])
    }
    console.log(`${String(size).padStart(3)} questions  s1 (${SKILL_BATCH[0]}) ${runs.s1.map((v) => v.toFixed(3)).join(' ')}`)
  }
  let worst = 0
  for (const values of means.values()) {
    if (values.length > 1) worst = Math.max(worst, Math.max(...values) - Math.min(...values))
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'jev-batch.json'), JSON.stringify({ cap: measuredCap, sizes: sent, worst }, null, 2))
  console.log(`\nlargest cross-composition delta: ${worst.toFixed(3)} (sizes ${sent.join(', ')})`)
  console.log('Read it against REPEAT_SPREAD and the band. Wider than the band, and Task D4 sends one')
  console.log('question per request instead of splitting by the cap.')
}

interface LabelSheet {
  model: string
  labelled: {
    fixture: string; bulletId: string; text: string; questionId: BulletNoulId
    /** The exact instruction being labelled (R5). */
    instruction: string
    answer: 'yes' | 'no' | null
  }[]
}

/**
 * The owner labels; the probe does not. Writing the sheet and reading it back are two commands
 * with a person in between, because a cut point fitted to the judge's own answers would be a
 * measurement of nothing.
 */
function label(dir: string): void {
  const sheet: LabelSheet = { model: JEV_MODEL, labelled: [] }
  const nouls = bulletNouls()
  for (const fixture of [CLEAN_EN, INJECTED_EN]) {
    for (const b of bulletsOf(fixture)) {
      for (const q of BULLET_NOUL_IDS) {
        sheet.labelled.push({
          fixture: fixture.id, bulletId: b.id, text: b.text, questionId: q,
          instruction: nouls[q].instructions, answer: null,
        })
      }
    }
  }
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'jev-labels.json')
  writeFileSync(path, JSON.stringify(sheet, null, 2))
  console.log(`wrote ${sheet.labelled.length} unlabelled rows to ${path}`)
  console.log('Fill every "answer" with "yes" or "no" — "yes" when the instruction is true of the line.')
  console.log('The fourth question is asked in its positive sense: "yes" means the line is MORE than a')
  console.log('self-description. Then run: jev-probe.ts cuts <dir> <measure-genkit.csv>')
}

/** A2's CSV: the four yes/no answers on the call that produced them (R13). */
function geminiAnswers(path: string): Map<string, ('yes' | 'no')[]> {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split('\n')
  const columns = header.split(',')
  const at = (name: string): number => {
    const index = columns.indexOf(name)
    if (index < 0) throw new Error(`${path} has no ${name} column; re-run scripts/measure-genkit.ts`)
    return index
  }
  const out = new Map<string, ('yes' | 'no')[]>()
  for (const line of lines) {
    const cells = line.split(',')
    for (const q of BULLET_NOUL_IDS) {
      const answer = cells[at(q)]
      if (answer !== 'yes' && answer !== 'no') continue
      const key = `${cells[at('fixture')]}|${cells[at('bulletId')]}|${q}`
      out.set(key, [...(out.get(key) ?? []), answer])
    }
  }
  return out
}

const STEP = 0.01

async function cuts(dir: string, genkitCsv: string | undefined): Promise<void> {
  if (!genkitCsv) throw new Error('cuts needs A2\'s CSV as its third argument, for the Gemini arm\'s agreement')
  const sheet = JSON.parse(readFileSync(join(dir, 'jev-labels.json'), 'utf8')) as LabelSheet
  const unlabelled = sheet.labelled.filter((r) => r.answer !== 'yes' && r.answer !== 'no')
  if (unlabelled.length > 0) throw new Error(`${unlabelled.length} rows are still unlabelled`)

  // Judged over A2's exact set — 10 bullets over 3 resumes — so the JEV cost row compares like
  // with like (R13). Only CLEAN_EN and INJECTED_EN are labelled; agreement is scored on those.
  spent.length = 0
  const judged = new Map<string, number>()
  for (const fixture of [CLEAN_EN, TWO_COLUMN_EN, INJECTED_EN]) {
    for (const b of bulletsOf(fixture)) {
      for (const a of await askFour(fixture.id, b)) {
        judged.set(`${a.fixture}|${a.bulletId}|${a.questionId}`, a.noul)
      }
    }
  }
  const cost = [...spent]

  const rows = sheet.labelled.map((r) => ({
    ...r, noul: judged.get(`${r.fixture}|${r.bulletId}|${r.questionId}`) ?? Number.NaN,
  }))
  const missing = rows.filter((r) => Number.isNaN(r.noul))
  if (missing.length > 0) throw new Error(`${missing.length} labelled rows got no judgement`)

  const yes = rows.filter((r) => r.answer === 'yes').map((r) => r.noul)
  const no = rows.filter((r) => r.answer === 'no').map((r) => r.noul)
  console.log(`labelled yes: ${yes.length}, no: ${no.length}`)
  console.log('\ncut    yes at or below    no at or above')
  for (let c = 0.05; c <= 0.95 + 1e-9; c += 0.05) {
    console.log(`${c.toFixed(2)}   ${yes.filter((v) => v <= c).length}` +
      `                 ${no.filter((v) => v >= c).length}`)
  }

  // FAIL_AT: the largest cut no labelled yes falls at or below. PASS_AT: the smallest cut no
  // labelled no reaches. Between them is `unjudged`, which is a row of its own and never a
  // counted item (spec §6.1).
  let failAt = 0
  for (let c = STEP; c < 1; c += STEP) if (yes.every((v) => v > c)) failAt = c
  let passAt = 1
  for (let c = 1 - STEP; c > 0; c -= STEP) if (no.every((v) => v < c)) passAt = c

  const spread = (() => {
    try {
      return (JSON.parse(readFileSync(join(dir, 'jev-repeat.json'), 'utf8')) as { worst: number }).worst
    } catch {
      return Number.NaN
    }
  })()

  console.log(`\nFAIL_AT ${failAt.toFixed(2)}   PASS_AT ${passAt.toFixed(2)}` +
    `   REPEAT_SPREAD ${Number.isNaN(spread) ? 'run `repeat` first' : spread.toFixed(3)}`)
  if (passAt <= failAt) {
    console.log('\nThe labels and the judge disagree past any band. The offending rows:')
    for (const r of rows) {
      const wrong = (r.answer === 'yes' && r.noul <= failAt) || (r.answer === 'no' && r.noul >= passAt)
      if (wrong) console.log(`  ${r.bulletId} ${r.questionId} labelled ${r.answer} judged ${r.noul.toFixed(3)} :: ${r.text}`)
    }
    console.log('The owner picks. Nothing here guesses a cut point on its own.')
  } else if (!Number.isNaN(spread) && passAt - failAt < spread) {
    console.log(`\nThe band (${(passAt - failAt).toFixed(3)}) is narrower than the judge's own spread`)
    console.log(`(${spread.toFixed(3)}). Widen it symmetrically and re-run, or the same line passes`)
    console.log('one run and fails the next.')
  }

  // Agreement with the owner's labels, both arms, on the labelled overlap (R13). In-sample for
  // JEV: the cut points were chosen on these same rows, so it is an upper bound and not a
  // held-out score. An unjudged JEV answer is counted separately, never as agreement.
  let jevAgree = 0
  let jevUnjudged = 0
  for (const r of rows) {
    const verdict = r.noul >= passAt ? 'yes' : r.noul <= failAt ? 'no' : null
    if (verdict === null) jevUnjudged += 1
    else if (verdict === r.answer) jevAgree += 1
  }
  const labels = new Map(rows.map((r) => [`${r.fixture}|${r.bulletId}|${r.questionId}`, r.answer]))
  let geminiAgree = 0
  let geminiTotal = 0
  for (const [key, answers] of geminiAnswers(genkitCsv)) {
    const expected = labels.get(key)
    if (!expected) continue
    for (const answer of answers) {
      geminiTotal += 1
      if (answer === expected) geminiAgree += 1
    }
  }
  console.log(`\nagreement with the owner's labels, ${rows.length} labelled rows (clean-en + injected-en):`)
  console.log(`  jev     ${jevAgree} of ${rows.length - jevUnjudged} judged, ${jevUnjudged} unjudged` +
    ' (in-sample: the cut points were chosen on these rows)')
  console.log(`  gemini  ${geminiAgree} of ${geminiTotal}`)

  const inputTokens = cost.reduce((t, c) => t + c.inputTokens, 0)
  const outputTokens = cost.reduce((t, c) => t + c.outputTokens, 0)
  const seconds = cost.map((c) => c.ms / 1000)
  console.log('\nJEV row for A2\'s cost table — four Nouls per bullet, 10 bullets over 3 resumes:')
  console.log(`  ${cost.length} requests, ${inputTokens} input tokens, ${outputTokens} output tokens,` +
    ` s ${Math.min(...seconds).toFixed(1)}/${median(seconds).toFixed(1)}/${Math.max(...seconds).toFixed(1)},` +
    ` $ ${((inputTokens / 1e6) * JEV_PER_M_INPUT).toFixed(6)}`)
  console.log('\nWrite the three cut points, both agreement cells and the JEV row into docs/notes/deps.md')
  console.log('with today\'s date and the model id.')
}

async function main(): Promise<void> {
  const [mode, dir, extra] = process.argv.slice(2)
  if (!dir) throw new Error('usage: jev-probe.ts <body|cap|primitive|language|injection|repeat|batch|label|cuts> <dir> [measure-genkit.csv]')
  switch (mode) {
    case 'body': return body(dir)
    case 'cap': return cap(dir)
    case 'primitive': return primitive()
    case 'language': return language()
    case 'injection': return injection()
    case 'repeat': return repeat(dir)
    case 'batch': return batch(dir)
    case 'label': return label(dir)
    case 'cuts': return cuts(dir, extra)
    default: throw new Error(`unknown mode ${JSON.stringify(mode)}`)
  }
}

main().catch((error) => {
  console.error(describe(error))
  process.exit(1)
})
