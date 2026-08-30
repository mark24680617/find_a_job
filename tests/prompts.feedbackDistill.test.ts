import { describe, it, expect } from 'vitest'
import { buildFeedbackDistillPrompt } from '@/ai/prompts/feedbackDistill'

// The system text is the one judgment this flow turns on, stated to the model word for word:
// a VOICE rule generalises to the next answer, a content edit does not, and no pattern means
// no rule. A paraphrase would quietly widen what gets learned — content edits promoted to
// rules the next draft then obeys — so a verbatim copy lives here and the build fails if the
// prompt drifts from it.
const VERBATIM = `Compare the AI draft with the human's final edit of the same answer.
Extract 0-3 durable voice rules: how THIS person writes, phrased as instructions a future
draft can follow ("cuts openers, starts with the fact", "replaces adjectives with numbers",
"shortens sentences to <20 words"). Only patterns that would generalize to other answers —
never content-specific edits ("mentions TRM" is content, not voice). evidence: quote the
before→after fragment that shows the rule. If the edit shows no generalizable pattern,
return zero rules. Do not restate existing rules.`

const draft = 'I am excited to say I own a fast payments service.'
const final = 'I own a payments service handling 12,000 requests a day.'
const existingRules = ['cuts openers, starts with the fact']

const built = () => buildFeedbackDistillPrompt({ draft, final, existingRules })
const system = () => built().system
const textOf = (parts: ReturnType<typeof built>['parts']) =>
  parts.map((p) => ('text' in p ? p.text : '')).join('\n')

describe('buildFeedbackDistillPrompt system text', () => {
  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(VERBATIM)
  })

  it('instructs 0-3 durable voice rules, generalizable and never content-specific', () => {
    const s = system()
    expect(s).toContain('Extract 0-3 durable voice rules')
    expect(s).toContain('Only patterns that would generalize to other answers')
    expect(s).toContain('never content-specific edits ("mentions TRM" is content, not voice)')
  })

  it('asks for before→after evidence, and zero rules when nothing generalizes', () => {
    const s = system()
    expect(s).toContain('evidence: quote the\nbefore→after fragment that shows the rule')
    expect(s).toContain('If the edit shows no generalizable pattern,\nreturn zero rules')
    expect(s).toContain('Do not restate existing rules.')
  })

  it('is the same text whatever the inputs are', () => {
    expect(buildFeedbackDistillPrompt({ draft: 'a', final: 'b', existingRules: [] }).system).toBe(
      system(),
    )
  })
})

describe('buildFeedbackDistillPrompt parts', () => {
  it('carries both the draft and the human final edit', () => {
    const t = textOf(built().parts)
    expect(t).toContain(draft)
    expect(t).toContain(final)
  })

  it('labels which text is the before and which is the after', () => {
    const t = textOf(built().parts)
    expect(t).toContain('before')
    expect(t).toContain('after')
  })

  it('lists the rules already known so the model does not restate them', () => {
    const t = textOf(built().parts)
    expect(t).toContain('cuts openers, starts with the fact')
    expect(t).toMatch(/do not restate/i)
  })

  it('drops the known-rules section when the profile has none yet', () => {
    const t = textOf(buildFeedbackDistillPrompt({ draft, final, existingRules: [] }).parts)
    expect(t).toContain(draft)
    expect(t).toContain(final)
    expect(t).not.toMatch(/already known/i)
  })
})
