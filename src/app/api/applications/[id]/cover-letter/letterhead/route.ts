import { runLetterheadFill } from '@/ai/flows/letterheadFill'
import { FlowOutputError } from '@/ai/genkit'
import { requireUser } from '@/lib/auth'
import { getApplication, getProfile, updateApplication } from '@/lib/db'
import { isCoverLetter, readLetterhead } from '@/lib/letter/letterhead'
import type { Application, Letterhead } from '@/lib/types'

// The letterhead's five sourceable fields, filled from the candidate's facts and the posting.
// Node runtime (the default): `@/lib/db` reaches Firestore through firebase-admin and the Genkit
// call needs it too; requireUser runs before either.
//
// It fills BLANKS. A field the person typed is an answer, and an answer is never replaced by
// something a model read off a document — so clearing a field and asking again is how you accept
// the sourced value after editing it away, and there is no other way to lose what you wrote.
//
// Nothing here is logged: not the facts, not the posting, not what was filled. The whole of this
// route's output is a letterhead, which is contact details for a real person.

type Ctx = { params: Promise<{ id: string }> }

/** How much of the posting the model reads, as the draft route truncates it. */
const JD_LIMIT = 6000

/** The five fields the fill may write, in the order the panel draws them. */
const FILLABLE = ['phone', 'location', 'recipient', 'recipientTitle', 'companyAddress'] as const

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })

  // By kind, never by index, as the PDF route finds it: the letter sits wherever the page
  // appended it and wherever a re-parse has since carried it.
  const q = app.questions.find(isCoverLetter)
  if (!q) return Response.json({ error: 'no cover letter on this application' }, { status: 404 })

  const profile = await getProfile(user.uid)

  // Refused here rather than caught below. The prompt builder refuses a call with neither document
  // by throwing a plain `Error`, not a `FlowOutputError`, so it would go past that catch and answer
  // 500 — and a 500 is not something the panel can put in front of anybody. Both halves are
  // reachable on their own: an application whose posting was never captured is what the clarify
  // route refuses with its own 400, and a profile before any resume has been ingested has no facts.
  if (!app.jdRaw.trim() && profile.facts.length === 0) {
    return Response.json(
      {
        error:
          'there is nothing to fill in from — this application has no posting text and your profile has no facts yet',
        fillFailed: true,
      },
      { status: 422 },
    )
  }

  let filled
  try {
    filled = await runLetterheadFill({
      facts: profile.facts,
      jdText: app.jdRaw.slice(0, JD_LIMIT),
      // The company and the role name which role's office the posting is being read for. Off
      // the interpretation when there is one, off the record when there is not: the draft route
      // refuses without a parsed posting because rule 4 is judged on its `scope`, and nothing
      // here is judged on anything the interpretation adds.
      parsed: app.parsed ?? { company: app.company, role: app.role },
    })
  } catch (error) {
    // The flow could not read the two documents into a letterhead. Its message is the only
    // account of that, so it reaches the wire as a 422 the panel can show rather than a 500.
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, fillFailed: true }, { status: 422 })
    }
    throw error
  }

  // Read again after it. The model call takes seconds and the record can move underneath it, and
  // Firestore's update() replaces `questions` whole — composing the write from the stale copy
  // would revert whatever landed in the window. Same freshness as the draft route.
  const after = await getApplication(user.uid, id)
  if (!after) return Response.json({ error: 'not found' }, { status: 404 })
  const at = after.questions.findIndex(isCoverLetter)
  if (at === -1) {
    return Response.json({ error: 'no cover letter on this application' }, { status: 404 })
  }

  // The blanks of the letterhead as it now stands, and only those. `readLetterhead` is what makes
  // "blank" answerable at all: the application PATCH validates only that its body is an object, so
  // the stored letterhead can be anything a client sent, and a field that is missing, a number or
  // a run of spaces has to read as blank rather than as a typed answer nobody may overwrite.
  const stored = readLetterhead(after.questions[at].letter)
  const taken: Partial<Letterhead> = {}
  for (const key of FILLABLE) {
    const value = filled[key]
    if (value !== undefined && stored[key].trim() === '') taken[key] = value
  }

  // Nothing to write, which is the ordinary outcome rather than the odd one — the kept smoke run
  // filled one field of five, and the panel has a sentence for filling none. The PATCH is the one
  // operation here that can overwrite a change that landed while the model was reading, so it is
  // not made for a write that would change nothing. The question handed back is the stored one,
  // which is what the panel re-seeds from either way.
  if (Object.keys(taken).length === 0) {
    return Response.json({ question: after.questions[at], filled: [] })
  }

  const letter: Letterhead = { ...stored, ...taken }
  const question = { ...after.questions[at], letter }
  const questions = after.questions.map((item, i) => (i === at ? question : item))
  await updateApplication(user.uid, id, { questions } satisfies Partial<Application>)

  // The question as it now stands, and the names of the fields this call filled — which is what
  // the panel says out loud, and is empty both when nothing was blank and when nothing could be
  // sourced. The two are the same outcome to the person: there is nothing more to fill in.
  return Response.json({ question, filled: Object.keys(taken) })
}
