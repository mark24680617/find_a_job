import { FetchBlockedError } from '@/adapters/types'
import { runProfileIngest } from '@/ai/flows/profileIngest'
import { runReconcileFacts } from '@/ai/flows/reconcileFacts'
import { FlowOutputError } from '@/ai/genkit'
import { ProfileIngestOutSchema, type ProfileIngestOut } from '@/ai/schemas'
import { requireUser } from '@/lib/auth'
import { getProfile } from '@/lib/db'
import { readSource, readString, resolvePastedText } from '@/lib/profileSource'
import type { ClarifyAnswer } from '@/lib/types'

// Read a document against the profile that already exists and say what it would change —
// without changing anything. Node runtime (the default): firebase-admin and the Genkit calls
// both need it.
//
// **This route persists nothing.** That is its whole point. The old ingest read a document and
// wrote the result in one motion, so uploading a resume twice said everything twice and there
// was no moment at which a person could disagree. Here the answer is a *proposal*: adds,
// updates, skips-with-reasons and, where a match genuinely cannot be settled, questions. It
// becomes real only when the candidate accepts it at `POST /api/profile/apply`.
//
// It is called more than once per document, which is why the extraction travels in the
// response and back in the body. The first call carries a source (PDF, notes, URL) and pays
// for the extraction; answering a question or describing what the changeset got wrong sends
// that same extraction back and re-reconciles it. No state is kept here between calls — the
// client holds the extraction, and a reconcile is a pure function of what it is given.

/** The empty changeset — what a document with nothing in it proposes. */
const NOTHING = { adds: [], updates: [], skips: [] }

/**
 * The candidate's answers to a previous round, if the body carried any. Anything that is not
 * an answer-shaped object is dropped rather than refused: an answer is an optional hint to the
 * next reconcile, and losing one costs a question re-asked, while a 400 costs the whole run.
 */
function readAnswers(body: unknown): ClarifyAnswer[] {
  const value = (body as Record<string, unknown> | null)?.answers
  if (!Array.isArray(value)) return []
  return value.filter((a): a is ClarifyAnswer => {
    if (typeof a !== 'object' || a === null) return false
    const { id, question, answer } = a as Record<string, unknown>
    if (typeof id !== 'string' || typeof question !== 'string') return false
    return Array.isArray(answer) && answer.every((v) => typeof v === 'string')
  })
}

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const body: unknown = await req.json().catch(() => null)
  const given = (body as Record<string, unknown> | null)?.extraction

  let extraction: ProfileIngestOut
  if (given === undefined) {
    // First call: there is a document to read, and reading it is the expensive half.
    const source = readSource(body)
    if (!source.pdfBase64 && !source.pastedText && !source.url) {
      return Response.json({ error: 'send pdfBase64, pastedText or url' }, { status: 400 })
    }
    let pastedText: string | undefined
    try {
      pastedText = await resolvePastedText(source)
    } catch (error) {
      if (error instanceof FetchBlockedError) {
        return Response.json({ error: error.reason }, { status: 422 })
      }
      throw error
    }
    try {
      extraction = await runProfileIngest({ pdfBase64: source.pdfBase64, pastedText })
    } catch (error) {
      if (error instanceof FlowOutputError) {
        return Response.json({ error: error.message }, { status: 422 })
      }
      throw error
    }
  } else {
    // A repeat call: the client is handing the extraction back so the document is not read —
    // and paid for — twice. It is re-validated because it arrived over the wire, and a
    // malformed one would otherwise reach the prompt as claims nobody extracted.
    const parsed = ProfileIngestOutSchema.safeParse(given)
    if (!parsed.success) {
      return Response.json({ error: 'extraction is not a valid extraction' }, { status: 400 })
    }
    extraction = parsed.data
  }

  // Nothing came out of the document. There is nothing to reconcile, and asking the model to
  // reconcile nothing is asking it to invent a changeset out of the bank alone.
  if (extraction.facts.length === 0) {
    return Response.json({ extraction, changeset: NOTHING, questions: [] })
  }

  const profile = await getProfile(user.uid)

  try {
    const { questions, ...out } = await runReconcileFacts({
      facts: profile.facts,
      extracted: extraction.facts,
      answers: readAnswers(body),
      guidance: readString(body, 'guidance'),
    })
    // A fact cannot both be revised and be already-known: shown side by side those two rows
    // contradict each other, and the person reading them cannot tell which will happen. The
    // prompt asks for at most one; asking is not the same as having, and the commonest case —
    // a stored fact gaining an entity tag while its claim stays put — is exactly where the
    // model reaches for both. The revision is the account that survives, because it is the one
    // with an effect.
    const revised = new Set(out.updates.map((u) => u.id))
    const changeset = { ...out, skips: out.skips.filter((s) => !s.id || !revised.has(s.id)) }
    // The extraction goes back out so the next call can skip the read. Nothing is written.
    return Response.json({ extraction, changeset, questions })
  } catch (error) {
    // The flow refused its own output: a recommended option naming no real option, or two
    // questions sharing an id. Its message says which — let it reach the wire as a 422 the
    // panel can show rather than a 500 with the reason in a log.
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message }, { status: 422 })
    }
    throw error
  }
}
