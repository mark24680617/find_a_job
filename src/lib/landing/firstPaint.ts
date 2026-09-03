/**
 * Which placeholder the shell paints before Firebase has restored the session. The session
 * comes back asynchronously, and for the landing page that gap is the first thing a new
 * visitor sees — so a machine that has never signed in paints the signed-out slot at once,
 * and a machine that has holds the checking line instead of flashing the landing at somebody
 * who is about to see their dashboard.
 *
 * "Has signed in here" is a cookie, not localStorage, because `/` is rendered on the server:
 * the hint has to travel with the request for the first byte to be right, and a value only
 * the browser can read would force a second render and a visible swap. It is a hint and
 * nothing more — it decides which placeholder is drawn, never what anyone may do.
 */
export const SIGNED_IN_COOKIE = 'fj-signed-in'

export type FirstPaint = 'gate' | 'checking' | 'app'

export function firstPaint(
  ready: boolean,
  hasUser: boolean,
  returning: boolean,
  hasSlot: boolean,
): FirstPaint {
  if (!ready) return hasSlot && !returning ? 'gate' : 'checking'
  return hasUser ? 'app' : 'gate'
}
