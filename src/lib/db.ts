import { adminDb } from '@/lib/firebase/admin'
import type { Application, InterviewRound, Profile } from '@/lib/types'

// Firestore accessors. Everything is scoped under users/{uid}, so a caller that has
// authenticated a uid cannot reach another user's data by construction. Mapping only —
// the stored document omits the `id` field and reads put the document id back on.

const userDoc = (uid: string) => adminDb.collection('users').doc(uid)
const appsCol = (uid: string) => userDoc(uid).collection('applications')
const roundsCol = (uid: string, appId: string) => appsCol(uid).doc(appId).collection('interviews')

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
