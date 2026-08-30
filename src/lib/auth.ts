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

/**
 * Route-handler guard. Returns `{ uid }` for a valid Firebase ID token, or a 401
 * `Response` the handler should return as-is:
 *
 *   const user = await requireUser(req)
 *   if (user instanceof Response) return user
 */
export async function requireUser(req: Request): Promise<{ uid: string } | Response> {
  const token = bearerToken(req.headers.get('authorization'))
  if (!token) return unauthorized('unauthenticated')
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    return { uid: decoded.uid }
  } catch {
    return unauthorized('invalid token')
  }
}
