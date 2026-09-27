import { requireUser } from '@/lib/auth'
import { deleteResume, getResume } from '@/lib/db'
import { RESUME_ID_RE } from '@/lib/resume/bounds'

// One resume by id, removed with everything under it. Node runtime (the default).
//
// Not behind `RESUME_TOOLS_ENABLED`: the kill switch stops the tools from spending, and a person
// may always take their own document back out, judged window or not.
//
// `RESUME_ID_RE` is imported rather than declared: spec §4 puts the same pattern on all seven
// routes, and one shared constant is one place to widen it rather than seven.

type Ctx = { params: Promise<{ id: string }> }

/**
 * A missing document, another account's document and an id that was never a valid id are one
 * answer. The shape of the id is not news about what exists, and the read first is what makes
 * this honest: `recursiveDelete` on a path that holds nothing succeeds silently, so without it a
 * request for somebody else's id would answer 204 and imply something was deleted.
 */
const notFound = (): Response => Response.json({ error: 'not found' }, { status: 404 })

/**
 * The one read route on this feature. House order, minus everything that does not apply: no model
 * call, so no permit, no kill switch and no 409. A missing document and another account's document
 * are the same 404 — the document is resolved as `users/{user.uid}/resumes/{id}` and never looked
 * up by id alone, so a 404 says nothing about whether it exists (spec §4).
 */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  if (!RESUME_ID_RE.test(id)) return notFound()

  const resume = await getResume(user.uid, id)
  if (!resume) return notFound()

  return Response.json(resume)
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  if (!RESUME_ID_RE.test(id)) return notFound()

  // Resolved as users/{user.uid}/resumes/{id}, never looked up by id alone.
  const existing = await getResume(user.uid, id)
  if (!existing) return notFound()

  await deleteResume(user.uid, id)
  return new Response(null, { status: 204 })
}
