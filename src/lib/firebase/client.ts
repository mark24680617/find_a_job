'use client'

import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'

const app = getApps().length
  ? getApp()
  : initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FB_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FB_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FB_APP_ID,
    })

export const auth = getAuth(app)

export function signInWithGoogle() {
  return signInWithPopup(auth, new GoogleAuthProvider())
}

export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function signUpWithEmail(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password)
}

export function signOutUser() {
  return signOut(auth)
}

/** Subscribes to sign-in state. Returns the unsubscribe function. */
export function watchUser(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb)
}
