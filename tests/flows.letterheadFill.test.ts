import { describe, it, expect, vi } from 'vitest'
import { runLetterheadFill } from '@/ai/flows/letterheadFill'
import { LETTERHEAD_FIELD_MAX } from '@/lib/letter/letterhead'
import type { Fact } from '@/lib/types'

// The flow is one call and one guard, and the guard is the whole of what this file is about: a
// value survives only when its quote is really in the document that field was named for. There is
// no correction round to test — a quote the model composed is dropped rather than argued with,
// because a blank letterhead line is the honest output and a retyped one is a keystroke.

const facts: Fact[] = [
  {
    id: 'f1',
    claim: 'Based in Portland, Oregon.',
    sourceSnippet: 'Tom Candidate — Portland, Oregon — (503) 555-0161',
    tags: ['contact'],
  },
]

const jdText = [
  'Senior Backend Engineer at Marram Systems.',
  'Applications go to Dana Wu, Head of Engineering.',
  'The team sits at 1 Marram Way, Bristol, England.',
].join('\n')

const input = { facts, jdText, parsed: { company: 'Marram Systems', role: 'Senior Backend Engineer' } }

const none = {
  phone: null,
  location: null,
  recipient: null,
  recipientTitle: null,
  companyAddress: null,
}

const run = (out: Record<string, unknown>) =>
  runLetterheadFill(input, vi.fn().mockResolvedValue({ output: { ...none, ...out } }))

describe('runLetterheadFill — what it keeps', () => {
  it('keeps a value whose quote is in the document that field was named for', async () => {
    const filled = await run({
      phone: { text: '(503) 555-0161', quote: 'Portland, Oregon — (503) 555-0161' },
      location: { text: 'Portland, OR', quote: 'Based in Portland, Oregon.' },
      recipient: { text: 'Dana Wu', quote: 'Applications go to Dana Wu' },
      recipientTitle: { text: 'Head of Engineering', quote: 'Dana Wu, Head of Engineering' },
      companyAddress: { text: '1 Marram Way\nBristol, England', quote: '1 Marram Way, Bristol, England' },
    })
    expect(filled).toStrictEqual({
      phone: '(503) 555-0161',
      location: 'Portland, OR',
      recipient: 'Dana Wu',
      recipientTitle: 'Head of Engineering',
      companyAddress: '1 Marram Way\nBristol, England',
    })
  })

  it('matches a quote the model re-wrapped, as every other quote check does', async () => {
    const filled = await run({
      recipient: { text: 'Dana Wu', quote: 'Applications  go to\n  Dana Wu' },
    })
    expect(filled).toStrictEqual({ recipient: 'Dana Wu' })
  })

  it('thinks for nothing — this is a read, not a judgment', async () => {
    const generate = vi.fn().mockResolvedValue({ output: none })
    await runLetterheadFill(input, generate)
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(generate.mock.calls[0][0].config.temperature).toBe(0)
  })
})

describe('runLetterheadFill — what it drops', () => {
  it('leaves a null field absent rather than blank', async () => {
    expect(await run({})).toStrictEqual({})
  })

  it('drops a value whose quote is in neither document', async () => {
    const filled = await run({
      recipient: { text: 'Dana Wu', quote: 'Please address your letter to Dana Wu' },
    })
    expect(filled).toStrictEqual({})
  })

  it('drops a candidate’s field quoted from the posting, and the other way round', async () => {
    // Bristol is in the posting and nowhere in Tom's facts; the ledger fact is in his facts and
    // nowhere in the posting. Each is a real span of the wrong document, which is exactly the
    // mistake rule 3 names and the only one a corpus-per-field check can catch.
    const filled = await run({
      location: { text: 'Bristol, England', quote: '1 Marram Way, Bristol, England' },
      recipient: { text: 'Tom Candidate', quote: 'Tom Candidate — Portland, Oregon' },
    })
    expect(filled).toStrictEqual({})
  })

  it('drops a quote longer than a quote may be', async () => {
    const long = 'x'.repeat(200)
    const filled = await runLetterheadFill(
      { ...input, jdText: `Applications go to Dana Wu. ${long} ${long}` },
      vi.fn().mockResolvedValue({
        output: { ...none, recipient: { text: 'Dana Wu', quote: `${long} ${long}` } },
      }),
    )
    expect(filled).toStrictEqual({})
  })

  it('drops a location broken across lines, and keeps a company address that is', async () => {
    const filled = await run({
      location: { text: 'Portland,\nOregon', quote: 'Based in Portland, Oregon.' },
      companyAddress: { text: '1 Marram Way\nBristol, England', quote: '1 Marram Way, Bristol, England' },
    })
    expect(filled).toStrictEqual({ companyAddress: '1 Marram Way\nBristol, England' })
  })

  it('trims what it keeps and cuts it to one line of an address block', async () => {
    const long = `Dana Wu ${'a'.repeat(400)}`
    const filled = await runLetterheadFill(
      { ...input, jdText: `Applications go to ${long}.` },
      vi.fn().mockResolvedValue({
        output: { ...none, recipient: { text: `  ${long}  `, quote: 'Applications go to Dana Wu' } },
      }),
    )
    expect(filled.recipient).toHaveLength(LETTERHEAD_FIELD_MAX)
    expect(filled.recipient?.startsWith('Dana Wu ')).toBe(true)
  })
})
