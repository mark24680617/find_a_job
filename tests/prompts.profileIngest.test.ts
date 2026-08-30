import { describe, it, expect } from 'vitest'
import { STANDARD_KEYS, buildProfileIngestPrompt } from '@/ai/prompts/profileIngest'

// The system text is spec-mandated word for word: it is the only place the never-invent
// rule reaches the model, so a well-meaning paraphrase is a regression. Reproducing it
// here means any edit to the prompt has to be a deliberate edit to the contract too.
const VERBATIM = `You extract a candidate's profile from their resume and notes.
Rules:
- Output facts: atomic, verifiable claims. Each fact MUST carry sourceSnippet: the verbatim
  fragment of the input it came from. Never merge two claims into one fact. Never infer a
  fact that is not stated. Quantified facts (numbers, dates, scale) are separate facts.
- tags: 2-4 lowercase topic tags per fact (e.g. "backend", "ios", "leadership"). Where a fact
  clearly belongs to one named company, school or project, add one further tag "entity:<Name>",
  the name written as the input writes it — "entity:Fenwick". At most one, and only when the
  input names it.
- standardAnswers: for each of these keys, fill the value ONLY if the input states it,
  else the string "UNKNOWN":
  work_authorization, visa_sponsorship_needed, relocation, remote_onsite_preference,
  earliest_start_date, notice_period, salary_expectation, security_clearance.
- gaps: list what a job application will likely need that this input does not contain
  (missing dates, unexplained employment gaps, missing metrics, missing links). Never list a
  gap that one of the standardAnswers keys above already covers — those are asked separately.
A resume states someone's story. Do not improve it, do not embellish it — capture it.`

const pastedText = 'Tom Candidate\nBackend engineer, three years on payments.'
const pdfBase64 = 'JVBERi0xLjQKJcOkw7zDtsOfCg=='

const system = (input: Parameters<typeof buildProfileIngestPrompt>[0]) =>
  buildProfileIngestPrompt(input).system

describe('buildProfileIngestPrompt system text', () => {
  it('carries the spec system text verbatim', () => {
    expect(system({ pastedText })).toContain(VERBATIM)
  })

  it('names every standard-answer key', () => {
    // The keys are pinned by the prompt alone — the JSON schema for standardAnswers is a
    // bare record, so anything missing here is a key the model will simply never fill.
    for (const key of STANDARD_KEYS) expect(system({ pastedText })).toContain(key)
  })

  it('exports the eight keys the profile stores', () => {
    expect(STANDARD_KEYS).toEqual([
      'work_authorization',
      'visa_sponsorship_needed',
      'relocation',
      'remote_onsite_preference',
      'earliest_start_date',
      'notice_period',
      'salary_expectation',
      'security_clearance',
    ])
  })

  it('forbids inventing facts and demands a source snippet for each', () => {
    const text = system({ pastedText })
    // Wrapped across lines in the spec text, hence the whitespace-tolerant match.
    expect(text).toMatch(/Never infer a\s+fact that is not stated/)
    expect(text).toContain('Never merge two claims into one fact.')
    expect(text).toContain('MUST carry sourceSnippet')
    expect(text).toContain('do not embellish it')
  })

  it('tells the model not to re-ask what the standard answers already cover', () => {
    // The profile screen asks the eight standard answers with typed controls of their own, so a
    // gap repeating one of them is the same question in a worse shape. `visibleGaps` filters the
    // ones that get through anyway; this rule is the half that stops them being written.
    expect(system({ pastedText })).toMatch(
      /Never list a\s+gap that one of the standardAnswers keys above already covers/,
    )
  })

  it('states the f1..fN id format the schema enforces', () => {
    // Belt and braces with FactSchema's regex: a model told the format up front rarely
    // spends the one retry the helper has on an id it could have got right first time.
    const text = system({ pastedText })
    expect(text).toMatch(/\bf1\b/)
    expect(text).toMatch(/\bfN\b/)
  })

  it('asks for an entity tag on a fact that belongs to a named company or project', () => {
    // The organized fact bank sub-groups Experience and Projects by this tag; without it the
    // grouping falls back to reading company names out of the claims, which only works when a
    // claim happens to say "at Fenwick".
    const text = system({ pastedText })
    expect(text).toContain('"entity:<Name>"')
    expect(text).toContain('entity:Fenwick')
    expect(text).toMatch(/At most one, and only when the\s+input names it/)
  })

  it('is the same text whatever the input is', () => {
    expect(system({ pdfBase64 })).toBe(system({ pastedText }))
  })
})

describe('buildProfileIngestPrompt parts', () => {
  it('includes pasted text as a text part', () => {
    const { parts } = buildProfileIngestPrompt({ pastedText })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ text: expect.stringContaining(pastedText) })
  })

  it('attaches a PDF as a base64 data-URL media part', () => {
    const { parts } = buildProfileIngestPrompt({ pdfBase64 })
    expect(parts).toEqual([
      {
        media: {
          url: `data:application/pdf;base64,${pdfBase64}`,
          contentType: 'application/pdf',
        },
      },
    ])
  })

  it('sends the PDF before the notes when given both', () => {
    const { parts } = buildProfileIngestPrompt({ pdfBase64, pastedText })
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveProperty('media')
    expect(parts[1]).toMatchObject({ text: expect.stringContaining(pastedText) })
  })

  it('ignores empty strings rather than sending an empty part', () => {
    const { parts } = buildProfileIngestPrompt({ pdfBase64, pastedText: '' })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toHaveProperty('media')
  })

  it('refuses to build a prompt with nothing to read', () => {
    // Without this the model is asked to extract facts from no input at all, and the one
    // thing it must never do is invent them.
    expect(() => buildProfileIngestPrompt({})).toThrow(/pdf|text/i)
  })
})
