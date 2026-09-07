import { runAssignmentTranscribe } from '@/ai/flows/assignmentTranscribe'
import { FlowOutputError } from '@/ai/genkit'
import { FetchBlockedError } from '@/adapters/types'
import { requireUser } from '@/lib/auth'
import { cutBrief, MAX_PDF_BYTES, MIN_BRIEF_CHARS } from '@/lib/assignment'
import { getApplication, getInterview, replaceAssignment } from '@/lib/db'
import { readBrief } from '@/lib/readBrief'
import type { Assignment } from '@/lib/types'

// The brief arrives. Three ways in — pasted, a PDF the model transcribes, a public link read
// through the guarded fetcher — and one text out, stored on the round. Node runtime (the
// default): `@/lib/db` reaches Firestore through firebase-admin and the transcription needs it
// too; requireUser runs before either.
//
// The three paths differ only in how the text is got. Everything after that is one rule,
// applied here and nowhere under it: trimmed, refused under MIN_BRIEF_CHARS, cut at
// MAX_BRIEF_CHARS with the record saying so. `readBrief` and `runAssignmentTranscribe` each
// return whatever they read and hold no floor of their own, which is what keeps a two-line PDF
// and a two-line paste refused in the same words at the same length instead of one path being
// lenient where the other is strict.
//
// Nothing is written unless a brief was actually read: a link that could not be fetched and a
// PDF the model could not transcribe are both 422s that leave the round exactly as it was,
// notice and brief and plan and all. And the write goes through `replaceAssignment` rather than
// `updateInterview`, because storing a brief has to take the plan drawn from the previous one
// with it — see the helper for why an `undefined` could not have said that.

type Ctx = { params: Promise<{ id: string; rid: string }> }

const bad = (error: string, status = 400): Response => Response.json({ error }, { status })

/**
 * The one shape every failed read takes. `readFailed` is what tells the panel to show the reason
 * against the input the candidate is looking at rather than as a failure of the round: the round
 * is fine, and the document is the thing that could not be read.
 */
const unread = (error: string): Response =>
  Response.json({ error, readFailed: true }, { status: 422 })

/** A field the client either sent as a usable string or did not usefully send at all. */
function readString(body: unknown, key: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The one input the body carries, or null when it carries none or several. Exactly one, because
 * the three are three readings of the same thing: a body with both a paste and a link in it is a
 * screen that lost track of which the candidate meant, and picking one would store that document
 * under a source line naming the other. An empty string is nothing sent, so a cleared field is a
 * field that is not there.
 */
function readInput(body: unknown): { source: Assignment['source']; value: string } | null {
  // Annotated, not inferred: the predicate below has to be assignable to the element type, and
  // an inferred tuple of literals is three different types rather than one.
  const candidates: [Assignment['source'], string | undefined][] = [
    ['pasted', readString(body, 'pastedText')],
    ['pdf', readString(body, 'pdfBase64')],
    ['url', readString(body, 'url')],
  ]
  const given = candidates.filter(
    (entry): entry is [Assignment['source'], string] => entry[1] !== undefined,
  )
  return given.length === 1 ? { source: given[0][0], value: given[0][1] } : null
}

/**
 * The brief's text by whichever way it came, or the response that says why it could not be read.
 * Everything path-specific lives here so that what follows it in POST is the one rule the three
 * share, written once.
 */
async function readInputText(input: {
  source: Assignment['source']
  value: string
}): Promise<string | Response> {
  if (input.source === 'pasted') return input.value

  if (input.source === 'url') {
    try {
      return await readBrief(input.value)
    } catch (error) {
      // Every reason the fetcher refuses is already written for the person reading it and
      // already ends in what to do instead. Passed through rather than reworded a second time.
      if (error instanceof FetchBlockedError) return unread(error.reason)
      throw error
    }
  }

  // Measured decoded rather than as base64: the string on the wire is a third longer than the
  // file, and the limit is about the document the model is asked to read. Checked before the
  // call, so an oversized upload costs a request and not a model call.
  if (Buffer.from(input.value, 'base64').byteLength > MAX_PDF_BYTES) {
    return bad('that PDF is over 6 MB — paste the brief’s text instead', 413)
  }
  try {
    return (await runAssignmentTranscribe({ pdfBase64: input.value })).text
  } catch (error) {
    if (error instanceof FlowOutputError) return unread(error.message)
    throw error
  }
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id, rid } = await ctx.params
  // Both before anything else: a brief is stored ON this round, under THIS application, and
  // neither a fetch nor a model call is worth spending on a record that is not the caller's.
  const [app, round] = await Promise.all([
    getApplication(user.uid, id),
    getInterview(user.uid, id, rid),
  ])
  if (!app || !round) return bad('not found', 404)
  // The mirror of the 400 the brief and mock routes give a take-home round: every other kind of
  // round is a conversation to prepare for, and there is no document in the candidate's hands.
  if (round.roundType !== 'take-home') return bad('only a take-home round has a brief')

  const input = readInput(await req.json().catch(() => null))
  if (!input) return bad('send pastedText, pdfBase64 or url — one of them')

  const raw = await readInputText(input)
  if (raw instanceof Response) return raw

  const trimmed = raw.trim()
  // Under this there is nothing to plan from: a covering note, a login wall's apology, the one
  // page of a PDF the model could make out. Said in one wording whichever path it came down,
  // because from here on the three are the same text.
  if (trimmed.length < MIN_BRIEF_CHARS) {
    return unread('that is too short to plan from — paste the whole brief')
  }
  // Cut rather than refused at the top end, and the record carries `cut` so the screen can say
  // the plan was drawn from a brief with its tail missing.
  const { text, cut } = cutBrief(trimmed)

  // Annotated rather than inferred, for the reason the brief route's composition is: composed
  // into a variable this loses excess property checking, and a misspelled key would be stored
  // beside the right one. `addedAt` is also this brief's identity — the plan records which brief
  // it was drawn from by exactly this string — so it is stamped once, here, as it is stored.
  const assignment: Assignment = {
    text,
    source: input.source,
    // The address as the candidate gave it, never the rewritten one: the line on screen links to
    // what they pasted, and the export form `readBrief` fetches is an implementation detail of
    // reading it rather than a place they can go and look.
    ...(input.source === 'url' ? { url: input.value } : {}),
    addedAt: new Date().toISOString(),
    cut,
  }
  await replaceAssignment(user.uid, id, rid, assignment)

  // Read back rather than composed, so the page replaces its copy with the round exactly as it
  // is stored — the plan that the write has just deleted gone from it too.
  const fresh = await getInterview(user.uid, id, rid)
  if (!fresh) return bad('not found', 404)
  return Response.json(fresh)
}
