import { FlowOutputError } from '@/ai/genkit'
import { requireUser } from '@/lib/auth'
import { getApplication, updateApplication } from '@/lib/db'
import { researchProcess } from '@/lib/research/pipeline'

// Research how this company interviews for this role, on demand, and put the map on the
// application. Node runtime (the default). The research itself is `researchProcess`; what is
// here is the request around it — who is asking, whether the posting has been read yet, and
// the one write at the end.
//
// Nothing is written until the synthesis has passed its guard, so a failed run costs a minute
// and not a map the person already had.

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const { id } = await ctx.params
  const app = await getApplication(user.uid, id)
  if (!app) return Response.json({ error: 'not found' }, { status: 404 })
  if (!app.parsed) {
    return Response.json({ error: 'interpret the posting before researching the process' }, { status: 400 })
  }

  let map
  try {
    map = await researchProcess({
      company: app.parsed.company,
      role: app.parsed.role,
      jdRaw: app.jdRaw,
      sourceUrl: app.sourceUrl,
      parsed: app.parsed,
    })
  } catch (error) {
    if (error instanceof FlowOutputError) {
      return Response.json({ error: error.message, researchFailed: true }, { status: 422 })
    }
    throw error
  }

  await updateApplication(user.uid, id, { process: map })
  return Response.json(map)
}
