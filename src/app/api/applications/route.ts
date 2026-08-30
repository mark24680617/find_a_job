import { fetchPosting, FetchBlockedError } from '@/adapters'
import { runJobInterpret } from '@/ai/flows/jobInterpret'
import { requireUser } from '@/lib/auth'
import { createApplication, getProfile, listApplications } from '@/lib/db'
import type { Application } from '@/lib/types'

// One application per company·role. POST creates one from a posting URL or pasted JD text;
// GET lists them, newest first. Node runtime (the default): firebase-admin and the Genkit
// call both need it, and requireUser runs before either a fetch or the model is touched.

/** A field the client either sent as a usable string or did not usefully send at all. */
function readString(body: unknown, key: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Where the JD came from, resolved before the model ever sees it. */
interface Source {
  jdText: string
  adapter: string
  sourceUrl?: string
  company?: string
  role?: string
}

export async function GET(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  return Response.json(await listApplications(user.uid))
}

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const body: unknown = await req.json().catch(() => null)
  const url = readString(body, 'url')
  const pastedJd = readString(body, 'jdText')

  // Pasted text wins over the URL: a paste is how the user recovers from a blocked fetch,
  // and the form may still carry the URL it failed on — re-fetching it would just fail again.
  // The URL is still recorded as the source link. A blocked fetch is a 422 the UI acts on,
  // never a silent failure (spec §8).
  let src: Source
  if (pastedJd) {
    src = { jdText: pastedJd, adapter: 'manual', sourceUrl: url }
  } else if (url) {
    try {
      const posting = await fetchPosting(url)
      src = {
        jdText: posting.jdText,
        adapter: posting.adapter,
        sourceUrl: url,
        company: posting.company,
        role: posting.role,
      }
    } catch (error) {
      if (error instanceof FetchBlockedError) {
        return Response.json({ error: error.reason, needPaste: true }, { status: 422 })
      }
      throw error
    }
  } else {
    return Response.json({ error: 'send a url or jdText' }, { status: 400 })
  }

  const profile = await getProfile(user.uid)
  const parsed = await runJobInterpret({ jdText: src.jdText, facts: profile.facts })

  const now = new Date().toISOString()
  // Company and role: the user's correction first (Ashby/Lever hand back a slug-derived
  // "Trm Labs" for "TRM Labs"), then the adapter's, then whatever the model parsed out.
  const app: Omit<Application, 'id'> = {
    company: readString(body, 'company') ?? src.company ?? parsed.company,
    role: readString(body, 'role') ?? src.role ?? parsed.role,
    jdRaw: src.jdText,
    sourceUrl: src.sourceUrl,
    adapter: src.adapter,
    parsed,
    questions: [],
    status: 'draft',
    timeline: [{ event: 'created', at: now }],
    createdAt: now,
  }

  const id = await createApplication(user.uid, app)
  return Response.json({ ...app, id }, { status: 201 })
}
