import { requireUser } from '@/lib/auth'
import { getProfile, setProfile } from '@/lib/db'
import { nextFactId } from '@/lib/profileView'
import type { Changeset, Fact, FactAdd, FactUpdate } from '@/lib/types'

// Accept one reconciled changeset. This is the only route on the profile screen that writes,
// and it writes exactly what the candidate was shown and nothing else. Node runtime (the
// default): `@/lib/db` reaches Firestore through firebase-admin.
//
// Two things are never taken from the client:
//
//   - **Fact ids for adds.** The body's adds carry no id, and if one arrived it is dropped: the
//     bank allocates ids, one past its own highest, exactly as `mergeIngest` does. A client that
//     could name an id could overwrite any fact in the vault by calling it an add.
//   - **That an update's id exists.** The changeset was computed against the bank as it stood
//     when the panel opened; another tab may have deleted that fact since. An update naming a
//     fact that is not there now is refused by name rather than applied to nothing, because
//     "updated 3" when one of them went nowhere is a lie about someone's own record.
//
// `skips` are read and ignored on purpose: they are the account of what was NOT changed, shown
// on screen so nothing is dropped in silence, and they have no effect to apply.

/** True when `value` is an array of strings — the only shape a tag list may have. */
function isTagList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((t) => typeof t === 'string')
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** An add, or null for anything that is not one. Only the three fields survive. */
function asAdd(value: unknown): FactAdd | null {
  if (typeof value !== 'object' || value === null) return null
  const { claim, sourceSnippet, tags } = value as Record<string, unknown>
  if (!isText(claim) || typeof sourceSnippet !== 'string' || !isTagList(tags)) return null
  return { claim, sourceSnippet, tags }
}

/** An update, or null for anything that is not one. Only the three fields survive. */
function asUpdate(value: unknown): FactUpdate | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, claim, tags } = value as Record<string, unknown>
  if (!isText(id) || !isText(claim) || !isTagList(tags)) return null
  return { id, claim, tags }
}

/** The changeset off the body, or null if the body is not carrying one. */
function asChangeset(body: unknown): Changeset | null {
  if (typeof body !== 'object' || body === null) return null
  const { changeset } = body as Record<string, unknown>
  if (typeof changeset !== 'object' || changeset === null) return null
  const { adds, updates, skips } = changeset as Record<string, unknown>
  if (!Array.isArray(adds) || !Array.isArray(updates)) return null
  if (skips !== undefined && !Array.isArray(skips)) return null

  const parsedAdds = adds.map(asAdd)
  const parsedUpdates = updates.map(asUpdate)
  if (parsedAdds.some((a) => a === null) || parsedUpdates.some((u) => u === null)) return null
  return {
    adds: parsedAdds as FactAdd[],
    updates: parsedUpdates as FactUpdate[],
    skips: [],
  }
}

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const changeset = asChangeset(await req.json().catch(() => null))
  if (!changeset) {
    return Response.json({ error: 'body must be { changeset: { adds, updates } }' }, { status: 400 })
  }

  const profile = await getProfile(user.uid)
  const held = new Set(profile.facts.map((f) => f.id))
  const missing = changeset.updates.find((u) => !held.has(u.id))
  if (missing) {
    return Response.json(
      { error: `no fact ${missing.id} in your profile — it may have been deleted since` },
      { status: 400 },
    )
  }

  // Keyed by id so two updates naming the same fact are one update, not two: the count that
  // comes back is what actually changed, and the last word wins.
  const revisions = new Map(changeset.updates.map((u) => [u.id, u]))
  const revised: Fact[] = profile.facts.map((fact) => {
    const revision = revisions.get(fact.id)
    // The claim and the tags are the revision's; the id and the source snippet are the stored
    // fact's. A revision that rewrote the snippet would be rewriting the evidence.
    return revision ? { ...fact, claim: revision.claim, tags: revision.tags } : fact
  })

  const from = Number(nextFactId(revised).slice(1))
  const added: Fact[] = changeset.adds.map((add, i) => ({ ...add, id: `f${from + i}` }))

  const updated = { ...profile, facts: [...revised, ...added] }
  await setProfile(user.uid, updated)
  return Response.json({ profile: updated, added: added.length, updated: revisions.size })
}
