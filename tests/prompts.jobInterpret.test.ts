import { describe, it, expect } from 'vitest'
import { buildJobInterpretPrompt, summarizeFacts } from '@/ai/prompts/jobInterpret'
import type { Fact } from '@/lib/types'

// The system text is the product's core judgment, stated to the model word for word: the
// hard-gate posture ladder, the per-application vs per-profile scope split, and the
// apply-or-skip advisory. A paraphrase would quietly change what the model decides, so a
// verbatim copy lives here and the build fails if the prompt drifts from it.
const VERBATIM = `You interpret one job posting for one specific candidate.
- roleFacts: the concrete facts of the role (team, product, level, location, salary if stated).
- gates: every hard requirement (numeric minimums, degree, work authorization, mandated
  overlap hours, on-site days). For each: met = yes/no/unclear judged ONLY against the
  candidate facts provided; posture =
    "escape-clause" if the posting itself softens it ("even if you don't meet every…"),
    "explicit"      if worded as must/minimum/required,
    "silent"        otherwise.
  In \`note\`, quote the posting's own wording (short).
- themes: which of the candidate's fact clusters this role rewards most (3-5, ranked).
- scope: does material for this application attach to one requisition ("per-application")
  or to a platform-wide profile ("per-profile")? Judge from the posting/platform; if you
  cannot tell, "unknown" — the UI will ask the human.
- advisory: if any gate has met=no with posture explicit or silent, state plainly whether
  to apply anyway or skip, and why, in ≤2 sentences. Unmet minimums are decisions, not
  details. Otherwise empty string.
Judge only from the posting text and candidate facts given. Do not invent requirements.`

const jdText = 'Staff Backend Engineer\n\nMinimum 8 years of production Go. Must be authorized to work in the US.'
const facts: Fact[] = [
  { id: 'f1', claim: 'Three years backend, mostly payments', sourceSnippet: 'Backend engineer', tags: ['backend'] },
  { id: 'f2', claim: 'Writes Go in production', sourceSnippet: 'Written in Go', tags: ['go'] },
]
const factsSummary = summarizeFacts(facts)

const built = () => buildJobInterpretPrompt({ jdText, factsSummary })
const system = () => built().system
const textOf = (parts: ReturnType<typeof built>['parts']) =>
  parts.map((p) => ('text' in p ? p.text : '')).join('\n')

describe('buildJobInterpretPrompt system text', () => {
  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(VERBATIM)
  })

  it('defines all three gate postures for the model', () => {
    const s = system()
    expect(s).toContain('"escape-clause" if the posting itself softens it')
    expect(s).toContain('"explicit"      if worded as must/minimum/required')
    expect(s).toContain('"silent"        otherwise')
  })

  it('splits scope into per-application and per-profile', () => {
    const s = system()
    expect(s).toContain('"per-application"')
    expect(s).toContain('"per-profile"')
    expect(s).toContain('the UI will ask the human')
  })

  it('demands an advisory whenever a gate is unmet', () => {
    // The one line that turns "you do not meet a minimum" from a detail into a decision.
    expect(system()).toMatch(
      /advisory: if any gate has met=no with posture explicit or silent, state plainly whether\s+to apply anyway or skip/,
    )
    expect(system()).toContain('Unmet minimums are decisions, not')
  })

  it('is the same text whatever the inputs are', () => {
    expect(buildJobInterpretPrompt({ jdText: 'other', factsSummary: '' }).system).toBe(system())
  })
})

describe('buildJobInterpretPrompt parts', () => {
  it('puts the job posting in front of the model', () => {
    expect(textOf(built().parts)).toContain(jdText)
  })

  it('puts the candidate fact summary in front of the model', () => {
    expect(textOf(built().parts)).toContain(factsSummary)
  })

  it('carries every fact id and claim', () => {
    const text = textOf(built().parts)
    for (const f of facts) {
      expect(text).toContain(f.id)
      expect(text).toContain(f.claim)
    }
  })
})

describe('summarizeFacts', () => {
  it('renders one `f<id>: claim` line per fact', () => {
    expect(summarizeFacts(facts)).toBe(
      'f1: Three years backend, mostly payments\nf2: Writes Go in production',
    )
  })

  it('drops the source snippets — the gate judgment does not need them, and tokens cost', () => {
    const summary = summarizeFacts(facts)
    expect(summary).not.toContain('Backend engineer')
    expect(summary).not.toContain('Written in Go')
  })

  it('is an empty string when the candidate has no facts yet', () => {
    // A brand-new profile is a real state: every gate is then judged "unclear", not invented.
    expect(summarizeFacts([])).toBe('')
  })
})
