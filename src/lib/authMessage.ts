/**
 * Firebase throws `FirebaseError` with a machine code and a message written for developers
 * ("Firebase: Error (auth/invalid-credential)."). This turns the code into a sentence for
 * the person at the screen. `kind` is where it happened: the sign-in wall reads a bad
 * credential as "wrong email or password", the account page — where the email is not in
 * question — as "wrong password", and a switched-off provider is named against the button
 * that was actually pressed.
 */
export function authMessage(error: unknown, kind: 'google' | 'email' | 'account'): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
  // The person reading the screen cannot act on `auth/unauthorized-domain`; whoever is running
  // the app can. The code goes to the console so a failure is never a dead end for both of them.
  console.warn('auth failed:', code || error)
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return kind === 'account' ? 'Wrong password.' : 'Wrong email or password.'
    case 'auth/invalid-email':
      return 'That doesn’t look like an email address.'
    case 'auth/email-already-in-use':
      return 'That email already has an account. Sign in instead.'
    case 'auth/weak-password':
      return 'Passwords need at least 6 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute, then try again.'
    // Firebase asks for a fresh sign-in before a password, email or account change — the
    // account page re-authenticates first, so this only reaches a person when that lapsed.
    case 'auth/requires-recent-login':
      return 'Sign in again, then retry.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    // Fires for whichever provider is switched off in the Firebase console, so it can only be
    // read against the button that was actually pressed. Naming the wrong one sends the person
    // to a method that is equally dead — and on the account page, where a Google account
    // re-authenticates through the pop-up and has no password to fall back to, "use your email
    // and password" is exactly that. The three pop-up failures below say nothing about a
    // password there for the same reason.
    case 'auth/operation-not-allowed':
      if (kind === 'account') return 'That sign-in method isn’t enabled for this app.'
      return kind === 'google'
        ? 'Google sign-in isn’t enabled yet. Use your email and password.'
        : 'Email and password sign-in isn’t enabled for this app yet.'
    // Firebase only allows OAuth pop-ups from domains on its authorized list, and a fresh
    // project does not have localhost on it. Nothing the person at the keyboard can fix.
    case 'auth/unauthorized-domain':
      return kind === 'account'
        ? 'Google sign-in isn’t available on this address.'
        : 'Google sign-in isn’t available on this address. Use your email and password.'
    case 'auth/popup-blocked':
      return kind === 'account'
        ? 'Your browser blocked the Google window. Allow pop-ups and try again.'
        : 'Your browser blocked the Google window. Allow pop-ups, or use your email.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google window closed before sign-in finished.'
    case 'auth/network-request-failed':
      return 'We couldn’t reach Firebase. Check your connection and try again.'
    default:
      return kind === 'account' ? 'That didn’t work. Try again.' : 'Sign-in failed. Try again.'
  }
}
