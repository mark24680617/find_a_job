import { describe, it, expect } from 'vitest'
import { ONET_ALIASES, ONET_ATTRIBUTION, ONET_RELEASE, ONET_SKILLS, ONET_TITLES } from '@/lib/resume/onet'
import { skillMatches } from '@/lib/resume/skillMatch'

describe('the O*NET data file', () => {
  it('records the release it was generated from', () => {
    expect(ONET_RELEASE).toMatch(/^\d+\.\d+$/)
  })

  it('carries the attribution O*NET asks for, which the page displays as a licence condition', () => {
    expect(ONET_ATTRIBUTION.trim().length).toBeGreaterThan(20)
    expect(ONET_ATTRIBUTION).toContain('O*NET')
  })

  it('keys skills and titles by the same O*NET-SOC codes, twelve of them', () => {
    const codes = Object.keys(ONET_SKILLS)
    expect(codes).toHaveLength(12)
    expect(Object.keys(ONET_TITLES).sort()).toEqual([...codes].sort())
    for (const code of codes) {
      expect(code).toMatch(/^\d{2}-\d{4}\.\d{2}$/)
      expect(ONET_TITLES[code].length).toBeGreaterThan(0)
      expect(ONET_SKILLS[code].length).toBeGreaterThan(0)
      for (const skill of ONET_SKILLS[code]) {
        expect(typeof skill.name).toBe('string')
        expect(skill.name).not.toBe('')
        // (F3, ledger-2) O*NET's In Demand flag, the one Gaps reads. Hot Technology is not
        // carried: it marks what is frequent across ALL employer postings, and nothing reads it.
        expect(Object.keys(skill).sort()).toEqual(['inDemand', 'name'])
        expect(typeof skill.inDemand).toBe('boolean')
      }
    }
  })

  it('names Software Developers, the family the copy uses as its example', () => {
    expect(ONET_TITLES['15-1252.00']).toBe('Software Developers')
    // 430 rows on release 31.0, counted 2026-09-21. The floor catches a truncated regeneration
    // without failing on the next release's own count.
    expect(ONET_SKILLS['15-1252.00'].length).toBeGreaterThanOrEqual(100)
  })

  it('marks In Demand the few skills this occupation’s own postings ask for, and no Adobe tool for a developer', () => {
    // 30 of 430 rows on release 31.0, counted 2026-09-26. Hot Technology marked 152, six of the
    // first ten Adobe tools. The bounds catch a regeneration that read the wrong column.
    const inDemand = ONET_SKILLS['15-1252.00'].filter((s) => s.inDemand).map((s) => s.name)
    expect(inDemand.length).toBeGreaterThan(0)
    expect(inDemand.length).toBeLessThan(ONET_SKILLS['15-1252.00'].length / 4)
    expect(inDemand).toContain('PostgreSQL')
    expect(inDemand.filter((name) => name.startsWith('Adobe'))).toEqual([])
    for (const code of Object.keys(ONET_SKILLS)) {
      expect(ONET_SKILLS[code].some((s) => s.inDemand)).toBe(true)
    }
  })

  it('folds every alias onto a name that is really in the data', () => {
    const names = new Set(Object.values(ONET_SKILLS).flat().map((s) => s.name))
    for (const [spelling, name] of Object.entries(ONET_ALIASES)) {
      expect(spelling).toBe(spelling.toLowerCase())
      expect(names.has(name)).toBe(true)
    }
  })

  it('folds the short names resumes use onto O*NET’s long ones, and no ordinary English word', () => {
    // (final review, ledger-2) 'Kafka' in a resume is Apache Kafka; 'I excel at' is not Excel.
    expect(skillMatches('Apache Kafka', 'Built Kafka and Airflow pipelines')).toBe(true)
    expect(skillMatches('Apache Airflow', 'Built Kafka and Airflow pipelines')).toBe(true)
    expect(skillMatches('Atlassian JIRA', 'Triaged the Jira backlog')).toBe(true)
    expect(skillMatches('Microsoft Power BI', 'Built Power BI dashboards')).toBe(true)
    expect(skillMatches('Hypertext markup language HTML', 'Wrote HTML and CSS')).toBe(true)
    // (F3) The short names the final review listed that are not ordinary English words.
    expect(skillMatches('Apache Tomcat', 'Deployed services on Tomcat')).toBe(true)
    expect(skillMatches('Atlassian Bitbucket', 'Reviewed pull requests in Bitbucket')).toBe(true)
    expect(skillMatches('Microsoft SQL Server', 'Tuned SQL Server indexes')).toBe(true)
    expect(skillMatches('Google Android', 'Shipped the Android app')).toBe(true)
    expect(skillMatches('Apple iOS', 'Configured Cisco IOS on the core routers')).toBe(false)
    expect(skillMatches('Apple macOS', 'Built the macOS client')).toBe(true)
    expect(skillMatches('Apache Cassandra', 'Modelled the Cassandra keyspaces')).toBe(true)
    for (const word of ['excel', 'spark', 'hive', 'maven', 'angular', 'confluence', 'sql', 'ios']) {
      expect(Object.keys(ONET_ALIASES)).not.toContain(word)
    }
    expect(skillMatches('Microsoft Excel', 'I excel at stakeholder communication')).toBe(false)
  })
})
