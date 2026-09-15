import { describe, it, expect, vi } from 'vitest'
import { runTakeHomeDigest } from '@/ai/flows/takeHomeDigest'
import { runTakeHomeSynthesize } from '@/ai/flows/takeHomeSynthesize'
import { FlowOutputError } from '@/ai/genkit'

describe('runTakeHomeDigest', () => {
  const text =
    'The Marram take-home was a CSV parser. They gave us four days and asked for a repo with a ' +
    'README. I over-engineered it and heard nothing back.'
  const out = {
    task: 'A CSV parser.',
    timeGiven: 'four days',
    deliverables: ['a repo', 'a README'],
    evaluation: ['clarity'],
    pitfalls: ['over-engineering'],
    takeaways: ['Keep it small.', 'Write the README first.'],
    quotes: ['They gave us four days', 'They gave us a week'],
    publishedAt: '2025-04-02',
    firstHand: true,
  }

  it('keeps only the quotes the write-up really contains, and thinks at LOW', async () => {
    const generate = vi.fn().mockResolvedValue({ output: out })
    const res = await runTakeHomeDigest({ company: 'Marram Systems', title: 'My Marram take-home', text }, generate)
    // The second quote is a plausible sentence nobody wrote; it does not reach the synthesis.
    expect(res.quotes).toEqual(['They gave us four days'])
    // Everything else comes back as the model wrote it: the structured fields feed the
    // synthesis, and publishedAt is what dates the source.
    expect(res).toStrictEqual({ ...out, quotes: ['They gave us four days'] })
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })

  it('hands back a digest with no takeaways — whether to drop it is the run’s call', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { ...out, takeaways: [], quotes: [] } })
    const res = await runTakeHomeDigest({ company: 'Marram Systems', title: 't', text }, generate)
    expect(res.takeaways).toEqual([])
    expect(res.task).toBe('A CSV parser.')
  })
})

describe('runTakeHomeSynthesize', () => {
  const briefText = [
    'Build a small service that ingests a CSV of transactions and exposes one endpoint that',
    'returns the daily totals. Spend no more than four hours on it.',
    'Hand in a repository and a short README explaining the choices you made.',
  ].join('\n')

  // `brief` is the whole of it: the text the prompt lays out for the model is the text the
  // guard checks its quotes against, and there is no second field for the two to drift between.
  const input = {
    jobSummary: 'Company: Marram Systems',
    family: 'software engineering' as const,
    brief: briefText,
    notes: [{ sourceIds: ['s1'], text: 'Candidates report a four-hour CSV exercise.' }],
    digests: [],
    sourceIds: ['s1'],
    grounded: true,
  }

  const good = {
    brief: {
      task: 'A small CSV ingest service with one endpoint.',
      timeLimit: { text: 'Four hours at most.', quote: 'Spend no more than four hours on it.' },
      deliverables: [
        { text: 'A repository and a short README.', quote: 'Hand in a repository and a short README' },
      ],
      constraints: [{ text: 'Four hours at most.', quote: 'Spend no more than four hours on it.' }],
      evaluation: [],
    },
    reported: {
      tasks: [{ text: 'A four-hour CSV exercise.', sourceIds: ['s1'] }],
      evaluation: [],
      pitfalls: [],
      time: [],
    },
    plan: [
      { step: 'Read the brief twice.', budget: '10 min' },
      { step: 'Write the ingest.', budget: null },
    ],
    askRecruiter: ['Which language do you expect?'],
    caveats: ['One source.'],
  }

  it('strips the nulls to absent and thinks at MEDIUM', async () => {
    const generate = vi.fn().mockResolvedValue({ output: good })
    const guide = await runTakeHomeSynthesize(input, generate)
    expect(guide.plan[0].budget).toBe('10 min')
    expect(guide.plan[1].budget).toBeUndefined()
    expect('budget' in guide.plan[1]).toBe(false)
    expect(guide.brief.timeLimit).toEqual({
      text: 'Four hours at most.',
      quote: 'Spend no more than four hours on it.',
    })
    expect(generate.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' })
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('leaves no timeLimit key behind when the brief states none', async () => {
    const generate = vi.fn().mockResolvedValue({ output: { ...good, brief: { ...good.brief, timeLimit: null } } })
    const guide = await runTakeHomeSynthesize(input, generate)
    expect(guide.brief.timeLimit).toBeUndefined()
    expect('timeLimit' in guide.brief).toBe(false)
  })

  it('drops a reported sentence nobody reported, without spending a retry on it', async () => {
    const output = {
      ...good,
      reported: {
        ...good.reported,
        tasks: [...good.reported.tasks, { text: 'They also ask for a design doc.', sourceIds: [] }],
      },
    }
    const generate = vi.fn().mockResolvedValue({ output })
    const guide = await runTakeHomeSynthesize(input, generate)
    expect(guide.reported.tasks).toStrictEqual([{ text: 'A four-hour CSV exercise.', sourceIds: ['s1'] }])
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('drops a brief item whose quote is a paraphrase, and the sentence with it', async () => {
    const output = {
      ...good,
      brief: { ...good.brief, deliverables: [{ text: 'A repository.', quote: 'Send us a repo' }] },
    }
    const generate = vi.fn().mockResolvedValue({ output })
    const guide = await runTakeHomeSynthesize(input, generate)
    expect(guide.brief.deliverables).toEqual([])
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('drops a timeLimit the brief does not contain', async () => {
    const output = {
      ...good,
      brief: { ...good.brief, timeLimit: { text: 'One working day.', quote: 'one working day' } },
    }
    const generate = vi.fn().mockResolvedValue({ output })
    const guide = await runTakeHomeSynthesize(input, generate)
    expect(guide.brief.timeLimit).toBeUndefined()
  })

  it('carries an unknown source id back to the model once, with what it wrote', async () => {
    const bad = {
      ...good,
      reported: { ...good.reported, tasks: [{ text: 'A four-hour CSV exercise.', sourceIds: ['s9'] }] },
    }
    const generate = vi.fn().mockResolvedValueOnce({ output: bad }).mockResolvedValueOnce({ output: good })
    const guide = await runTakeHomeSynthesize(input, generate)
    expect(guide.reported.tasks[0].sourceIds).toEqual(['s1'])
    expect(generate).toHaveBeenCalledTimes(2)
    const retry = generate.mock.calls[1][0].prompt as { text: string }[]
    expect(retry.at(-1)?.text).toContain('Your previous guide was rejected.')
    expect(retry.at(-1)?.text).toContain('s9')
    // The correction carries the model's own output back, not the repaired copy: what it has to
    // fix is the thing it wrote.
    expect(retry.at(-1)?.text).toContain('"sourceIds":["s9"]')
  })

  it('gives up after a second guard rejection', async () => {
    const bad = {
      ...good,
      reported: { ...good.reported, tasks: [{ text: 'A four-hour CSV exercise.', sourceIds: ['s9'] }] },
    }
    const generate = vi.fn().mockResolvedValue({ output: bad })
    await expect(runTakeHomeSynthesize(input, generate)).rejects.toBeInstanceOf(FlowOutputError)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('rejects a plan of more than twelve steps', async () => {
    const bad = {
      ...good,
      plan: Array.from({ length: 13 }, (_, i) => ({ step: `Step ${i + 1}.`, budget: null })),
    }
    const generate = vi.fn().mockResolvedValue({ output: bad })
    await expect(runTakeHomeSynthesize(input, generate)).rejects.toThrow(/13 steps/)
    expect(generate).toHaveBeenCalledTimes(2)
  })
})
