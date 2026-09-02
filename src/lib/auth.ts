import type { DecodedIdToken } from 'firebase-admin/auth'
import { adminAuth } from '@/lib/firebase/admin'

export function bearerToken(header: string | null): string | null {
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7) || null
}

function unauthorized(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'forbidden' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}

/** The verified token, or the 401 to answer with. Shared by both guards below. */
async function decode(req: Request): Promise<DecodedIdToken | Response> {
  const token = bearerToken(req.headers.get('authorization'))
  if (!token) return unauthorized('unauthenticated')
  try {
    return await adminAuth.verifyIdToken(token)
  } catch {
    return unauthorized('invalid token')
  }
}

/**
 * Route-handler guard. Returns `{ uid }` for a valid Firebase ID token, or a 401
 * `Response` the handler should return as-is:
 *
 *   const user = await requireUser(req)
 *   if (user instanceof Response) return user
 */
export async function requireUser(req: Request): Promise<{ uid: string } | Response> {
  const decoded = await decode(req)
  return decoded instanceof Response ? decoded : { uid: decoded.uid }
}

/**
 * The administrator's guard: a valid token AND the `admin: true` custom claim on it. The
 * claim is set by `scripts/grant-admin.ts` and lives on the uid, not on an email — so it
 * survives an email change and never trusts an address nobody verified. Anything but the
 * literal `true` is a no: a claim is data someone wrote, and "truthy" is not a policy.
 */
export async function requireAdmin(req: Request): Promise<{ uid: string } | Response> {
  const decoded = await decode(req)
  if (decoded instanceof Response) return decoded
  if (decoded.admin !== true) return forbidden()
  return { uid: decoded.uid }
}
