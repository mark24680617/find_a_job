import { toAdminUser } from '@/lib/adminUsers'
import { requireAdmin } from '@/lib/auth'
import { usageFor, wipeUser } from '@/lib/db'
import { adminAuth } from '@/lib/firebase/admin'

// One account, from the administrator's side. PATCH disables or enables it; DELETE removes
// it with everything under it. Node runtime (the default): firebase-admin does not run on
// edge.
//
// Neither works on the caller's own uid. An administrator who disables themself has locked
// the only key in the building, and one who deletes themself from here has done it without
// the re-authentication the account page insists on. Their own account is theirs to delete —
// on the account page, like anyone else.

type Ctx = { params: Promise<{ uid: string }> }

const SELF = 'you cannot change your own account here'

/** firebase-admin reports a missing user as an error with this code, not as a null. */
const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'auth/user-not-found'

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  const body: unknown = await req.json().catch(() => null)
  const disabled = (body as Record<string, unknown> | null)?.disabled
  // Refused rather than coerced: this flag decides whether somebody can sign in tomorrow.
  if (typeof disabled !== 'boolean') {
    return Response.json({ error: 'disabled must be true or false' }, { status: 400 })
  }

  const { uid } = await ctx.params
  if (uid === admin.uid) return Response.json({ error: SELF }, { status: 400 })

  let record
  try {
    record = await adminAuth.updateUser(uid, { disabled })
  } catch (error) {
    if (isNotFound(error)) return Response.json({ error: 'not found' }, { status: 404 })
    throw error
  }
  // Disabling stops new sign-ins; revoking the refresh tokens stops the session they already
  // have from renewing itself, so it ends when its current ID token does — within the hour.
  // Enabling has nothing to cut off.
  if (disabled) await adminAuth.revokeRefreshTokens(uid)

  return Response.json(toAdminUser(record, await usageFor(uid)))
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  const { uid } = await ctx.params
  if (uid === admin.uid) return Response.json({ error: SELF }, { status: 400 })

  // Look the account up first: `recursiveDelete` on an empty path succeeds silently, and a
  // 204 for a uid that never existed would read as a deletion that happened.
  try {
    await adminAuth.getUser(uid)
  } catch (error) {
    if (isNotFound(error)) return Response.json({ error: 'not found' }, { status: 404 })
    throw error
  }

  await wipeUser(uid)
  return new Response(null, { status: 204 })
}
