import { describe, it, expect } from 'vitest'
import { snippetCheck } from '@/lib/resume/snippetCheck'
import type { Fact } from '@/lib/types'

// The hole nobody had named: `profileIngest`'s prompt demands a verbatim sourceSnippet and
// nothing in the repo checks one, because the source document was never stored. This is the
// check, and it reports — it never corrects. Every fact below is fictional.

const fact = (id: string, sourceSnippet: string): Fact => ({
  id,
  claim: 'a claim',
  sourceSnippet,
  tags: [],
})

const TEXT = [
  'Senior Backend Engineer — Marram Systems    2021 – Present',
  'Cut checkout   latency from 900 ms to 180 ms',
].join('\n')

describe('snippetCheck', () => {
  it('locates a snippet that differs only in whitespace', () => {
    const out = snippetCheck([fact('f1', 'Cut checkout latency from 900 ms to 180 ms')], TEXT)
    expect(out).toEqual({ located: 1, total: 1, missing: [] })
  })

  it('lists what it could not find, verbatim as stored', () => {
    const out = snippetCheck(
      [fact('f1', 'Cut checkout latency from 900 ms to 180 ms'), fact('f2', 'Ran the payroll rewrite')],
      TEXT,
    )
    expect(out).toEqual({ located: 1, total: 2, missing: ['Ran the payroll rewrite'] })
  })

  it('counts a fact with no snippet as unlocated rather than trivially found', () => {
    const out = snippetCheck([fact('f1', '')], TEXT)
    expect(out).toEqual({ located: 0, total: 1, missing: [''] })
  })

  it('keeps located plus missing equal to total, which is what the one line on the page says', () => {
    const facts = [fact('f1', 'Marram Systems'), fact('f2', 'nowhere in this document'), fact('f3', '')]
    const out = snippetCheck(facts, TEXT)
    expect(out.located + out.missing.length).toBe(out.total)
  })

  it('is nothing to report for a profile with no facts', () => {
    expect(snippetCheck([], TEXT)).toEqual({ located: 0, total: 0, missing: [] })
  })
})
