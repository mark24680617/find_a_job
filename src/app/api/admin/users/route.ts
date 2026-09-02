import { toAdminUser } from '@/lib/adminUsers'
import { requireAdmin } from '@/lib/auth'
import { usageFor } from '@/lib/db'
import { adminAuth } from '@/lib/firebase/admin'

// Every account, for the administrator: who they are to Firebase Auth, and how much they
// hold — counted, not read. Node runtime (the default): firebase-admin does not run on edge.
//
// Firebase pages at 1000. Two accounts exist today, so one page is the whole list; the
// token is still passed through so the screen can ask for more without this route changing.

const PAGE = 1000

export async function GET(req: Request): Promise<Response> {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  // Absent and empty both mean "from the start" — a link with `?pageToken=` on it is not
  // a request for a page nobody can name.
  const pageToken = new URL(req.url).searchParams.get('pageToken') || undefined
  const page = await adminAuth.listUsers(PAGE, pageToken)
  // The usage lookups are independent, so they run together; a page of a thousand would
  // otherwise be a thousand round-trips in a row.
  const users = await Promise.all(
    page.users.map(async (record) => toAdminUser(record, await usageFor(record.uid))),
  )
  return Response.json({ users, ...(page.pageToken ? { nextPageToken: page.pageToken } : {}) })
}
