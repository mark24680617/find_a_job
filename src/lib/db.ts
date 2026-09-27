import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { utcToday } from '@/lib/dates'
import { reviewsToday } from '@/lib/resume/meter'
import type { AcceptedRewrite, AnsweredAsk, Application, Assignment, InterviewRound, Profile, StoredResume, Usage } from '@/lib/types'

// Firestore accessors. Everything is scoped under users/{uid}, so a caller that has
// authenticated a uid cannot reach another user's data by construction. Mapping only —
// the stored document omits the `id` field and reads put the document id back on.

const userDoc = (uid: string) => adminDb.collection('users').doc(uid)
const appsCol = (uid: string) => userDoc(uid).collection('applications')
const roundsCol = (uid: string, appId: string) => appsCol(uid).doc(appId).collection('interviews')
const resumesCol = (uid: string) => userDoc(uid).collection('resumes')

const emptyProfile = (): Profile => ({ facts: [], standardAnswers: {}, voiceRules: [], gaps: [] })

/** Missing document and missing keys both read back as the empty shape, never `undefined`. */
export async function getProfile(uid: string): Promise<Profile> {
  const snap = await userDoc(uid).get()
  return { ...emptyProfile(), ...(snap.data() as Partial<Profile> | undefined) }
}

export async function setProfile(uid: string, p: Profile): Promise<void> {
  await userDoc(uid).set(p)
}

export async function listApplications(uid: string): Promise<Application[]> {
  const snap = await appsCol(uid).orderBy('createdAt', 'desc').get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Application, 'id'>), id: d.id }))
}

export async function getApplication(uid: string, id: string): Promise<Application | null> {
  const snap = await appsCol(uid).doc(id).get()
  const data = snap.data()
  return data ? { ...(data as Omit<Application, 'id'>), id: snap.id } : null
}

export async function createApplication(uid: string, a: Omit<Application, 'id'>): Promise<string> {
  const ref = await appsCol(uid).add(a)
  return ref.id
}

/** Firestore `update()`: a partial merge, not an upsert — throws NOT_FOUND if the doc is missing. */
export async function updateApplication(
  uid: string,
  id: string,
  patch: Partial<Application>,
): Promise<void> {
  await appsCol(uid).doc(id).update(patch)
}

/**
 * Deletes the application and everything under it. `recursiveDelete` walks the subcollections
 * a document delete would otherwise orphan — the interviews live there, and Firestore keeps
 * them reachable after their parent is gone. Deleting what was never there is not an error, so
 * the route checks the record exists before calling this.
 */
export async function deleteApplication(uid: string, id: string): Promise<void> {
  await adminDb.recursiveDelete(appsCol(uid).doc(id))
}

/**
 * v1 writes one resume per user, at a fixed id. The `{id}` segment stays so holding several
 * later is a change without a migration, and a per-resume delete is a delete of that id.
 */
export const RESUME_CURRENT_ID = 'current'

/** Missing document reads back as null, as getApplication does. */
export async function getResume(uid: string, id: string): Promise<StoredResume | null> {
  const snap = await resumesCol(uid).doc(id).get()
  const data = snap.data()
  return data ? (data as StoredResume) : null
}

/** A whole-document write: an upload replaces text and structure in place and bumps addedAt. */
export async function setResume(uid: string, id: string, doc: StoredResume): Promise<void> {
  await resumesCol(uid).doc(id).set(doc)
}

/**
 * Firestore `update()`: a partial merge, not an upsert — throws NOT_FOUND if the doc is missing.
 * The patch type is widened because removing a stale artifact passes `FieldValue.delete()` under
 * a `StoredResume` key, which `Partial<StoredResume>` cannot express — and `undefined` could not
 * have said it, because `ignoreUndefinedProperties` is set and the key would be silently kept.
 * Same reason `replaceAssignment` exists rather than going through `updateInterview`.
 */
export async function patchResume(
  uid: string,
  id: string,
  patch: Partial<StoredResume> | Record<string, unknown>,
): Promise<void> {
  await resumesCol(uid).doc(id).update(patch)
}

/**
 * One answered ask appended in a transaction, so the duplicate and count checks hold against a
 * second tab: a plain read-then-write would let two appends read the same list and keep only the
 * later one, while both callers are told it was saved. The duplicate check runs before the count
 * check, so a repeat of an answered ask is still reported as already saved when the list is full.
 */
export async function appendResumeAsk(
  uid: string,
  id: string,
  ask: AnsweredAsk,
  maxAsks: number,
): Promise<'appended' | 'missing' | 'duplicate' | 'full'> {
  return adminDb.runTransaction(async (tx) => {
    const ref = resumesCol(uid).doc(id)
    const snap = await tx.get(ref)
    if (!snap.exists) return 'missing'
    const asks = (snap.data() as StoredResume).asks ?? []
    if (asks.some((a) => a.askId === ask.askId)) return 'duplicate'
    if (asks.length >= maxAsks) return 'full'
    tx.update(ref, { asks: [...asks, ask] })
    return 'appended'
  })
}

/**
 * One accepted rewrite appended in a transaction, with the basis check on the same read. A plain
 * read-then-write would let two tabs accepting different bullets each read the same list and keep
 * only their own, while both callers are told it was saved; and an upload landing between the
 * read and the write would take a rewrite written against the old text.
 */
export async function appendResumeRewrite(
  uid: string,
  id: string,
  rewrite: AcceptedRewrite,
): Promise<'appended' | 'missing' | 'moved'> {
  return adminDb.runTransaction(async (tx) => {
    const ref = resumesCol(uid).doc(id)
    const snap = await tx.get(ref)
    if (!snap.exists) return 'missing'
    const doc = snap.data() as StoredResume
    if (doc.addedAt !== rewrite.reviewedFrom) return 'moved'
    tx.update(ref, { rewrites: [...(doc.rewrites ?? []), rewrite] })
    return 'appended'
  })
}

/** The document and its `practice` subcollection, which a document delete would orphan. */
export async function deleteResume(uid: string, id: string): Promise<void> {
  await adminDb.recursiveDelete(resumesCol(uid).doc(id))
}

export async function listInterviews(uid: string, appId: string): Promise<InterviewRound[]> {
  const snap = await roundsCol(uid, appId).orderBy('createdAt', 'asc').get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<InterviewRound, 'id'>), id: d.id }))
}

export async function getInterview(
  uid: string,
  appId: string,
  rid: string,
): Promise<InterviewRound | null> {
  const snap = await roundsCol(uid, appId).doc(rid).get()
  const data = snap.data()
  return data ? { ...(data as Omit<InterviewRound, 'id'>), id: snap.id } : null
}

export async function createInterview(
  uid: string,
  appId: string,
  r: Omit<InterviewRound, 'id' | 'createdAt'>,
): Promise<string> {
  const ref = await roundsCol(uid, appId).add({ ...r, createdAt: new Date().toISOString() })
  return ref.id
}

/** Firestore `update()`: a partial merge, not an upsert — throws NOT_FOUND if the doc is missing. */
export async function updateInterview(
  uid: string,
  appId: string,
  rid: string,
  patch: Partial<InterviewRound>,
): Promise<void> {
  await roundsCol(uid, appId).doc(rid).update(patch)
}

/**
 * The brief, and the plan it invalidates, in one write.
 *
 * A plan is drawn from one text. The moment a different brief arrives, every quote in the guide
 * belongs to a document nobody is holding any more — so the plan goes with the brief it was
 * drawn from rather than sitting under one it was never written for. `updateInterview` cannot
 * say that: the app sets `ignoreUndefinedProperties` (src/lib/firebase/admin.ts, and it is set
 * for good reason — optional domain fields reach writes as `undefined`), so a patch carrying
 * `takeHome: undefined` would be dropped and the old plan would survive. `FieldValue.delete()`
 * is the sentinel that means remove this key, and one update means the record is never a new
 * brief beside an old plan, not even between two writes.
 *
 * The notice is not touched. It is what arrived; a brief is what the candidate went and got.
 */
export async function replaceAssignment(
  uid: string,
  appId: string,
  rid: string,
  assignment: Assignment,
): Promise<void> {
  await roundsCol(uid, appId).doc(rid).update({ assignment, takeHome: FieldValue.delete() })
}

/**
 * How much an account holds, counted rather than read: the applications subcollection's
 * aggregate, and the length of the facts array on the profile document. This is what the
 * admin panel is allowed to know about anyone — numbers, not content. The qualifier is on
 * what leaves the server: the profile document is read whole, because Firestore has no
 * aggregate over an array field, and only its length is returned. The resumes subcollection is
 * an aggregate like the applications, and today's metered runs are the day's meter summed —
 * reported here, enforced only by the permit transaction (src/lib/resume/meter.ts).
 */
export async function usageFor(uid: string): Promise<Usage> {
  const day = utcToday()
  const [apps, resumes, profile, reviews] = await Promise.all([
    appsCol(uid).count().get(),
    resumesCol(uid).count().get(),
    getProfile(uid),
    reviewsToday(uid, day),
  ])
  return {
    applications: apps.data().count,
    facts: profile.facts.length,
    resumes: resumes.data().count,
    reviewsToday: reviews,
  }
}

/**
 * Everything about one account, gone: the user document (which IS the profile), every
 * application under it and every interview under those, and then the Auth user.
 *
 * Data first, Auth second, and the order matters. If the data delete fails the account is
 * still there to sign in with and try again. If the Auth delete fails after the data is gone,
 * the person can sign in to an empty account and delete once more. The reverse order can
 * strand data under a uid that nothing can ever authenticate as again.
 */
export async function wipeUser(uid: string): Promise<void> {
  await adminDb.recursiveDelete(userDoc(uid))
  await adminAuth.deleteUser(uid)
}
