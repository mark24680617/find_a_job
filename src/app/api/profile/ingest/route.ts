import { runProfileIngest } from '@/ai/flows/profileIngest'
import { FetchBlockedError } from '@/adapters/types'
import { requireUser } from '@/lib/auth'
import { getProfile, setProfile } from '@/lib/db'
import { mergeIngest } from '@/lib/profileMerge'
import { readSource, resolvePastedText } from '@/lib/profileSource'

// Upload a resume PDF, paste notes, and/or hand over the address of a portfolio page; the
// extracted facts are folded into the stored profile and the whole updated profile comes back.
// Merge rules live in `mergeIngest`; what counts as a readable source lives in
// `@/lib/profileSource`. Node runtime (the default): firebase-admin and the Genkit call both
// need it.
//
// This is the append path, and it appends: the same document twice writes the same facts twice.
// The profile screen no longer uses it — it goes through `/api/profile/reconcile` and
// `/api/profile/apply`, which show the candidate a changeset before anything is stored. What
// still comes through here is machinery with no screen to review on: the sample seeder, and the
// story a candidate types against one answer.

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const source = readSource(await req.json().catch(() => null))
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

  const out = await runProfileIngest({ pdfBase64: source.pdfBase64, pastedText })
  // Read after the model call, not before: it is the slow half, and a profile read taken
  // afterwards is the freshest one available to merge into.
  const merged = mergeIngest(await getProfile(user.uid), out)
  await setProfile(user.uid, merged)
  return Response.json(merged)
}
