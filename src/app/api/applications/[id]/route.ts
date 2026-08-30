import { requireUser } from '@/lib/auth'
import { deleteApplication, getApplication, updateApplication } from '@/lib/db'
import type { Application } from '@/lib/types'

// One application by id. GET reads it, PATCH applies a partial update — status changes, a
// scope answer, a company correction — and DELETE removes the record with its interviews.
// Node runtime (the default): `@/lib/db` reaches Firestore through firebase-admin, which
// does not run on edge.

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(app)
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const patch: unknown = await req.json().catch(() => null)
  // A partial Application, not a full one — but it still has to be an object to merge.
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return Response.json({ error: 'body must be a partial application' }, { status: 400 })
  }

  const { id } = await ctx.params
  await updateApplication(user.uid, id, patch as Partial<Application>)
  const updated = await getApplication(user.uid, id)
  if (!updated) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(updated)
}

/**
 * Remove the record and everything under it. The read first is what makes this scoped and
 * honest: `recursiveDelete` on a path that holds nothing succeeds silently, so without it a
 * request for somebody else's id — or an id that never existed — would answer 204 and imply
 * something was deleted. 204 rather than the deleted body: there is nothing left to return.
 */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  const existing = await getApplication(user.uid, id)
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 })

  await deleteApplication(user.uid, id)
  return new Response(null, { status: 204 })
}
