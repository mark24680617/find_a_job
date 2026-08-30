import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// Server-only. Credentials come from Application Default Credentials: locally from
// `gcloud auth application-default login`, on Cloud Run from the runtime service
// account. No service-account key ever lives in the repo or the environment.
if (!getApps().length) {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
  })
  // Optional domain fields (Application.sourceUrl, InterviewRound.datetime) reach writes
  // as `undefined`, which Firestore rejects by default. settings() throws if it runs twice
  // or after the instance is used, so it hangs off the same init-once guard.
  getFirestore().settings({ ignoreUndefinedProperties: true })
}

export const adminAuth = getAuth()
export const adminDb = getFirestore()
