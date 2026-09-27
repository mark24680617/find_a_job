import { describe, it, expect } from 'vitest'
import { ONET_SKILLS, ONET_TITLES } from '@/lib/resume/onet'
import { ROLE_FAMILIES, resolveRoleFamily } from '@/lib/resume/onetLookup'

// <!-- R11 --> One list: the families are Task A6's allowlist, read out of the generated
// `ONET_TITLES`, so no O*NET-SOC code is named by hand on this feature. `src/lib/resume/onet.ts`
// is generated and never edited (the plan's File Structure); a family with no skills behind it
// would draw an empty Gaps section, which the second test refuses.

describe('ROLE_FAMILIES', () => {
  it('names only occupations the generated O*NET file actually carries', () => {
    expect(ROLE_FAMILIES.filter((f) => !(f.onetSoc in ONET_SKILLS))).toEqual([])
  })

  it('has at least one technology skill behind every family it offers', () => {
    for (const f of ROLE_FAMILIES) {
      expect(ONET_SKILLS[f.onetSoc].length).toBeGreaterThan(0)
    }
  })

  it('offers every occupation the generated file titles, once, under O*NET’s own title', () => {
    expect(new Set(ROLE_FAMILIES.map((f) => f.onetSoc)).size).toBe(ROLE_FAMILIES.length)
    expect(ROLE_FAMILIES).toEqual(
      Object.entries(ONET_TITLES).map(([onetSoc, title]) => ({ title, onetSoc })),
    )
  })
})

describe('resolveRoleFamily', () => {
  it('resolves the title the page shows, whatever its case and spacing', () => {
    expect(resolveRoleFamily('  software   DEVELOPERS ')).toEqual({
      title: 'Software Developers',
      onetSoc: '15-1252.00',
    })
  })

  it('refuses a family this build has no occupation for, rather than guessing the nearest', () => {
    // O*NET has no "Product Manager" occupation. The honest answer is no answer: §6.2's input is
    // "a role family the user confirms, never inferred silently".
    expect(resolveRoleFamily('Product Manager')).toBeNull()
    expect(resolveRoleFamily('')).toBeNull()
  })
})
