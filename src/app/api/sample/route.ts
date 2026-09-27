import { requireUser } from '@/lib/auth'
import {
  createApplication,
  createInterview,
  getProfile,
  getResume,
  listApplications,
  RESUME_CURRENT_ID,
  setProfile,
  setResume,
} from '@/lib/db'
import { buildSampleWorld, SAMPLE_COMPANY } from '@/lib/sampleWorld'

// Fill the caller's own space with the invented world in `@/lib/sampleWorld`, so someone
// seeing this product for the first time sees it with something in it. Node runtime (the
// default): `@/lib/db` reaches Firestore through firebase-admin, and requireUser runs first,
// so an unauthenticated call never reaches a write.
//
// It writes into the CALLER's space rather than a shared demo account on purpose: everything
// here is per-user by construction, and a demo that is not is a demo of a different product.

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const [existing, profile, resume] = await Promise.all([
    listApplications(user.uid),
    getProfile(user.uid),
    getResume(user.uid, RESUME_CURRENT_ID),
  ])

  // Two refusals rather than a merge. Loading the world twice would leave two Marram records
  // and a profile whose fact ids no longer run f1..fN; and `setProfile` replaces the whole
  // document, so seeding over a real profile would silently delete a person's facts. Neither
  // is worth a clever reconciliation for a demo button — being told no is the better outcome.
  if (existing.some((app) => app.company === SAMPLE_COMPANY)) {
    return Response.json({ error: 'sample already loaded' }, { status: 409 })
  }
  if (profile.facts.length > 0) {
    return Response.json(
      { error: 'your profile already has facts — loading the sample would replace them' },
      { status: 409 },
    )
  }
  // A third refusal, for the same reason as the second: `setResume` replaces the whole document,
  // so seeding over an account that has uploaded its own resume would silently delete it — and an
  // account can hold a resume with no facts, which the two guards above would let through. Before
  // the first write, so a refusal leaves nothing behind.
  if (resume) {
    return Response.json(
      { error: 'you already have a resume here — loading the sample would replace it' },
      { status: 409 },
    )
  }

  const world = buildSampleWorld()

  // The application goes first, and the order is the point: there is no transaction here, so any
  // of the four writes can be the last one that lands. Profile-first makes a failure terminal —
  // the facts guard above would then refuse every retry, and this button is the only way in.
  // Application-first fails into a state the SAMPLE_COMPANY guard reads correctly ("sample
  // already loaded"), and what is left behind is one visible record on the dashboard rather than
  // a fictional profile the account never asked for and cannot tell apart from its own.
  const id = await createApplication(user.uid, world.application)
  await setProfile(user.uid, world.profile)
  // The resume goes with the profile — same person, same document — and before the interview,
  // which is the only write here that depends on an id an earlier one returned. It is a whole
  // document write at a fixed id, exactly as the upload route does it, so a retry that got this
  // far would overwrite rather than duplicate.
  await setResume(user.uid, RESUME_CURRENT_ID, world.resume)
  // The round hangs off the application that was just written; `createInterview` stamps its
  // own createdAt, which is the field `listInterviews` orders by.
  await createInterview(user.uid, id, world.interview)

  return Response.json({ id }, { status: 201 })
}
