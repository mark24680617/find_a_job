import { describe, it, expect } from 'vitest'

// The sample world is the only data in this product nobody typed in, so it is the only data
// that can be wrong without anyone noticing until a judge is looking at it. These tests hold
// it to the same invariants the live flows are held to: a citation the reader can follow, a
// fact id sequence the merge can extend, a standard answer the typed control can render, and
// a draft inside its own stated limit. If the seed breaks one of them the product looks
// broken — "source not found" under a phrase is exactly the failure the citations exist to
// prevent — and it breaks silently, because no flow ran to catch it.

import { buildSampleWorld, SAMPLE_COMPANY } from '@/lib/sampleWorld'
import { segment } from '@/components/review/CitationText'
import { countUnits } from '@/lib/countText'
import { groupFacts } from '@/lib/profileView'
import { parseField, serializeField, STANDARD_FIELDS, UNKNOWN } from '@/lib/standardFields'

const NOW = new Date('2026-08-29T12:00:00.000Z')
const world = buildSampleWorld(NOW)

describe('buildSampleWorld — the profile', () => {
  it('numbers the facts f1..fN with no gaps, which is what mergeIngest extends from', () => {
    const ids = world.profile.facts.map((f) => f.id)
    expect(ids).toEqual(ids.map((_, i) => `f${i + 1}`))
    expect(ids.length).toBeGreaterThanOrEqual(12)
  })

  it('gives every fact a source snippet, so nothing in the vault is unattributed', () => {
    for (const fact of world.profile.facts) {
      expect(fact.claim.trim()).not.toBe('')
      expect(fact.sourceSnippet.trim()).not.toBe('')
      expect(fact.tags.length).toBeGreaterThan(0)
    }
  })

  it('spreads the facts across the resume sections the organized view groups by', () => {
    const sections = groupFacts(world.profile.facts).map((g) => g.section)
    expect(sections).toEqual(['Contact', 'Education', 'Experience', 'Projects', 'Skills'])
  })

  it('answers every standard key, and each answered one is in its canonical typed form', () => {
    const answers = world.profile.standardAnswers
    expect(Object.keys(answers).sort()).toEqual(STANDARD_FIELDS.map((f) => f.key).sort())

    for (const field of STANDARD_FIELDS) {
      const stored = answers[field.key]
      // The unanswered two are the next test's subject. Left in this loop they pass it
      // trivially — UNKNOWN parses to `unknown` and serializes back — so the assertion would
      // hold even if the seed answered nothing at all.
      if (stored === UNKNOWN) continue
      const parsed = parseField(field.kind, stored)
      // A stored answer that does not fit its kind parses to `text` and lands the profile
      // screen on a bare input instead of the control the field is meant to have.
      expect({ key: field.key, type: parsed.type }).not.toEqual({ key: field.key, type: 'text' })
      // Re-saving what the seed wrote must not drift the string.
      expect(serializeField(parsed)).toBe(stored)
    }
  })

  it('leaves two standard answers unanswered, so the amber state is on screen too', () => {
    const unknown = Object.values(world.profile.standardAnswers).filter((v) => v === UNKNOWN)
    expect(unknown).toHaveLength(2)
  })

  it('carries voice rules with the evidence they were learned from', () => {
    expect(world.profile.voiceRules.length).toBeGreaterThanOrEqual(1)
    for (const rule of world.profile.voiceRules) {
      expect(rule.rule.trim()).not.toBe('')
      expect(rule.evidence.trim()).not.toBe('')
      expect(Number.isNaN(Date.parse(rule.createdAt))).toBe(false)
    }
  })

  it('leaves two gaps open, because a profile with nothing missing teaches nothing', () => {
    expect(world.profile.gaps).toHaveLength(2)
    for (const gap of world.profile.gaps) expect(gap.trim()).not.toBe('')
  })
})

describe('buildSampleWorld — the application', () => {
  const app = world.application

  it('is the fictional posting, with the ordering field a list query needs', () => {
    expect(app.company).toBe(SAMPLE_COMPANY)
    expect(app.role.trim()).not.toBe('')
    // listApplications orders by createdAt; a document without it never appears.
    expect(Number.isNaN(Date.parse(app.createdAt))).toBe(false)
    expect(Date.parse(app.createdAt)).toBeLessThan(NOW.getTime())
    expect(app.jdRaw.split('\n').length).toBeGreaterThanOrEqual(30)
  })

  it('has three timeline events, in the order they happened', () => {
    const at = app.timeline.map((e) => Date.parse(e.at))
    expect(at).toHaveLength(3)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    expect(at.at(-1)).toBeLessThanOrEqual(NOW.getTime())
  })

  it('covers all three gate verdicts, each with a posture and a note', () => {
    const gates = app.parsed!.gates
    expect(gates.map((g) => g.met).sort()).toEqual(['no', 'unclear', 'yes'])
    expect(new Set(gates.map((g) => g.posture)).size).toBeGreaterThan(1)
    for (const gate of gates) {
      expect(gate.requirement.trim()).not.toBe('')
      expect(gate.note.trim()).not.toBe('')
    }
  })

  it('carries the apply-or-skip advisory an unmet gate obliges it to', () => {
    expect(app.parsed!.gates.some((g) => g.met === 'no')).toBe(true)
    expect(app.parsed!.advisory.trim()).not.toBe('')
    expect(app.parsed!.scope).toBe('per-application')
    expect(app.parsed!.roleFacts.length).toBeGreaterThan(0)
    expect(app.parsed!.themes.length).toBeGreaterThan(0)
  })

  it('shows one question in each of the three states', () => {
    expect(app.questions.map((q) => q.status)).toEqual(['drafted', 'final', 'pending'])
  })

  it('cites only facts that exist, at spans that appear verbatim in the draft', () => {
    const known = new Set(world.profile.facts.map((f) => f.id))
    const cited = app.questions.flatMap((q) => (q.draft ? q.draft.citations.map((c) => ({ q, c })) : []))
    expect(cited.length).toBeGreaterThanOrEqual(3)

    for (const { q, c } of cited) {
      // An unknown factId renders as "(source not found)"; a span that is not in the text
      // renders as nothing at all. Both are the citation failing at exactly its job.
      expect(known.has(c.factId)).toBe(true)
      expect(c.claimSpan.trim()).not.toBe('')
      expect(q.draft!.text).toContain(c.claimSpan)
    }
  })

  it('marks every citation on screen, through the same function the workspace renders with', () => {
    // The checks above are the preconditions; this is the outcome. `segment` also drops a span
    // that overlaps an earlier one — two underlines fighting over the same words render as
    // neither — and that is invisible to a test that only looks at the citation list.
    for (const q of app.questions) {
      if (!q.draft) continue
      const segments = segment(q.draft.text, q.draft.citations)
      expect(segments.filter((s) => s.citation)).toHaveLength(q.draft.citations.length)
      expect(segments.map((s) => s.text).join('')).toBe(q.draft.text)
    }
  })

  it('keeps every draft and final inside the limit its question states', () => {
    for (const q of app.questions) {
      const { limit, unit } = q.constraints
      if (!limit || !unit) continue
      for (const text of [q.draft?.text, q.final]) {
        if (text) expect(countUnits(text, unit)).toBeLessThanOrEqual(limit)
      }
    }
  })

  it('carries a clarify round with one of its two questions answered', () => {
    const q = app.questions[0]
    expect(q.clarify).toHaveLength(2)
    expect(q.clarifyAnswers).toHaveLength(1)

    const ids = new Set(q.clarify!.map((c) => c.id))
    expect([...ids]).toEqual(['c1', 'c2'])
    for (const answer of q.clarifyAnswers!) {
      // The draft route keys an answer back by this id; one that names no question is dropped.
      expect(ids.has(answer.id)).toBe(true)
      expect(answer.answer.length).toBeGreaterThan(0)
      // And the values have to be that question's OWN options: `seedCard` treats anything it
      // cannot match as the free-text "in my own words", so a typo'd value would silently
      // reopen the card as an override rather than the settled choice the seed means to show.
      const asked = q.clarify!.find((c) => c.id === answer.id)!
      expect(asked.options.map((o) => o.value)).toEqual(expect.arrayContaining(answer.answer))
    }
    for (const c of q.clarify!) {
      // The clarify flow refuses its own output when `recommended` names no real option.
      expect(c.options.map((o) => o.value)).toContain(c.recommended)
      expect(c.options.length).toBeGreaterThanOrEqual(2)
      expect(c.why.trim()).not.toBe('')
    }
  })

  it('leaves the last question unanswered with an open question for the human', () => {
    const q = app.questions.at(-1)!
    expect(q.draft).toBeUndefined()
    expect(q.final).toBeUndefined()
    expect(q.askHuman).toHaveLength(1)
    expect(q.askHuman[0].question.trim()).not.toBe('')
    expect(q.askHuman[0].why.trim()).not.toBe('')
    expect(q.askHuman[0].answer).toBeUndefined()
  })
})

describe('buildSampleWorld — the interview round', () => {
  it('is still ahead, so the dashboard strip has something to show', () => {
    const round = world.interview
    expect(Date.parse(round.datetime!)).toBeGreaterThan(NOW.getTime())
    expect(round.roundType).toBe('recruiter-screen')
    expect(round.people.length).toBeGreaterThan(0)
    expect(round.noticeRaw.trim()).not.toBe('')
  })

  it('stores the round at the hour the email proposes, whatever time the seed was run', () => {
    // Built from the run clock instead of one pinned instant, the stored time is simply whenever
    // the button was pressed — the email offering 10:00 PT while the strip and the .ics file say
    // 02:14. An awkward clock is used deliberately: under a tidy midday one the two agree by
    // accident and this test cannot fail.
    const odd = buildSampleWorld(new Date('2026-08-29T02:14:37.123Z'))
    expect(odd.interview.datetime).toBe('2026-09-03T17:00:00.000Z') // 10:00 Pacific
    expect(odd.interview.noticeRaw).toContain('2026-09-03 at 10:00 PT')
  })

  it('leaves createdAt to createInterview, which stamps it on the write', () => {
    expect('createdAt' in world.interview).toBe(false)
  })

  it('carries a prep brief with all five sections populated', () => {
    // A round card with no brief under it is the interview feature's weakest surface, and the
    // seed is the first thing a judge loads. Every section is filled, because an empty one is
    // not rendered at all — a brief missing two sections looks like a brief that half worked.
    const brief = world.interview.prepBrief
    expect(brief).toBeDefined()
    expect(brief!.likelyTopics.length).toBeGreaterThan(0)
    expect(brief!.questionsToPrepare.length).toBeGreaterThan(0)
    expect(brief!.questionsToAsk.length).toBeGreaterThan(0)
    expect(brief!.factsToRehearse.length).toBeGreaterThan(0)
    expect(brief!.redFlags.length).toBeGreaterThan(0)

    for (const { q, angle } of brief!.questionsToPrepare) {
      expect(q.trim()).not.toBe('')
      expect(angle.trim()).not.toBe('')
    }
  })

  it('rehearses the candidate’s own claims, quoted verbatim from the profile', () => {
    // The whole point of the section: these are the candidate's words handed back, not the
    // model's paraphrase of them. A line that has drifted out of the fact bank is a line the
    // brief invented, which is the one thing this product may never do.
    const claims = world.profile.facts.map((f) => f.claim)
    for (const line of world.interview.prepBrief!.factsToRehearse) {
      expect(claims).toContain(line)
    }
  })

  it('flags the one gate the parse marked unmet, and says how to raise it', () => {
    const unmet = world.application.parsed!.gates.filter((g) => g.met === 'no')
    expect(unmet).toHaveLength(1)
    // Named, not alluded to: the red flag is only useful if the reader can tell which gate it
    // is about before they are on the call.
    const flags = world.interview.prepBrief!.redFlags.join('\n')
    expect(flags).toContain('Seattle')
    expect(flags).toContain('not negotiable')
  })
})

describe('buildSampleWorld — determinism and provenance', () => {
  it('builds the same world twice from the same clock', () => {
    expect(buildSampleWorld(NOW)).toEqual(world)
  })

  it('moves with the clock it is given, so a seed is never stale on arrival', () => {
    const later = buildSampleWorld(new Date('2026-12-01T12:00:00.000Z'))
    expect(Date.parse(later.interview.datetime!)).toBeGreaterThan(Date.parse('2026-12-01T12:00:00.000Z'))
  })

  it('is entirely invented — no real person or company anywhere in it', () => {
    const json = JSON.stringify(world).toLowerCase()
    for (const real of ['mark', 'qiu', 'luqlabs', 'anthropic', 'google']) {
      expect(json).not.toContain(real)
    }
  })
})
