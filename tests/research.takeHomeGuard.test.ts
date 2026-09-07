import { describe, it, expect } from 'vitest'
import { guardTakeHomeGuide, type SynthesizedGuide } from '@/lib/research/takeHomeGuard'

// The brief every quote below is checked against. Its first sentence is wrapped on purpose: a
// brief pasted out of an email or transcribed from a PDF breaks its lines where the page did,
// and a model that copied a sentence faithfully will not have the same breaks. Both sides are
// normalised, so faithful is what counts and not identical.
const LONG_RUN = 'x'.repeat(241)
const BRIEF = [
  'Build a small service that ingests a CSV of transactions and exposes one endpoint that',
  'returns the daily totals. Spend no more than four hours on it.',
  'Hand in a repository and a short README explaining the choices you made.',
  'We look for tests, clear naming and a README we can follow.',
  `One very long sentence, for the cap: ${LONG_RUN}`,
].join('\n')

const ids = new Set(['s1', 's2'])

const guide = (over: Partial<SynthesizedGuide> = {}): SynthesizedGuide => ({
  brief: {
    task: 'A small CSV ingest service with one endpoint for daily totals.',
    timeLimit: { text: 'Four hours at most.', quote: 'Spend no more than four hours on it.' },
    deliverables: [
      { text: 'A repository and a short README.', quote: 'Hand in a repository and a short README' },
    ],
    constraints: [{ text: 'Four hours at most.', quote: 'Spend no more than four hours on it.' }],
    evaluation: [{ text: 'Tests and clear naming.', quote: 'We look for tests, clear naming' }],
  },
  reported: {
    tasks: [{ text: 'Others were given the same CSV exercise.', sourceIds: ['s1'] }],
    evaluation: [{ text: 'Reviewers read the README first.', sourceIds: ['s1', 's2'] }],
    pitfalls: [],
    time: [],
  },
  plan: [{ step: 'Read the brief twice.', budget: '10 min' }, { step: 'Write the ingest.' }],
  askRecruiter: ['Which language do you expect?'],
  caveats: ['Two write-ups, both undated.'],
  ...over,
})

describe('guardTakeHomeGuide', () => {
  it('passes a guide whose quotes are in the brief and whose citations exist, and leaves the input alone', () => {
    const original = guide()
    const before = structuredClone(original)
    const { guide: out, problems } = guardTakeHomeGuide(original, ids, BRIEF)
    expect(problems).toEqual([])
    expect(out).toStrictEqual(before)
    // A repaired copy, not a repair in place: the flow hands the model's output back in the
    // correction part, and it has to be the thing the model actually wrote.
    expect(original).toStrictEqual(before)
  })

  it('counts a source once, however many times an item names it', () => {
    // A model that cites the same digest twice is not two people saying the same thing, and the
    // count on the page is the claim's weight. Repaired where the record is written, so every
    // reader of the stored guide gets the same count.
    const { guide: out, problems } = guardTakeHomeGuide(
      guide({
        reported: {
          tasks: [{ text: 'Others were given the same CSV exercise.', sourceIds: ['s1', 's1'] }],
          evaluation: [], pitfalls: [], time: [],
        },
      }),
      ids,
      BRIEF,
    )
    expect(problems).toEqual([])
    expect(out.reported.tasks).toStrictEqual([
      { text: 'Others were given the same CSV exercise.', sourceIds: ['s1'] },
    ])
  })

  it('rejects a citation onto a source that was never provided', () => {
    const { problems } = guardTakeHomeGuide(
      guide({
        reported: {
          tasks: [{ text: 'A design doc as well.', sourceIds: ['s9'] }],
          evaluation: [], pitfalls: [], time: [],
        },
      }),
      ids,
      BRIEF,
    )
    expect(problems).toEqual([expect.stringContaining('s9')])
  })

  it('rejects a plan of more than twelve steps', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ step: `Step ${i + 1}.` }))
    expect(guardTakeHomeGuide(guide({ plan: twelve }), ids, BRIEF).problems).toEqual([])
    const thirteen = [...twelve, { step: 'Step 13.' }]
    expect(guardTakeHomeGuide(guide({ plan: thirteen }), ids, BRIEF).problems).toEqual([
      expect.stringContaining('13 steps'),
    ])
  })

  it('rejects an empty brief.task, whitespace included', () => {
    expect(guardTakeHomeGuide(guide({ brief: { ...guide().brief, task: '' } }), ids, BRIEF).problems)
      .toHaveLength(1)
    expect(guardTakeHomeGuide(guide({ brief: { ...guide().brief, task: '  \n ' } }), ids, BRIEF).problems)
      .toHaveLength(1)
  })

  it('drops a reported sentence nobody reported, and says nothing about it', () => {
    const { guide: out, problems } = guardTakeHomeGuide(
      guide({
        reported: {
          tasks: [
            { text: 'Others were given the same CSV exercise.', sourceIds: ['s1'] },
            { text: 'They also ask for a design doc.', sourceIds: [] },
          ],
          evaluation: [], pitfalls: [], time: [],
        },
      }),
      ids,
      BRIEF,
    )
    // A repair, not a rejection: the rest of the guide is still worth having, and one
    // unsupported sentence is not worth another minute of the candidate's wait.
    expect(problems).toEqual([])
    expect(out.reported.tasks).toStrictEqual([
      { text: 'Others were given the same CSV exercise.', sourceIds: ['s1'] },
    ])
  })

  it('drops a quoted item whose quote is empty, over the cap, or not in the brief — text and all', () => {
    const { guide: out, problems } = guardTakeHomeGuide(
      guide({
        brief: {
          ...guide().brief,
          deliverables: [
            { text: 'A repository.', quote: '' },
            { text: 'Something very long.', quote: LONG_RUN },
            { text: 'A README.', quote: 'Send us a repo and some notes' },
            { text: 'A repository and a short README.', quote: 'Hand in a repository and a short README' },
          ],
        },
      }),
      ids,
      BRIEF,
    )
    expect(problems).toEqual([])
    // The sentence rested on the quote, so it goes with it — a "the brief asks for X" with
    // nothing under it is exactly the sentence this feature exists not to show.
    expect(out.brief.deliverables).toStrictEqual([
      { text: 'A repository and a short README.', quote: 'Hand in a repository and a short README' },
    ])
    // The cap is 240: the run is in the brief, so it is length and nothing else that drops it.
    expect(LONG_RUN.length).toBe(241)
  })

  it('drops a timeLimit that fails the same check, leaving no key behind', () => {
    const { guide: out, problems } = guardTakeHomeGuide(
      guide({
        brief: { ...guide().brief, timeLimit: { text: 'One working day.', quote: 'one working day' } },
      }),
      ids,
      BRIEF,
    )
    expect(problems).toEqual([])
    expect(out.brief.timeLimit).toBeUndefined()
    expect('timeLimit' in out.brief).toBe(false)
  })

  it('keeps a quote that differs from the brief only in whitespace, on either side', () => {
    // The brief wraps mid-sentence; the model's copy does not.
    const flat = { text: 'A CSV in, daily totals out.', quote: 'ingests a CSV of transactions and exposes one endpoint that returns the daily totals' }
    // And the other way round: the model's copy wraps where the brief does not.
    const ragged = { text: 'A repository and a README.', quote: 'Hand in a repository\n   and a short README' }
    const { guide: out, problems } = guardTakeHomeGuide(
      guide({ brief: { ...guide().brief, deliverables: [flat, ragged] } }),
      ids,
      BRIEF,
    )
    expect(problems).toEqual([])
    // Kept exactly as the model wrote them: only the comparison was normalised, never the text
    // the screen will show under `The brief:`.
    expect(out.brief.deliverables).toStrictEqual([flat, ragged])
  })
})
