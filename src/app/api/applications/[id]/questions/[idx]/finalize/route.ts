import { runFeedbackDistill } from '@/ai/flows/feedbackDistill'
import { FlowOutputError } from '@/ai/genkit'
import { requireUser } from '@/lib/auth'
import { getApplication, getProfile, setProfile, updateApplication } from '@/lib/db'
import type { Application, Question, VoiceRule } from '@/lib/types'

// Save the human's final answer to one question, then learn from what they changed. Node
// runtime (the default): `@/lib/db` reaches Firestore through firebase-admin and the Genkit
// call needs it too; requireUser runs before either.
//
// This is where the loop closes. The human edits the draft into the words they actually
// submit, and the difference between those two texts is the only real signal this product
// has for how THIS person writes. So the finalize does two things, in this order and no
// other: it saves the final, then it tries to distill a voice rule from the edit.
//
// The order is the whole contract. The save is the human's work; the learning is the
// machine's, and the machine's optional extra must never be able to cost the human their
// save. So the final is written FIRST and unconditionally, and every failure the learning
// step can throw is caught after it — a distilled rule is a bonus, a lost final is a bug.

/** The most recent twelve rules are kept; an older one falls off when a new one is learned. */
const VOICE_RULES_CAP = 12

type Ctx = { params: Promise<{ id: string; idx: string }> }

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const body: unknown = await req.json().catch(() => null)
  const final = (body as Record<string, unknown> | null)?.final
  // A string, empty or not: clearing an answer is the human's call. Anything else would be
  // stored and shown as the words they submitted, which it is not.
  if (typeof final !== 'string') {
    return Response.json({ error: 'final answer must be text' }, { status: 400 })
  }

  const { id, idx } = await ctx.params
  // A whole number and nothing else — the same guard the draft route uses: `Number(' 1')`
  // and `Number('1.5')` both come back usable, and neither is an index into an array.
  if (!/^\d+$/.test(idx)) {
    return Response.json({ error: 'question index must be a whole number' }, { status: 400 })
  }
  const at = Number(idx)

  // Read once, guard, write. There is no re-read window to worry about here: the final is the
  // human's own text, already in hand, and the model call that could move the record
  // underneath us comes AFTER this write, not before it.
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })

  const existing = app.questions[at]
  if (!existing) return Response.json({ error: 'no question at that index' }, { status: 400 })

  const question: Question = { ...existing, final, status: 'final' }
  const questions = app.questions.map((q, i) => (i === at ? question : q))
  await updateApplication(user.uid, id, { questions } satisfies Partial<Application>)

  // Nothing was edited if there is no draft to compare the final against, or the human kept
  // it word for word. Either way there is no signal, so the model is never called and the
  // save stands on its own.
  const draft = existing.draft
  if (!draft || draft.text === final) {
    return Response.json({ question, newRules: [] })
  }

  // From here on the save is safe on the record. The learning is best-effort: if the flow
  // cannot produce rules that fit its schema it throws FlowOutputError, which is the model's
  // failure and not the human's — so it is caught, and the save is reported as the success it
  // already is. Only a FlowOutputError is swallowed; a Firestore outage or a bug is not the
  // human's to act on and goes up as a 500, with the final already on the record either way.
  const profile = await getProfile(user.uid)
  let newRules: VoiceRule[]
  try {
    const distilled = await runFeedbackDistill({
      draft: draft.text,
      final,
      // The rule text is what the model must avoid restating; the evidence behind each is the
      // profile editor's, not material for this call.
      existingRules: profile.voiceRules.map((r) => r.rule),
    })
    const now = new Date().toISOString()
    newRules = distilled.rules.map((r) => ({ rule: r.rule, evidence: r.evidence, createdAt: now }))
  } catch (error) {
    if (error instanceof FlowOutputError) return Response.json({ question, newRules: [] })
    throw error
  }

  // No rules distilled is a real, common answer — the edit showed no pattern worth keeping —
  // so the profile is only touched when there is something to add.
  if (newRules.length > 0) {
    // Newest at the end, capped at twelve: the oldest rule is the one that falls off, since
    // the way a person writes now is the better guide to how they will write next.
    const voiceRules = [...profile.voiceRules, ...newRules].slice(-VOICE_RULES_CAP)
    await setProfile(user.uid, { ...profile, voiceRules })
  }

  return Response.json({ question, newRules })
}
