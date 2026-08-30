import { describe, it, expect } from 'vitest'
import { buildFormParsePrompt } from '@/ai/prompts/formParse'

// The system text is the product's core learning about forms, stated to the model word for
// word: the control type is the length spec nobody writes down, and a limit is only real
// when the form shows one. A paraphrase would quietly change what the model extracts, so a
// verbatim copy lives here and the build fails if the prompt drifts from it.
const VERBATIM = `You read a job-application form (pasted text and/or screenshots) and extract its questions.
- One entry per answerable field. Skip pure data fields (name, email, phone, resume upload)
  UNLESS they carry constraints worth flagging.
- constraints: limit + unit ONLY if the form states or shows one (e.g. "max 500 characters",
  a visible counter). A single-line input implies a SHORT answer even with no stated limit —
  then set type "short-text" and no limit. Multi-line → "long-text". Dropdowns → "select".
- required: true only if marked required (asterisk, "required").
- scope: "per-profile" if the form is a platform-wide profile (wording like "your profile",
  reused across jobs), "per-application" if tied to this one requisition, else "unknown".
  scopeEvidence: quote the wording you judged from.
The control type is the unwritten length spec. Read the form, not your assumptions.`

const png = { base64: 'aW1hZ2Utb25l', mime: 'image/png' as const }
const jpeg = { base64: 'aW1hZ2UtdHdv', mime: 'image/jpeg' as const }
const webp = { base64: 'aW1hZ2UtdGhyZWU=', mime: 'image/webp' as const }
const text = 'Why do you want to work here? (max 500 characters)'

const system = () => buildFormParsePrompt({ text, images: [png] }).system

describe('buildFormParsePrompt system text', () => {
  it('carries the spec system text verbatim', () => {
    expect(system()).toContain(VERBATIM)
  })

  it('states the maxLength rule — a limit only when the form shows one', () => {
    const s = system()
    expect(s).toContain(
      'constraints: limit + unit ONLY if the form states or shows one (e.g. "max 500 characters",',
    )
    expect(s).toContain('a visible counter)')
  })

  it('maps every control type to a length, single-line included', () => {
    const s = system()
    expect(s).toMatch(
      /A single-line input implies a SHORT answer even with no stated limit —\s+then set type "short-text" and no limit\./,
    )
    expect(s).toContain('Multi-line → "long-text"')
    expect(s).toContain('Dropdowns → "select"')
    // The line the whole flow exists for: the control is the spec nobody wrote down.
    expect(s).toContain('The control type is the unwritten length spec.')
  })

  it('states the scope rule and demands the wording it was judged from', () => {
    const s = system()
    expect(s).toMatch(
      /scope: "per-profile" if the form is a platform-wide profile \(wording like "your profile",\s+reused across jobs\), "per-application" if tied to this one requisition, else "unknown"\./,
    )
    expect(s).toContain('scopeEvidence: quote the wording you judged from.')
  })

  it('is the same text whatever the inputs are', () => {
    expect(buildFormParsePrompt({ text: 'other', images: [] }).system).toBe(system())
  })
})

describe('buildFormParsePrompt parts', () => {
  it('turns each image into a media part with its own data-URL prefix', () => {
    const { parts } = buildFormParsePrompt({ images: [png, jpeg, webp] })
    expect(parts).toEqual([
      { media: { url: 'data:image/png;base64,aW1hZ2Utb25l', contentType: 'image/png' } },
      { media: { url: 'data:image/jpeg;base64,aW1hZ2UtdHdv', contentType: 'image/jpeg' } },
      { media: { url: 'data:image/webp;base64,aW1hZ2UtdGhyZWU=', contentType: 'image/webp' } },
    ])
  })

  it('turns the pasted text into a text part carrying it whole', () => {
    const { parts } = buildFormParsePrompt({ text, images: [] })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toHaveProperty('text')
    expect((parts[0] as { text: string }).text).toContain(text)
  })

  it('sends screenshots and pasted text together, screenshots first', () => {
    const { parts } = buildFormParsePrompt({ text, images: [png] })
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({
      media: { url: 'data:image/png;base64,aW1hZ2Utb25l', contentType: 'image/png' },
    })
    expect((parts[1] as { text: string }).text).toContain(text)
  })

  it('sends one data-URL prefix, whatever the browser handed over', () => {
    // A FileReader result arrives already prefixed. Prefixing it again would send the
    // model a payload that decodes to nothing, and the declared mime is the one to trust:
    // it is what the route checked against the allowed list.
    const { parts } = buildFormParsePrompt({
      images: [
        { base64: 'data:image/png;base64,aW1hZ2Utb25l', mime: 'image/png' },
        { base64: 'data:image/jpeg;base64,aW1hZ2UtdHdv', mime: 'image/png' },
      ],
    })
    expect(parts).toEqual([
      { media: { url: 'data:image/png;base64,aW1hZ2Utb25l', contentType: 'image/png' } },
      { media: { url: 'data:image/png;base64,aW1hZ2UtdHdv', contentType: 'image/png' } },
    ])
  })

  it('drops an empty text rather than sending an empty part', () => {
    expect(buildFormParsePrompt({ text: '', images: [png] }).parts).toHaveLength(1)
  })

  it('refuses to ask for questions with no form in front of the model', () => {
    expect(() => buildFormParsePrompt({ images: [] })).toThrow(/formParse needs/)
    expect(() => buildFormParsePrompt({ text: '', images: [] })).toThrow(/formParse needs/)
  })
})
