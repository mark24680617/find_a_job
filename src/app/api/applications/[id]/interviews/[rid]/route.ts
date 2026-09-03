import { requireUser } from '@/lib/auth'
import { getInterview } from '@/lib/db'

// One round by id, for its own page. Node runtime (the default).

type Ctx = { params: Promise<{ id: string; rid: string }> }

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  const { id, rid } = await ctx.params
  const round = await getInterview(user.uid, id, rid)
  if (!round) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(round)
}
