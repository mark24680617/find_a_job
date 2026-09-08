import { runLetterheadFill, type FilledLetterhead } from '@/ai/flows/letterheadFill'
import { FlowOutputError } from '@/ai/genkit'
import { requireUser } from '@/lib/auth'
import { getApplication, getProfile, updateApplication } from '@/lib/db'
import { isCoverLetter, readLetterhead } from '@/lib/letter/letterhead'
import { readContact } from '@/lib/profileMerge'
import { extractIdentity } from '@/lib/profileView'
import type { Application, Letterhead } from '@/lib/types'

// The letterhead's sourceable fields, filled in two passes — the profile first, the model only
// for what the profile could not settle. Node runtime (the default): `@/lib/db` reaches Firestore
// through firebase-admin and the Genkit call needs it too; requireUser runs before either.
//
// Pass 1 is deterministic and costs nothing: the contact block the candidate filled in on their
// profile, then whatever their facts happen to say. It is also what keeps the four of them out of
// a context window (spec §4.1) — they are copied across, never read by a model.
//
// It fills BLANKS. A field the person typed is an answer, and an answer is never replaced by
// something read off a document — so clearing a field and asking again is how you accept the
// sourced value after editing it away, and there is no other way to lose what you wrote.
//
// Nothing here is logged: not the facts, not the posting, not what was filled. The whole of this
// route's output is a letterhead, which is contact details for a real person.

type Ctx = { params: Promise<{ id: string }> }

/** How much of the posting the model reads, as the draft route truncates it. */
const JD_LIMIT = 6000

/** The four the profile can answer, and the five the model may. `phone` and `location` are both. */
const FROM_PROFILE = ['name', 'email', 'phone', 'location'] as const
const FILLABLE = ['phone', 'location', 'recipient', 'recipientTitle', 'companyAddress'] as const

/** Every field either pass can write, in the order the panel draws them. */
const FIELDS = [
  'name',
  'email',
  'phone',
  'location',
  'recipient',
  'recipientTitle',
  'companyAddress',
] as const

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

  // Pass 1, off the profile alone: the contact block first, and the facts for whichever of the
  // four it leaves blank — `extractIdentity` is the accident this made deliberate, and it still
  // counts, it is just no longer the only source. Both halves are read through `readContact`,
  // because a claim tagged `location` is a whole sentence and what is stored here is one line of
  // an address block that the PDF typesets. Computed against the letterhead as it stands now,
  // which is what decides whether the model is worth calling at all.
  const contact = readContact(profile.contact)
  const fromFacts = readContact(extractIdentity(profile.facts, profile.standardAnswers))
  const before = readLetterhead(q.letter)
  const sourced: Partial<Letterhead> = {}
  for (const key of FROM_PROFILE) {
    if (before[key].trim() !== '') continue
    const value = contact[key] || fromFacts[key]
    if (value) sourced[key] = value
  }

  // Pass 2, and only when there is something left for it and something for it to read. A call
  // that could fill nothing is a model call spent on nothing, and the prompt builder refuses a
  // call with neither document by throwing a plain `Error`, not a `FlowOutputError`, so it would
  // go past the catch below and answer 500 — which is not something the panel can put in front of
  // anybody. Both documents are missing on their own often enough: an application whose posting
  // was never captured is what the clarify route refuses with its own 400, and a profile before
  // any resume has been ingested has no facts.
  const stillBlank = FILLABLE.filter((key) => (sourced[key] ?? before[key]).trim() === '')
  const hasDocument = app.jdRaw.trim() !== '' || profile.facts.length > 0

  // Refused only when pass 1 found nothing either, which is the whole of "nothing to fill in
  // from". A contact block on a profile with no facts, on an application whose posting was never
  // captured, is four fields this route can still copy across without asking anybody.
  if (stillBlank.length > 0 && !hasDocument && Object.keys(sourced).length === 0) {
    return Response.json(
      {
        error:
          'there is nothing to fill in from — this application has no posting text and your profile has no facts yet',
        fillFailed: true,
      },
      { status: 422 },
    )
  }

  let filled: FilledLetterhead = {}
  if (stillBlank.length > 0 && hasDocument) {
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
  }

  // Both passes' answers in one place, pass 1's winning where they overlap on the phone or the
  // location: it is the person's own, and it was not read off a document by a model.
  for (const key of FILLABLE) {
    const value = filled[key]
    if (value !== undefined && sourced[key] === undefined) sourced[key] = value
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
  for (const key of FIELDS) {
    const value = sourced[key]
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
