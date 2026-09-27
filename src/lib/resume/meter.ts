import { adminDb } from '@/lib/firebase/admin'

/**
 * The day's meters. This half reads: how much one account has spent today, and whether the
 * resume tools are switched on at all. Task B9 adds the half that writes — the ceilings and the
 * one transaction that takes a permit before a model call.
 *
 * `usageFor` **reports** these counters; it does not enforce them. Enforcement is the
 * transaction, because `usageFor` is a read and a read-then-check ceiling in front of a plain
 * POST is defeated by concurrency (spec §5.5, §8).
 */

/**
 * Everything a permit is taken for. `upload` is one of them although it calls no model: the
 * parse is up to `MAX_EXTRACT_MS` of CPU on a 512 Mi instance, and a ceiling that stops at the
 * model calls leaves the most expensive non-model path on the feature unbounded (spec §8, and
 * the plan's route table for `POST /api/profile/resumes`).
 */
export type MeteredTool = 'upload' | 'diagnose' | 'gaps' | 'rewrite'

/** The tools a permit is taken for, in the order the page runs them. */
export const METERED_TOOLS: readonly MeteredTool[] = ['upload', 'diagnose', 'gaps', 'rewrite']

/**
 * The per-deployment counter for a day, and the per-uid counter under it. Top level rather than
 * under `users/{uid}`, because the deployment counter is about every account at once (spec §8).
 */
const dayMeterDoc = (day: string) => adminDb.collection('meters').doc(day)
const uidMeterDoc = (day: string, uid: string) => dayMeterDoc(day).collection('uids').doc(uid)

/** A stored counter, or zero. Anything that is not a whole positive number is not a count. */
function countOf(data: Record<string, unknown> | undefined, key: string): number {
  const n = data?.[key]
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * The kill switch for the judged window (spec §8). Anything but the literal `'true'` turns the
 * routes off — including the variable being absent — for the reason `requireAdmin` reads its
 * claim the same way: "truthy" is not a policy.
 */
export function resumeToolsEnabled(): boolean {
  return process.env.RESUME_TOOLS_ENABLED === 'true'
}

/**
 * How many metered runs this account has spent on `day` — uploads included, since an upload
 * takes a permit like the rest. Counts only; nothing personal.
 */
export async function reviewsToday(uid: string, day: string): Promise<number> {
  const snap = await uidMeterDoc(day, uid).get()
  const data = snap.data()
  return METERED_TOOLS.reduce((sum, tool) => sum + countOf(data, tool), 0)
}

/**
 * Per uid, per day (spec §8). Rewrite's unit is bullets, not calls; Diagnose's is up to 20 judged
 * bullets (`diagnoseCost`, final review), so a resume of up to 20 bullets gets ten runs a day.
 *
 * `upload` is here although the upload route calls no model. `MAX_EXTRACT_MS` is 20 seconds of
 * CPU on a 512 Mi instance, and the two 413s and the extraction bounds cap ONE upload, not
 * a day of them — so without this row an authenticated account holds an instance busy for free.
 * 20 is generous for a person replacing a resume and useless as a way to keep one pinned.
 */
export const UID_CEILING: Record<MeteredTool, number> = {
  upload: 20,
  diagnose: 10,
  gaps: 10,
  rewrite: 40,
}

/**
 * The per-deployment ceiling, in metered units across every account in a day, when the owner has
 * not set one. It limits units, not dollars. The plan priced it on one rewrite bullet at the
 * four-model-call ceiling, $0.076 (spec §11), as the most expensive unit — 200 of those is about
 * $15 — but that is not a bound on the day (final review, docs-3): a Diagnose unit is up to
 * DIAGNOSE_BULLETS_PER_UNIT judge calls (~$0.012 on the Gemini fallback at deps.md's measured
 * $0.0059 for ten) plus one findings call a run, and a Gaps unit is one judge call per 64 skills
 * in the role family, each carrying the resume's visible text. Neither the findings call nor the
 * Gaps calls are measured yet, so no dollar figure is claimed for 200 units. Uploads count
 * against it too: the 20-second parse is the CPU this ceiling guards (R48).
 *
 * **Accepted by the owner on 2026-09-21** as the default; `RESUME_DEPLOYMENT_CEILING` overrides
 * it without a deploy. The spec says "a number the owner sets before the first deploy" and names
 * no default; this one is the plan's, with its arithmetic. (amended 2026-09-24, B-16)
 */
export const DEPLOYMENT_CEILING_DEFAULT = 200

/**
 * How many judged bullets one Diagnose unit covers: spec §11's Diagnose row is priced on 20.
 * Every bullet is one judge call (four Nouls on JEV, one Gemini call on the fallback), so a flat
 * unit let a long document buy many units' worth of calls. A resume of up to 20 visible bullets
 * still costs one unit; MAX_RESUME_BULLETS (200) costs ten, the per-uid day.
 */
export const DIAGNOSE_BULLETS_PER_UNIT = 20

/** The units a Diagnose run over `judged` visible bullets takes: one per 20 begun, at least one. */
export const diagnoseCost = (judged: number): number =>
  Math.max(1, Math.ceil(judged / DIAGNOSE_BULLETS_PER_UNIT))

/**
 * Read per call rather than frozen into a module constant, so the number can be changed with a
 * `--set-env-vars` and a restart rather than with a deploy. Anything but a whole positive number
 * is the default, for the reason the kill switch reads its own variable strictly.
 */
export function deploymentCeiling(): number {
  const raw = Number(process.env.RESUME_DEPLOYMENT_CEILING)
  return Number.isInteger(raw) && raw > 0 ? raw : DEPLOYMENT_CEILING_DEFAULT
}

/**
 * Both counters read and incremented in ONE transaction, before the model call — never
 * read-then-check. These are plain POSTs with no queue and nothing in front of them, so parallel
 * requests would otherwise all read the same count and all pass.
 *
 * The increment IS the permit: a refused or failed call does not refund it. That is deliberate.
 * A refund path is a second write on the error path, and an error path that writes is how a
 * ceiling becomes optional under exactly the load it exists for.
 *
 * `day` is `YYYY-MM-DD` from the caller's clock, the `todayPart` convention. `cost` is 1 for
 * upload and gaps, `diagnoseCost` of the visible bullets for diagnose, and the bullet count for
 * rewrite. A cost that would step over the
 * ceiling is refused whole rather than clipped: half a rewrite is not a thing the user asked for.
 *
 * "Before the model call" is the rule on the three tool routes. On upload there is no model call,
 * so the permit goes in front of the extraction instead — the first expensive thing on that path.
 */
export async function takePermit(
  uid: string,
  tool: MeteredTool,
  day: string,
  cost = 1,
): Promise<'ok' | 'uid-limit' | 'deployment-limit'> {
  const dayRef = dayMeterDoc(day)
  // From the day document already in hand, not through `uidMeterDoc`, which would walk the day
  // path a second time (R16).
  const uidRef = dayRef.collection('uids').doc(uid)

  return adminDb.runTransaction(async (tx) => {
    // Every read before every write, which is the transaction's own rule.
    const [daySnap, uidSnap] = await tx.getAll(dayRef, uidRef)
    const used = countOf(uidSnap.data(), tool)
    if (used + cost > UID_CEILING[tool]) return 'uid-limit'
    const spent = countOf(daySnap.data(), 'total')
    if (spent + cost > deploymentCeiling()) return 'deployment-limit'

    tx.set(uidRef, { [tool]: used + cost }, { merge: true })
    tx.set(dayRef, { total: spent + cost }, { merge: true })
    return 'ok'
  })
}

// ── The refusals (amended 2026-09-24, R49) ───────────────────────────────────────────────
// One wording for each, here beside the ceilings they report, so the five metered routes (B7,
// C10, D6, E4, E5) answer in one voice rather than five drifting copies. Lower case with an em
// dash, the shape of every other refusal on this feature; typographic apostrophes, because the
// page renders these sentences.

/** The 503 every metered route answers with while `RESUME_TOOLS_ENABLED` is not `'true'`. */
export const TOOLS_OFF_MESSAGE = 'the resume tools are switched off right now'

/** The per-uid 429. One sentence for every tool, so `permitRefusal` needs only the result. */
export const UID_SPENT_MESSAGE =
  'that is today’s allowance of this tool for this account — try again tomorrow'

/** The per-deployment 429 (spec §8: "the page says the day's budget is spent"). */
export const DEPLOYMENT_SPENT_MESSAGE =
  'the day’s budget for the resume tools is spent — try again tomorrow'

/**
 * What a route answers when `takePermit` refuses: always 429, the sentence for that ceiling,
 * and which ceiling it was, so the page can say whether tomorrow or another account would help.
 * A route writes `const r = permitRefusal(permit); return Response.json(r.body, { status: r.status })`.
 */
export function permitRefusal(result: 'uid-limit' | 'deployment-limit'): {
  status: 429
  body: { error: string; ceiling: 'uid' | 'deployment' }
} {
  return result === 'uid-limit'
    ? { status: 429, body: { error: UID_SPENT_MESSAGE, ceiling: 'uid' } }
    : { status: 429, body: { error: DEPLOYMENT_SPENT_MESSAGE, ceiling: 'deployment' } }
}

export { countOf, dayMeterDoc, uidMeterDoc }
