import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { problemsWith, runFormParse, statedLimits } from '@/ai/flows/formParse'
import { type GenerateCall } from '@/ai/genkit'
import { FormParseOutSchema, type FormParseOut } from '@/ai/schemas'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the
// real thinking level — everything except the network.

const out = {
  questions: [
    {
      q: 'Why do you want to work at TRM Labs?',
      constraints: { limit: 500, unit: 'chars' as const, type: 'long-text' as const, required: true },
    },
    {
      q: 'Where are you based?',
      constraints: { type: 'short-text' as const, required: false },
    },
  ],
  scope: 'per-application' as const,
  scopeEvidence: 'Application for Account Director',
}

interface SentRequest {
  system?: string
  prompt: ({ text?: string } | { media?: { url: string; contentType: string } })[]
  output: { schema: unknown }
  config: { thinkingConfig: { thinkingLevel: string } }
}

const sent = (generate: { mock: { calls: unknown[][] } }, n = 0) =>
  generate.mock.calls[n][0] as unknown as SentRequest

describe('runFormParse', () => {
  it('returns the extracted questions and the form scope', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runFormParse({ text: 'Question 1', images: [] }, generate)).resolves.toEqual(out)
  })

  it('thinks at MEDIUM against the form schema', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runFormParse({ text: 'Question 1', images: [] }, generate)

    const req = sent(generate)
    expect(req.config).toEqual({ thinkingConfig: { thinkingLevel: 'MEDIUM' } })
    expect(req.output).toEqual({ schema: FormParseOutSchema })
    expect(req.system).toContain('You read a job-application form')
  })

  it('sends screenshots as media parts and the pasted text alongside them', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await runFormParse(
      { text: 'Question 1', images: [{ base64: 'c2hvdA==', mime: 'image/png' }] },
      generate,
    )

    expect(sent(generate).prompt).toEqual([
      { media: { url: 'data:image/png;base64,c2hvdA==', contentType: 'image/png' } },
      { text: 'Pasted form text:\nQuestion 1' },
    ])
  })

  it('parses a form given as screenshots alone', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(
      runFormParse({ images: [{ base64: 'c2hvdA==', mime: 'image/webp' }] }, generate),
    ).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty form rather than calling the model', async () => {
    const generate = vi.fn<GenerateCall>(() => Promise.resolve({ output: out }))
    await expect(runFormParse({ images: [] }, generate)).rejects.toThrow(/formParse needs/)
    expect(generate).not.toHaveBeenCalled()
  })
})

// The completeness guard. The schema checks shape only, and on 2026-10-06 one read in 21 of the
// form below came back as a single question with neither stated limit — valid JSON, so nothing
// retried (docs/notes/deps.md, "Sampling parameters dropped"). The guard reads the pasted text
// for what it states outright and asks once more when the read is missing it.

/** Seven questions, six on a line ending in a question mark, and two stated limits. */
const FORM = readFileSync('tests/fixtures/form-questions.txt', 'utf8')

/** A word limit with the form's counter under it, a counter that names no unit. */
const WORD_LIMIT_WITH_COUNTER = 'What draws you here? *\n250 words maximum\n0 / 250'

const scope = {
  scope: 'per-application' as const,
  scopeEvidence: 'Application for Senior Backend Engineer — Marram Systems',
}

/** The usual read of FORM: all seven questions, both limits on the questions that state them. */
const fullRead: FormParseOut = {
  questions: [
    {
      q: 'Why do you want to work at Marram Systems?',
      constraints: { limit: 500, unit: 'chars', type: 'long-text', required: true },
    },
    {
      q: 'Describe a backend system you designed end to end, and what you would change about it today.',
      constraints: { limit: 250, unit: 'words', type: 'long-text', required: true },
    },
    {
      q: 'What are your preferred working hours, including your time zone?',
      constraints: { type: 'short-text', required: true },
    },
    {
      q: 'Are you legally authorised to work in the United Kingdom?',
      constraints: { type: 'select', required: true },
    },
    {
      q: 'Will you now or in the future require visa sponsorship?',
      constraints: { type: 'select', required: true },
    },
    { q: 'How did you hear about this role?', constraints: { type: 'select', required: true } },
    {
      q: 'Anything else you would like the hiring team for this role to know?',
      constraints: { type: 'long-text', required: false },
    },
  ],
  ...scope,
}

/** The read the A/B caught: one question, no limit on it, and the schema satisfied. */
const collapsedRead: FormParseOut = {
  questions: [
    {
      q: 'Why do you want to work at Marram Systems?',
      constraints: { type: 'long-text', required: true },
    },
  ],
  ...scope,
}

/** What the collapsed read misses, in the words the guard uses. */
const COLLAPSED_PROBLEMS = [
  'the form states "Max 500 characters", but no question carries a limit of 500 characters',
  'the form states "250 words maximum", but no question carries a limit of 250 words',
  'the form has 6 lines that end in a question mark, but only 1 question came back',
]

const pasted = { text: FORM, images: [] }

const returning = (...outputs: FormParseOut[]) => {
  const generate = vi.fn<GenerateCall>()
  for (const output of outputs) generate.mockImplementationOnce(() => Promise.resolve({ output }))
  // Anything past the scripted reads is a call this flow is not allowed to make. Its rejection
  // fails no test by itself: generateStructured retries it, and a second look that cannot be had
  // leaves the first read standing. So every test that scripts its reads here counts the calls.
  generate.mockImplementation(() => Promise.reject(new Error('unexpected extra model call')))
  return generate
}

/** The text of a prompt part; a screenshot part carries none. */
const textOf = (part: SentRequest['prompt'][number] | undefined) =>
  part && 'text' in part ? (part.text ?? '') : ''

describe('statedLimits', () => {
  it.each([
    ['Max 500 characters', 500, 'chars', 'Max 500 characters'],
    ['Max. 500 characters', 500, 'chars', 'Max. 500 characters'],
    ['Maximum 300 words', 300, 'words', 'Maximum 300 words'],
    ['maximum of 300 words', 300, 'words', 'maximum of 300 words'],
    ['up to 1,000 characters', 1000, 'chars', 'up to 1,000 characters'],
    ['no more than 200 words', 200, 'words', 'no more than 200 words'],
    ['at most 150 words', 150, 'words', 'at most 150 words'],
    ['250 words maximum', 250, 'words', '250 words maximum'],
    ['500 character limit', 500, 'chars', '500 character limit'],
    ['150-word limit', 150, 'words', '150-word limit'],
    ['200 words or less', 200, 'words', '200 words or less'],
    ['200 words or fewer', 200, 'words', '200 words or fewer'],
    ['(500 chars max)', 500, 'chars', '500 chars max'],
    // Mid-sentence, after a word: a space ends a number only after a digit.
    ['In 300 words or fewer, describe a project you led.', 300, 'words', '300 words or fewer'],
    ['Please answer in 250 words maximum.', 250, 'words', '250 words maximum'],
    ['1,500 characters maximum', 1500, 'chars', '1,500 characters maximum'],
    // An apostrophe ends a number only after a digit: before one it is a quote mark.
    ["Answer in '500 characters max'", 500, 'chars', '500 characters max'],
    ['0 / 500', 500, 'chars', '0 / 500'],
    ['0/1000 characters', 1000, 'chars', '0/1000 characters'],
    // The number that opens the next line is the next field's, not a limit after this one.
    ['Why us?\n250 words maximum\n2. Describe a project', 250, 'words', '250 words maximum'],
    // Nor does the number that closes the line above run into this one's.
    ['Experience with Python 3\n250 words maximum', 250, 'words', '250 words maximum'],
    // A carriage return alone ends that line as a line feed does.
    ['Experience with Python 3\r250 words maximum', 250, 'words', '250 words maximum'],
  ] as const)('reads %j as a limit of %i %s', (text, limit, unit, phrase) => {
    expect(statedLimits(text)).toEqual([{ limit, unit, phrase }])
  })

  it.each([
    'Max file size 5 MB',
    '2 pages maximum',
    // A minimum is not a limit.
    'minimum 100 words',
    // A range is left to the model: no check, and so no false alarm.
    'between 100 and 300 words',
    '500 employees',
    'Attach a PDF or DOCX',
    // A dot, a space of any width or an apostrophe between the thousands: the last group alone is
    // no limit, so none is read. Read anyway, a thin space would make a limit of 0, and the Swiss
    // "1'500" one of 500.
    '1.500 characters maximum',
    '1 500 characters maximum',
    '2\u00a0000 characters max',
    '2\u202f000 characters max',
    '2\u2009000 characters max',
    '2\u2007000 characters max',
    '2\u3000000 characters max',
    "1'500 characters maximum",
    '1\u2019500 characters maximum',
    // A step marker, not a counter: a counter on a blank form reads 0.
    '1 / 3',
    // Nor is a count with more on its line, as an upload's: a counter is a line of its own.
    '0 / 3 files uploaded',
    // A limit-last phrase ends with its line: a bound word on the next is another field's.
    'Describe your experience in 200 words\nMax file size: 10 MB',
    'Describe yourself in 3 words\nLimit: one per line',
  ])('finds no limit in %j', (text) => {
    expect(statedLimits(text)).toEqual([])
  })

  it('reads only the maximum where a minimum stands beside it', () => {
    // The bound word after the minimum's number opens the next limit; it closes nothing.
    expect(statedLimits('Minimum 100 words maximum 300 words')).toEqual([
      { limit: 300, unit: 'words', phrase: 'maximum 300 words' },
    ])
    expect(statedLimits('Min 50 characters\nMax 500 characters')).toEqual([
      { limit: 500, unit: 'chars', phrase: 'Max 500 characters' },
    ])
  })

  it('reads a counter that names no unit as the counter of the limit stating its number', () => {
    // Under a word limit it counts words: "0 / 250" is no second limit, of 250 characters.
    expect(statedLimits(WORD_LIMIT_WITH_COUNTER)).toEqual([
      { limit: 250, unit: 'words', phrase: '250 words maximum' },
    ])
    expect(statedLimits('Maximum 250 words\n0 / 250')).toEqual([
      { limit: 250, unit: 'words', phrase: 'Maximum 250 words' },
    ])
  })

  it('reads each limit once, in form order, in the words that first state it', () => {
    // "0 / 500" restates "Max 500 characters" and folds into it.
    expect(statedLimits(FORM)).toEqual([
      { limit: 500, unit: 'chars', phrase: 'Max 500 characters' },
      { limit: 250, unit: 'words', phrase: '250 words maximum' },
    ])
    // The same number in another unit is another limit, the same limit stated again is not, and a
    // counter that opens the text comes first though its shape is read last.
    const text = '0/1000 characters\nMax 500 characters\nMax 500 words\n500 words maximum'
    expect(statedLimits(text)).toEqual([
      { limit: 1000, unit: 'chars', phrase: '0/1000 characters' },
      { limit: 500, unit: 'chars', phrase: 'Max 500 characters' },
      { limit: 500, unit: 'words', phrase: 'Max 500 words' },
    ])
  })
})

describe('problemsWith — the fixture the A/B ran on', () => {
  it('finds nothing missing from the usual seven-question read', () => {
    expect(problemsWith(fullRead, pasted)).toEqual([])
  })

  it('names both dropped limits and the missing questions in the collapsed read', () => {
    expect(problemsWith(collapsedRead, pasted)).toEqual(COLLAPSED_PROBLEMS)
  })
})

describe('problemsWith — the question count', () => {
  const asking = (lines: number) => ({
    text: Array.from({ length: lines }, (_, i) => `Question ${i + 1}?`).join('\n'),
    images: [],
  })
  const reading = (n: number): FormParseOut => ({
    questions: fullRead.questions.slice(0, n),
    ...scope,
  })

  it.each([
    // Below three lines there is too little to go on.
    [2, 0, []],
    // Short means fewer than half, rounded up: ceil(3 / 2) is 2, and ceil(5 / 2) is 3.
    [3, 1, ['the form has 3 lines that end in a question mark, but only 1 question came back']],
    [3, 2, []],
    [5, 2, ['the form has 5 lines that end in a question mark, but only 2 questions came back']],
    [5, 3, []],
  ] as const)('with %i lines ending in "?" and a read of %i: %j', (lines, n, problems) => {
    expect(problemsWith(reading(n), asking(lines))).toEqual(problems)
  })

  it('counts a line marked "(required)" or "required" as a question, as one marked "*"', () => {
    const text = 'Where are you based? (required)\nWhen could you start? required\nWhy this role? *'
    expect(problemsWith(reading(1), { text, images: [] })).toEqual([
      'the form has 3 lines that end in a question mark, but only 1 question came back',
    ])
  })

  it('counts a line that ends in "?", not one with a question inside it', () => {
    // The first line holds a question, but "We hire in the UK." closes it, and only a line that
    // ends in "?" is counted.
    const text = [
      'Where are you based? We hire in the UK.',
      'Why this role?',
      'When could you start?',
      'What draws you here?',
    ].join('\n')
    expect(problemsWith(reading(1), { text, images: [] })).toEqual([
      'the form has 3 lines that end in a question mark, but only 1 question came back',
    ])
  })

  it('leaves out a data field phrased as a question, as Typeform-style forms phrase them', () => {
    // Seven lines end in "?", and five of them ask for a data field the prompt skips. Counted, they
    // made every correct read of this form short, and the second look added them as questions.
    const text = [
      "What's your name? *",
      "What's your email address? *",
      "What's your phone number?",
      "What's your LinkedIn URL?",
      'Upload your resume? *',
      'Why do you want to join our team? *',
      'Max 600 characters',
      'Which of our products would you most like to work on?',
    ].join('\n')
    const correct: FormParseOut = {
      questions: [
        {
          q: 'Why do you want to join our team?',
          constraints: { limit: 600, unit: 'chars', type: 'long-text', required: true },
        },
        {
          q: 'Which of our products would you most like to work on?',
          constraints: { type: 'short-text', required: false },
        },
      ],
      ...scope,
    }
    expect(problemsWith(correct, { text, images: [] })).toEqual([])
  })

  it('takes a data-field word only whole, in any case, accented or not', () => {
    // "rename", "curl" and "automobile" hold one inside another word and ask for no data field;
    // "Résumé" asks for one, though its last letter is no ASCII word character.
    const text = [
      'Upload your Résumé?',
      'Have you led a product through a rename?',
      'How would you debug a slow curl call?',
      'Which automobile brands have you sold?',
    ].join('\n')
    expect(problemsWith(reading(1), { text, images: [] })).toEqual([
      'the form has 3 lines that end in a question mark, not counting 1 that names a data field, but only 1 question came back',
    ])
  })

  it.each([
    ['name', "What's your full name?"],
    ['email', "What's your email address?"],
    ['e-mail', "What's your e-mail address?"],
    ['phone', "What's your phone number?"],
    ['mobile', "What's your mobile number?"],
    ['LinkedIn', 'Where can we find you on LinkedIn?'],
    ['GitHub', "What's your GitHub handle?"],
    ['portfolio', 'Do you have a portfolio we can see?'],
    ['website', 'Do you have a personal website?'],
    ['URL', 'Which URL shows your best work?'],
    ['resume', 'Can you upload your resume?'],
    ['résumé', 'Can you upload your résumé?'],
    ['CV', 'Can you upload your CV?'],
  ])('leaves out a line that names %s', (_, line) => {
    // Three real questions and the one data-field line, which counted would make "4 lines".
    const text = [line, 'Why this role?', 'When could you start?', 'What draws you here?'].join('\n')
    expect(problemsWith(reading(1), { text, images: [] })).toEqual([
      'the form has 3 lines that end in a question mark, not counting 1 that names a data field, but only 1 question came back',
    ])
  })

  it('says how many lines it left out, so the number it gives is true of the form', () => {
    // Six lines end in "?", and two name a data field. Said bare, "4 lines" is a count the model
    // can hold against the form in front of it and find wrong. The email line comes right after
    // the name line, and "email" opens at offset 12, short of the 16 where "name" closed: a search
    // that took up where the last match stopped, as a regex with the g flag does, would miss it.
    const text = [
      "What's your name? *",
      "What's your email address? *",
      'Why this role?',
      'When could you start?',
      'What draws you here?',
      'Where are you based?',
    ].join('\n')
    expect(problemsWith(reading(1), { text, images: [] })).toEqual([
      'the form has 4 lines that end in a question mark, not counting 2 that name a data field, but only 1 question came back',
    ])
  })
})

describe('problemsWith — the unit', () => {
  const carrying = (limit: number, unit: 'chars' | 'words'): FormParseOut => ({
    questions: [
      {
        q: 'What draws you here?',
        constraints: { limit, unit, type: 'long-text', required: true },
      },
    ],
    ...scope,
  })
  const form = (text: string) => ({ text: `What draws you here? *\n${text}`, images: [] })

  it('holds a limit that names its unit to that unit', () => {
    expect(problemsWith(carrying(250, 'chars'), form('250 words maximum'))).toEqual([
      'the form states "250 words maximum", but no question carries a limit of 250 words',
    ])
  })

  it('holds a counter that names no unit to its number alone', () => {
    // It says how many, not of what. Under "Word limit: 250", a phrasing the guard does not read,
    // it counts words, and taken for characters it would flag every correct read of the form.
    expect(problemsWith(carrying(250, 'words'), form('Word limit: 250\n0 / 250'))).toEqual([])
    expect(problemsWith(carrying(250, 'chars'), form('Word limit: 250\n0 / 250'))).toEqual([])
    expect(problemsWith(carrying(500, 'chars'), form('0 / 1000'))).toEqual([
      'the form states "0 / 1000", but no question carries a limit of 1000',
    ])
  })
})

describe('statedLimits and problemsWith — a hostile paste', () => {
  it('read it in linear time', () => {
    // Both run on the server, over text anyone can paste, and a stalled regex stalls every request
    // the instance is serving. A pattern that backtracks takes most of a second over the number
    // below, read again from every comma in it, and seconds over each run of whitespace that two
    // quantifiers in a row can split; read in one pass, all of these together take milliseconds.
    const run = ' '.repeat(40_000)
    const digits = '9'.repeat(40_000)
    const hyphens = '-'.repeat(40_000)
    const started = performance.now()
    statedLimits(`max${run}x`)
    statedLimits(`500 words max${run}x`)
    statedLimits(`1${',000'.repeat(10_000)} x`)
    // Every other run a quantifier here can take: colons after the bound word, a long number in
    // each of the three shapes, hyphens on either side of the unit, the space in "or fewer", and a
    // counter's own spaces.
    statedLimits(`max${':'.repeat(40_000)}x`)
    statedLimits(`max ${digits}x`)
    statedLimits(`${digits} x`)
    statedLimits(`0 /${run}${digits}${run}x`)
    statedLimits(`max 5${hyphens}x`)
    statedLimits(`5${hyphens}x`)
    statedLimits(`5 words or${run}x`)
    problemsWith(collapsedRead, { text: `a${run}b`, images: [] })
    // A long line that does end in "?", once its required mark is off: the only kind of line the
    // data-field words are looked for in.
    problemsWith(collapsedRead, { text: `Why?${run}required`, images: [] })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('runFormParse — the completeness guard', () => {
  it('asks once more with what the first read missed, and returns the second read', async () => {
    const generate = returning(collapsedRead, fullRead)
    await expect(runFormParse(pasted, generate)).resolves.toEqual(fullRead)
    expect(generate).toHaveBeenCalledTimes(2)

    const [first, second] = [sent(generate, 0), sent(generate, 1)]
    expect(second.system).toBe(first.system)
    expect(second.output).toEqual({ schema: FormParseOutSchema })
    expect(second.config).toEqual({ thinkingConfig: { thinkingLevel: 'MEDIUM' } })
    // The original form, untouched, and the correction after it.
    expect(second.prompt.slice(0, -1)).toEqual(first.prompt)
    const correction = textOf(second.prompt.at(-1))
    expect(correction).toContain(
      '- "Why do you want to work at Marram Systems?": long-text, no limit, required',
    )
    for (const problem of COLLAPSED_PROBLEMS) expect(correction).toContain(`- ${problem}`)
    // A list of what was missed is no leave to add the fields the prompt skips.
    expect(correction.split('\n').at(-2)).toBe(
      'The rules have not changed: pure data fields (name, email, phone, links, uploads) are still skipped, and a line is not a field just because it ends in a question mark.',
    )
    expect(correction.split('\n').at(-1)).toBe(
      'Read the whole form again and return every answerable field with the constraints the form states. Return the full structured output.',
    )
  })

  it('asks once more when the first read misses one thing only', async () => {
    // Every question back, but the 500-character limit dropped: one problem is reason enough.
    const dropped: FormParseOut = {
      questions: fullRead.questions.map((q, i) =>
        i === 0 ? { ...q, constraints: { type: 'long-text', required: true } } : q,
      ),
      ...scope,
    }
    const generate = returning(dropped, fullRead)
    await expect(runFormParse(pasted, generate)).resolves.toEqual(fullRead)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(textOf(sent(generate, 1).prompt.at(-1))).toContain(
      '- the form states "Max 500 characters", but no question carries a limit of 500 characters',
    )
  })

  it('keeps the first read when the second is no better, and does not throw', async () => {
    // Two questions and still neither limit: three problems again, so not an improvement.
    const noBetter: FormParseOut = {
      questions: [collapsedRead.questions[0], fullRead.questions[5]],
      ...scope,
    }
    const generate = returning(collapsedRead, noBetter)
    await expect(runFormParse(pasted, generate)).resolves.toEqual(collapsedRead)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('takes a second read with fewer problems even when it still misses something', async () => {
    // Every question back, but the 250-word limit dropped: one problem against three.
    const better: FormParseOut = {
      questions: fullRead.questions.map((q, i) =>
        i === 1 ? { ...q, constraints: { type: 'long-text', required: true } } : q,
      ),
      ...scope,
    }
    const generate = returning(collapsedRead, better)
    await expect(runFormParse(pasted, generate)).resolves.toEqual(better)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('keeps the first read when the second look cannot be had', async () => {
    const generate = vi.fn<GenerateCall>()
    generate.mockImplementationOnce(() => Promise.resolve({ output: collapsedRead }))
    generate.mockImplementation(() => Promise.reject(new Error('503 Service Unavailable')))
    await expect(runFormParse(pasted, generate)).resolves.toEqual(collapsedRead)
    // The first read, then the second look and the one retry generateStructured gives it.
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('asks once when the first read covers the form', async () => {
    const generate = returning(fullRead)
    await expect(runFormParse(pasted, generate)).resolves.toEqual(fullRead)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it.each([
    WORD_LIMIT_WITH_COUNTER,
    // The word limit in a phrasing the guard does not read, so the counter alone states it.
    'What draws you here? *\nWord limit: 250\n0 / 250',
  ])('asks once when a word limit has a counter under it that names no unit: %j', async (text) => {
    // Were the counter read as a limit of 250 characters, every correct read of this form would
    // miss it, and the correction would ask for a limit the form never states.
    const read: FormParseOut = {
      questions: [
        {
          q: 'What draws you here?',
          constraints: { limit: 250, unit: 'words', type: 'long-text', required: true },
        },
      ],
      ...scope,
    }
    const generate = returning(read)
    await expect(runFormParse({ text, images: [] }, generate)).resolves.toEqual(read)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('asks once for screenshots alone: with no text there is nothing to check the read against', async () => {
    const generate = returning(collapsedRead)
    await expect(
      runFormParse({ images: [{ base64: 'c2hvdA==', mime: 'image/png' }] }, generate),
    ).resolves.toEqual(collapsedRead)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

// The correction grows with the paste: a line per distinct limit it states, quoting the phrase, and
// a line per question the first read returned. Spelled out whole, the 50,000 counters below, a
// 488 KB paste, made a 3.6 MB correction, and the 2,000-question read below 2.4 MB. With every line
// cut to 300 characters and each list to a fixed length, the correction stays under 20,000
// characters however much the paste states.
describe('runFormParse — the correction, on a hostile paste', () => {
  const CORRECTION_CHARS = 20_000
  const correctionSent = (generate: { mock: { calls: unknown[][] } }) =>
    textOf(sent(generate, 1).prompt.at(-1))

  it('lists ten of the problems and how many more, and still counts them all', async () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `0 / ${i + 1}`).join('\n')
    const read = (constraints: FormParseOut['questions'][number]['constraints']): FormParseOut => ({
      questions: [{ q: 'Why do you want to work at Marram Systems?', constraints }],
      ...scope,
    })
    const first = read({ type: 'long-text', required: true })
    // Carries the counter "0 / 1", and so misses one fewer of the 50,000.
    const second = read({ limit: 1, type: 'long-text', required: true })
    expect(problemsWith(first, { text, images: [] })).toHaveLength(50_000)

    const generate = returning(first, second)
    // Kept on the full count, 49,999 against 50,000: capped at ten, it would be ten against ten.
    await expect(runFormParse({ text, images: [] }, generate)).resolves.toEqual(second)
    expect(generate).toHaveBeenCalledTimes(2)

    const correction = correctionSent(generate)
    expect(correction.length).toBeLessThan(CORRECTION_CHARS)
    const missed = correction.split('\n').filter((line) => line.startsWith('- the form states'))
    expect(missed).toHaveLength(10)
    expect(missed[0]).toBe('- the form states "0 / 1", but no question carries a limit of 1')
    expect(missed[9]).toBe('- the form states "0 / 10", but no question carries a limit of 10')
    expect(correction).toContain('\n- … and 49990 more\n')
  })

  it('spells out a list that stops at its cap whole, with no line counting more', async () => {
    // Ten distinct counters, and a read of fifty questions that carries none of them.
    const text = Array.from({ length: 10 }, (_, i) => `0 / ${i + 1}`).join('\n')
    const read: FormParseOut = {
      questions: Array.from({ length: 50 }, (_, i) => ({
        q: `Question ${i + 1}`,
        constraints: { type: 'short-text', required: false },
      })),
      ...scope,
    }
    expect(problemsWith(read, { text, images: [] })).toHaveLength(10)

    const generate = returning(read, read)
    await expect(runFormParse({ text, images: [] }, generate)).resolves.toEqual(read)
    expect(generate).toHaveBeenCalledTimes(2)

    const lines = correctionSent(generate).split('\n')
    expect(lines.filter((line) => line.startsWith('- "Question '))).toHaveLength(50)
    expect(lines.filter((line) => line.startsWith('- the form states'))).toHaveLength(10)
    expect(lines.filter((line) => line.startsWith('- … and'))).toEqual([])
  })

  it('cuts every line to 300 characters, keeping both ends, and echoes fifty questions', async () => {
    // One phrase as long as the paste, and a read of 2,000 questions as long as a page each.
    const text = `max${':'.repeat(100_000)}500 characters`
    const flooded: FormParseOut = {
      questions: Array.from({ length: 2_000 }, (_, i) => ({
        q: `Question ${i + 1}: ${'describe a backend system you designed '.repeat(30)}?`,
        constraints: { type: 'long-text', required: true },
      })),
      ...scope,
    }
    const generate = returning(flooded, flooded)
    await expect(runFormParse({ text, images: [] }, generate)).resolves.toEqual(flooded)
    expect(generate).toHaveBeenCalledTimes(2)

    const correction = correctionSent(generate)
    expect(correction.length).toBeLessThan(CORRECTION_CHARS)
    const lines = correction.split('\n')
    expect(lines.filter((line) => line.length > 300)).toEqual([])
    // Each question cut from its middle, its constraints still at its end, and then the rest counted.
    const returned = lines.filter((line) => line.startsWith('- "Question '))
    expect(returned).toHaveLength(50)
    for (const line of returned) {
      expect(line).toMatch(/^- "Question \d+: describe .* … .*designed \?": long-text, no limit, required$/)
    }
    expect(lines).toContain('- … and 1950 more')
    // The phrase cut from its middle: how it opens, and the limit no question carries.
    expect(lines.filter((line) => line.startsWith('- the form states'))).toEqual([
      expect.stringMatching(
        /^- the form states "max:+ … :+500 characters", but no question carries a limit of 500 characters$/,
      ),
    ])
  })

  it('never sends half a character where it cuts a line', async () => {
    // Out of step by one at each end, so wherever a cut falls it splits a pair in one of the two.
    const read: FormParseOut = {
      questions: [
        { q: '🙂'.repeat(600), constraints: { type: 'long-text', required: true } },
        { q: `x${'🙂'.repeat(600)}x`, constraints: { type: 'long-text', required: true } },
      ],
      ...scope,
    }
    const generate = returning(read, read)
    await runFormParse({ text: 'Max 500 characters', images: [] }, generate)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(correctionSent(generate).isWellFormed()).toBe(true)
  })
})
