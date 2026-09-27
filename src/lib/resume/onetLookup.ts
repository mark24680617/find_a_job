import { normalizeWs } from '@/lib/research/quotes'
import { ONET_TITLES } from '@/lib/resume/onet'

/**
 * The role families Gaps offers, and the O*NET-SOC occupation each one reads its Technology
 * Skills and their In Demand flags from (spec §6.2). Curated rather than searched: O*NET's
 * taxonomy runs to hundreds of occupations, and a picker over all of them would be a taxonomy
 * quiz — while one family the user confirms is the whole of §6.2's first input.
 *
 * `title` is what the page shows and what `GapsResult.roleFamily` stores. It is the sentence
 * "O*NET's data for Software Developers", so it is O*NET's own occupation title rather than a
 * job-board label: there is no "Product Manager" row here because O*NET has no such occupation,
 * and inventing one would put a name on screen that O*NET's data is not about.
 *
 * One list (R11): the curation is Task A6's `ALLOWED_SOC` in `scripts/fetch-onet.ts`, and this
 * file derives every family from the generated `ONET_TITLES` — every key, titled from it, in the
 * order the generator wrote them. No code is named by hand here, so there is nothing to delete
 * and nothing to drift. Adding a family is a line in `ALLOWED_SOC` and a re-run of the script;
 * `src/lib/resume/onet.ts` is never edited by hand.
 */
export interface RoleFamily {
  title: string
  onetSoc: string
}

export const ROLE_FAMILIES: readonly RoleFamily[] = Object.entries(ONET_TITLES).map(
  ([onetSoc, title]) => ({ title, onetSoc }),
)

const key = (s: string): string => normalizeWs(s).toLowerCase()

const BY_TITLE = new Map(ROLE_FAMILIES.map((f) => [key(f.title), f]))

/**
 * The family the user confirmed, or null when this build has no O*NET occupation for what
 * arrived. Case- and whitespace-insensitive, because the title travels over the wire; nothing
 * else is inferred — an unknown family is refused rather than mapped to the nearest thing.
 */
export function resolveRoleFamily(title: string): RoleFamily | null {
  return BY_TITLE.get(key(title)) ?? null
}
