'use client'

import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
  type User,
} from 'firebase/auth'
import { hasPasswordProvider } from '@/lib/providers'

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

/**
 * Prove it is still the same person. Firebase requires a recent sign-in before a password,
 * email or account is changed; this is that, in the form the account can give: a password
 * for an account that has one, the Google window for one that does not. Called before the
 * change, not after a failure — so the confirm that follows is never shown to somebody who
 * cannot go through with it.
 *
 * `async` with nothing awaited, deliberately: it makes the missing-password case a rejected
 * promise rather than a synchronous throw, so every caller can handle every failure the one
 * way. Dropping the keyword would put that one path back on a different track.
 */
export async function reauthenticate(user: User, password?: string) {
  if (hasPasswordProvider(user.providerData.map((p) => p.providerId))) {
    if (!password) throw new Error('Enter your password.')
    return reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email ?? '', password),
    )
  }
  return reauthenticateWithPopup(user, new GoogleAuthProvider())
}

/** Blank clears the field — Firebase stores `null`, not an empty string. */
export function updateAccountProfile(user: User, displayName: string, photoURL: string) {
  return updateProfile(user, {
    displayName: displayName.trim() || null,
    photoURL: photoURL.trim() || null,
  })
}

export async function changePassword(user: User, current: string, next: string) {
  await reauthenticate(user, current)
  await updatePassword(user, next)
}

/**
 * Not `updateEmail`: this sends a link to the NEW address and changes nothing until it is
 * opened, so an account can never be pointed at an inbox the person does not control.
 */
export async function requestEmailChange(user: User, current: string, next: string) {
  await reauthenticate(user, current)
  await verifyBeforeUpdateEmail(user, next.trim())
}

/**
 * Whether this session's token names the administrator. Presentation only — it decides
 * whether the Admin link is drawn, and the server decides everything else.
 */
export async function readAdminClaim(user: User): Promise<boolean> {
  const result = await user.getIdTokenResult()
  return result.claims.admin === true
}
