import { requireUser } from '@/lib/auth'
import { usageFor, wipeUser } from '@/lib/db'

// The caller's own account. GET says how much it holds; DELETE removes it and everything
// under it. No body on either — the uid comes from the token, and there is nothing to
// choose. Node runtime (the default): `@/lib/db` reaches Firestore through firebase-admin.
//
// The browser re-authenticates the person and asks the confirm BEFORE calling DELETE (see
// DeleteAccount.tsx); by the time the request lands, the decision has been made.

export async function GET(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  return Response.json(await usageFor(user.uid))
}

export async function DELETE(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  await wipeUser(user.uid)
  return new Response(null, { status: 204 })
}
