import { runClarifyDraft } from '@/ai/flows/clarifyDraft'
import { FlowOutputError } from '@/ai/genkit'
import type { ClarifyDraftOut } from '@/ai/schemas'
import { requireUser } from '@/lib/auth'
import { getApplication, getProfile, updateApplication } from '@/lib/db'
import type { Application, Question } from '@/lib/types'

// Set up one question's answer before it is written: read what the role screens for out of
// the posting, and ask the human the positioning calls only they can make. Node runtime (the
// default): `@/lib/db` reaches Firestore through firebase-admin and the Genkit call needs it
// too; requireUser runs before either.
//
// This is the depth step. Drafting straight from facts lists them; asking these questions
// first lets the draft POSITION the candidate. The step is skippable — a draft can run with
// no clarify answers at all — so this route only ever writes the questions onto the record;
// the human's answers arrive back through the draft route.

type Ctx = { params: Promise<{ id: string; idx: string }> }

/** How much of the posting the model reads. Long postings are truncated, not refused. */
const JD_LIMIT = 6000

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id, idx } = await ctx.params
  // A whole number and nothing else — same guard as the draft route: `Number('1.5')` and
  // `Number(' 1')` both parse, and neither is an index into an array.
  if (!/^\d+$/.test(idx)) {
    return Response.json({ error: 'question index must be a whole number' }, { status: 400 })
  }
  const at = Number(idx)

  // Read before the call: this flow's INPUT is the stored question, so it cannot be deferred,
  // and it means the model is never spent on an application that is not there, or not this
  // user's.
  const before = await getApplication(user.uid, id)
  if (!before) return Response.json({ error: 'not found' }, { status: 404 })

  const asked = before.questions[at]
  if (!asked) return Response.json({ error: 'no question at that index' }, { status: 400 })
  // The whole step is reasoning about the role, and both inputs to that reasoning have to be
  // present. Without the parsed posting there is no read of what the role screens for; without
  // the raw posting there is nothing to read it from. Either missing, there is no honest set
  // of positioning questions to ask — so it is refused rather than guessed.
  if (!before.parsed) {
    return Response.json({ error: 'interpret the posting before clarifying' }, { status: 400 })
  }
  if (!before.jdRaw.trim()) {
    return Response.json(
      { error: 'this application has no posting text to reason about — re-create it from a link or paste' },
      { status: 400 },
    )
  }

  const profile = await getProfile(user.uid)

  let out: ClarifyDraftOut
  try {
    out = await runClarifyDraft({
      question: asked,
      jdText: before.jdRaw.slice(0, JD_LIMIT),
      facts: profile.facts,
      standardAnswers: profile.standardAnswers,
      // Always empty: a fresh round supersedes and its answers are cleared on the write below,
      // so the generation must be fresh too. Feeding the prior answers would let the model skip
      // re-asking positioning we are about to discard — silently dropping that decision. The
      // model asks a complete frontier instead; the prompt's prior-choices section stays unused.
      clarifyAnswers: [],
    })
  } catch (error) {
    // The flow refused its own output: a recommended option that names no real option. Its
    // message says which question, and that message is the only account of the failure — let
    // it reach the wire as a 422 the UI can show rather than a 500 with the reason in a log.
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, clarifyFailed: true }, { status: 422 })
    }
    throw error
  }

  // Read again after it. The model call takes seconds and the record can move underneath it,
  // and Firestore's update() replaces `questions` whole — composing the write from the stale
  // copy would revert anything that landed in the window. Same freshness as the parse route.
  const after = await getApplication(user.uid, id)
  if (!after) return Response.json({ error: 'not found' }, { status: 404 })
  // A re-parse replaces the question list wholesale, so the slot may now hold a different
  // question. Attaching positioning questions written about the old one to the new one would
  // be worse than losing them, so it is refused. (The limit is irrelevant here — clarify does
  // not read it — so only the wording is checked.)
  const current = after.questions[at]
  if (!current || current.q !== asked.q) {
    return Response.json({ error: 'questions changed while clarifying' }, { status: 409 })
  }

  // A fresh round supersedes: its ids are numbered c1..cN from scratch, so any answers stored
  // against the previous round's ids no longer name these questions. Clearing them in the same
  // write keeps the invariant the draft route depends on — clarifyAnswers are always answers to
  // the CURRENT clarify[] set — so mergeClarify can never key a new answer onto a stale one.
  const clarified: Question = { ...current, clarify: out.questions, clarifyAnswers: [] }
  const questions = after.questions.map((q, i) => (i === at ? clarified : q))
  await updateApplication(user.uid, id, { questions } satisfies Partial<Application>)
  return Response.json(clarified)
}
