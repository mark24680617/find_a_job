import { requireUser } from '@/lib/auth'
import { getProfile, setProfile } from '@/lib/db'
import type { Fact, Profile, VoiceRule } from '@/lib/types'

// The profile vault. GET reads it, PUT replaces it — the editor owns the whole document,
// so a save has to be able to delete a fact, not only add one. Node runtime (the default):
// `@/lib/db` reaches Firestore through firebase-admin, which does not run on edge.

/**
 * Minimal, but deep enough to be true: a fact stored without a string id crashes the
 * next ingest's merge, and the assertions at the end have to be honest for anything
 * downstream to trust them. What the strings actually say is the editor's business.
 */
function asProfile(body: unknown): Profile | null {
  if (typeof body !== 'object' || body === null) return null
  const { facts, standardAnswers, voiceRules, gaps } = body as Record<string, unknown>
  if (!Array.isArray(facts) || !Array.isArray(voiceRules) || !Array.isArray(gaps)) return null
  if (!isStringRecord(standardAnswers)) return null
  if (!gaps.every((g) => typeof g === 'string')) return null
  if (!facts.every(isFact) || !voiceRules.every(isVoiceRule)) return null
  // Only these four keys are written: users/{uid} holds the profile and nothing else, and
  // a full replace would otherwise let any extra key in the request body live there too.
  return { facts: facts as Fact[], standardAnswers, voiceRules: voiceRules as VoiceRule[], gaps }
}

/** True when `value` is an object carrying a string at each of `keys`. */
function hasStrings(value: unknown, keys: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  return keys.every((k) => typeof (value as Record<string, unknown>)[k] === 'string')
}

const isFact = (v: unknown): boolean =>
  hasStrings(v, ['id', 'claim', 'sourceSnippet']) && Array.isArray((v as Fact).tags)

const isVoiceRule = (v: unknown): boolean => hasStrings(v, ['rule', 'evidence', 'createdAt'])

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((v) => typeof v === 'string')
}

export async function GET(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  return Response.json(await getProfile(user.uid))
}

export async function PUT(req: Request): Promise<Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const profile = asProfile(await req.json().catch(() => null))
  if (!profile) {
    return Response.json({ error: 'body must be a Profile' }, { status: 400 })
  }

  await setProfile(user.uid, profile)
  return Response.json(profile)
}
