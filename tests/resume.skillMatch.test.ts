import { describe, it, expect, vi } from 'vitest'

// The generated O*NET file is mocked, so the rule is tested against a table this file controls
// rather than against whatever stage A downloaded. `Postgres → PostgreSQL` is the alias §6.2
// names by example.
vi.mock('@/lib/resume/onet', () => ({
  ONET_RELEASE: '30.0',
  ONET_ATTRIBUTION: 'O*NET attribution',
  ONET_SKILLS: {},
  ONET_ALIASES: { Postgres: 'PostgreSQL', 'Postgres SQL': 'PostgreSQL', K8s: 'Kubernetes' },
}))

import { matchesTerm, skillMatches } from '@/lib/resume/skillMatch'

describe('matchesTerm', () => {
  it('matches a whole word wherever it sits, whitespace-normalised and case-folded', () => {
    expect(matchesTerm('kubernetes', 'Ran   the\nKubernetes migration')).toBe(true)
    expect(matchesTerm('Apache Kafka', 'Moved the ledger onto Apache   Kafka in 2025')).toBe(true)
  })

  it('matches a term equal to the whole haystack', () => {
    expect(matchesTerm('React', '  react  ')).toBe(true)
  })

  it('matches beside punctuation that ends a sentence', () => {
    expect(matchesTerm('PostgreSQL', 'The write path runs on PostgreSQL.')).toBe(true)
    expect(matchesTerm('Python', 'Tools: Python, Go, Rust')).toBe(true)
  })

  it('never matches a stem, a prefix or a longer token', () => {
    expect(matchesTerm('Java', 'Wrote the JavaScript bundler')).toBe(false)
    expect(matchesTerm('Go', 'Golang service')).toBe(false)
    expect(matchesTerm('Kubernetes', 'Kubernete')).toBe(false)
    expect(matchesTerm('React', 'Reacted to the incident')).toBe(false)
  })

  it('does not let a one-letter name eat a longer technology name', () => {
    // `C` is a real O*NET skill name and `C++` is a different one. A match here would put a
    // bucket-1 row on screen about something the resume never says.
    expect(matchesTerm('C', 'Shipped C++ and Go services')).toBe(false)
    expect(matchesTerm('C#', 'Shipped C# services')).toBe(true)
    expect(matchesTerm('R', 'Led R&D for the platform')).toBe(false)
    expect(matchesTerm('R', 'Résumé attached')).toBe(false)
    expect(matchesTerm('J', 'Worked with Jürgen on it')).toBe(false)
    expect(matchesTerm('R', 'Modelled churn in R and SQL')).toBe(true)
  })

  it('does not match a one- or two-character name inside a hyphenated compound', () => {
    // (F2, final review acceptance-6) `Go` and `C` are demanded in most families, and a hyphen
    // is a boundary for longer names — so without this, go-to-market read as Go and C-suite as C.
    expect(matchesTerm('Go', 'Led the go-to-market plan')).toBe(false)
    expect(matchesTerm('Go', 'Owned the go-live date')).toBe(false)
    expect(matchesTerm('C', 'Presented to the C-suite')).toBe(false)
    expect(matchesTerm('C', 'Sold to non-C buyers')).toBe(false)
    expect(matchesTerm('R', 'Raised the R-squared to 0.8')).toBe(false)
    // Still a whole token beside anything else that ends one.
    expect(matchesTerm('Go', 'Tools: Python, Go, Rust')).toBe(true)
    expect(matchesTerm('C', 'Wrote the firmware in C.')).toBe(true)
    expect(matchesTerm('Go', 'go')).toBe(true)
    // A longer name keeps the hyphen as a boundary.
    expect(matchesTerm('PostgreSQL', 'Ran a PostgreSQL-backed ledger')).toBe(true)
  })

  it('is false for an empty term or an empty haystack', () => {
    expect(matchesTerm('', 'anything')).toBe(false)
    expect(matchesTerm('   ', 'anything')).toBe(false)
    expect(matchesTerm('React', '')).toBe(false)
  })
})

describe('skillMatches', () => {
  it('folds a known spelling onto the one name — Postgres is PostgreSQL', () => {
    expect(skillMatches('PostgreSQL', 'Tuned Postgres queries down to 2 seconds')).toBe(true)
    expect(skillMatches('PostgreSQL', 'Ran Postgres SQL in production')).toBe(true)
    expect(skillMatches('Kubernetes', 'Moved the fleet to K8s')).toBe(true)
  })

  it('resolves a skill named by one of its own aliases', () => {
    expect(skillMatches('Postgres', 'The PostgreSQL cluster')).toBe(true)
  })

  it('misses an unaliased spelling rather than guessing at it', () => {
    // A miss lands the skill in bucket 3, where the product asks. A fuzzy hit would land it in
    // bucket 1, where the product asserts.
    expect(skillMatches('PostgreSQL', 'Tuned Postgress queries')).toBe(false)
    expect(skillMatches('PostgreSQL', 'Some PostGre work')).toBe(false)
  })
})
