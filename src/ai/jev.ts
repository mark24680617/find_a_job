import 'server-only'

import { CUTS_MEASURED } from '@/lib/resume/cuts'

/**
 * The judge, as a plain module over one endpoint.
 *
 * Not a Genkit model: JEV has no generate surface, no messages, no streaming and no thinking
 * level, and no Genkit plugin exists. Not the vendor SDK either: this is a direct fetch with an
 * injected `fetch`, so the tests exercise it without a key, and the three things this module must
 * own (the key, the base URL, and the hand-validation of every answer) are exactly the three the
 * SDK would otherwise be deciding. `@typesafe-ai/sdk` is checked, not installed (Task A4). If A4's
 * reading of the SDK's `.d.mts`, recorded in docs/notes/deps.md, shows it accepts an injected
 * fetch, a custom base URL and no implicit env pickup, adopting it later is an install and a
 * transport swap behind this signature. <!-- R4, amended 2026-09-24 -->
 *
 * `import 'server-only'` is the first line so an accidental import from a client component is a
 * build error rather than a runtime surprise, and so a resume's text cannot leave the browser to
 * this endpoint by accident.
 *
 * The wire shape — URL, `Authorization: Bearer`, the `{ model, state, questions }` body and the
 * `{ type: 'noul', noul }` answer — is the one `docs.typesafe.ai/api.md` documents, read
 * 2026-09-25 and recorded in docs/notes/deps.md, "The JEV probe (spec §9.1)". It is unobserved:
 * no TYPESAFE_API_KEY existed, so A4's probe sent no request. Nothing calls JEV while
 * CUTS_MEASURED is false, and the probe's `body` arm is what confirms or corrects it. (R23, R6)
 */

export type Noul = { instructions: string; criteria: { true: string; false: string } }
export type Judgement = { noul: number; model: string }

/**
 * `Judge` is declared in `src/lib/resume/types.ts` (Stage B, Task B1) and re-exported here rather
 * than re-declared: `BulletJudgement`, `DiagnoseResult`, `GapsResult` and `AcceptedRewrite` all
 * carry it and all live in the client-safe types module, which must not reach into a file whose
 * first line is `import 'server-only'`. `import type { Judge } from '@/ai/jev'` still reads the
 * way spec §4 writes it, and is erased before any bundle sees it.
 */
export type { Judge } from '@/lib/resume/types'

/**
 * Pinned, never `jev-latest`: TypeSafe's own instruction is that tuned confidence thresholds are
 * tuned against a version id, and `PASS_AT` / `FAIL_AT` are exactly that. Re-tuning them against a
 * new `jev-1.13.x` is a deps.md entry, which is what the pin buys.
 */
export const JEV_MODEL = 'jev-1.13.0'

/**
 * A constant here and never an environment variable: the endpoint a resume is sent to is a
 * decision in the repo, not a deployment variable (spec §4, §8). Taken from the vendor's
 * documented request, not an observed one (see the module comment).
 */
export const JEV_BASE_URL = 'https://api.typesafe.ai'

/**
 * The maximum questions one request may carry, measured by Task A4's probe and recorded in
 * docs/notes/deps.md's "Maximum questions per request" row — 1024 when the row reads "no cap
 * below 1024". Stage C's own calls carry four, so nothing here approaches it; spec §6.2's skill
 * list is what splits against it. The row reads "JEV not reachable, 2026-09-25", so this is the
 * documented placeholder 64, which no live path reaches: `askNouls` refuses while CUTS_MEASURED
 * is false (R6). A measured `cap` arm replaces it. <!-- R23 -->
 */
export const JEV_MAX_QUESTIONS = 64

/** A judgement nobody is waiting for is an outage. Long enough for a slow answer, short enough
 * that a hung vendor does not hold a Cloud Run request open against the 300 s timeout. */
export const JEV_TIMEOUT_MS = 20_000

/**
 * JEV refused. `status` is the HTTP status the API answered with (401 / 422 / 429 / 529), or 0 for
 * a timeout, a transport failure, a missing key, or an answer that did not survive validation.
 * `field` is the offending field a 422 names, null otherwise.
 *
 * A 422 is the one status the caller must NOT fall back on: it is our bug in a question shape, not
 * a vendor outage, and masking it as a labelled Gemini answer would hide it for good.
 *
 * Nothing thrown from this module carries resume text. These messages become log lines.
 */
export class JevError extends Error {
  readonly status: number
  readonly field: string | null
  constructor(status: number, field: string | null, message: string) {
    super(message)
    this.name = 'JevError'
    this.status = status
    this.field = field
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A 422 names the field it refused. Read defensively: the shape is the vendor's, not ours. */
function fieldFrom(body: unknown): string | null {
  if (!isRecord(body)) return null
  const error = isRecord(body.error) ? body.error : body
  const field = error.field ?? error.param ?? error.path
  return typeof field === 'string' && field !== '' ? field : null
}

/**
 * One request, one state, many questions. Throws `JevError`; the caller decides whether to fall
 * back (spec §4: everything but a 422 does).
 *
 * Every answer is hand-validated before it is returned: the response names the pinned model, the
 * response is typed `noul`, the answer-id set equals the question-id set exactly, and each `noul`
 * is finite and in [0,1]. A Noul answer carries no `confidence` and no `probabilities` map — that
 * map is documented on `Choice` and `Score`, neither of which appears anywhere in this product — so
 * no keys-sum-to-one rule is applied. A validation failure throws status 0, so it falls back: we cannot tell a malformed
 * answer from a bad day, and the honest disposition for both is the other judge. A model mismatch
 * falls back like any other validation failure.
 */
export async function askNouls(
  state: string,
  questions: Record<string, Noul>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Record<string, Judgement>> {
  // R6: JEV is asked only when its cut points were measured and a key is configured. Unmeasured
  // cuts are placeholders, and a placeholder band must never gate a count on the page — so this
  // throws status 0 before any request, and every caller takes the permanent Gemini fallback.
  if (!CUTS_MEASURED) throw new JevError(0, null, 'the JEV cut points are not measured (docs/notes/deps.md)')

  const key = process.env.TYPESAFE_API_KEY
  // Read here rather than left to the SDK's implicit pickup, so there is exactly one place in the
  // repo where this key is named (spec §8).
  if (!key) throw new JevError(0, null, 'TYPESAFE_API_KEY is not set')

  const ids = Object.keys(questions)
  if (ids.length === 0) throw new JevError(0, null, 'askNouls was called with no questions')

  let response: Response
  try {
    response = await fetchImpl(`${JEV_BASE_URL}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions: Object.fromEntries(ids.map((id) => [id, { type: 'noul', ...questions[id] }])),
      }),
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    })
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : 'Error'
    throw new JevError(0, null, `the judge could not be reached (${name})`)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const field = response.status === 422 ? fieldFrom(body) : null
    throw new JevError(
      response.status,
      field,
      `the judge answered ${response.status}${field === null ? '' : ` for ${field}`}`,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new JevError(0, null, 'the judge answered a body that is not JSON')
  }
  if (!isRecord(body) || !isRecord(body.answers)) {
    throw new JevError(0, null, 'the judge answered a body with no answers')
  }

  const answers = body.answers
  const answered = Object.keys(answers)
  if (answered.length !== ids.length || !ids.every((id) => answered.includes(id))) {
    throw new JevError(0, null, 'the judge answered a different set of questions than it was asked')
  }

  if (body.model !== JEV_MODEL) {
    throw new JevError(0, null, 'the judge answered from a model other than the pinned one')
  }
  const model = JEV_MODEL
  const out: Record<string, Judgement> = {}
  for (const id of ids) {
    const answer = answers[id]
    if (!isRecord(answer) || answer.type !== 'noul') {
      throw new JevError(0, null, `the judge answered ${id} with something other than a noul`)
    }
    const noul = answer.noul
    if (typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) {
      throw new JevError(0, null, `the judge answered ${id} with a value that is not a probability`)
    }
    out[id] = { noul, model }
  }
  return out
}
