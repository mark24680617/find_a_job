import { describe, it, expect, vi } from 'vitest'
import { runAnswerDraft } from '@/ai/flows/answerDraft'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { type AnswerDraftOut } from '@/ai/schemas'
import { LETTER_WORD_CEILING, newCoverLetter } from '@/lib/letter/letterhead'
import type { Fact, ParsedJob, Question } from '@/lib/types'

// The same injected-generate shape `tests/answerDraft.guard.test.ts` uses, on the three checks a
// letter adds. A letter is the one draft in this product a person signs their name to and sends
// as a document, so the two things a reader sees first — who it is addressed to and who signed
// it — are enforced in code rather than asked for once in a prompt.

const facts: Fact[] = [
  { id: 'f1', claim: 'Owns a payments service handling 12,000 requests/day', sourceSnippet: '', tags: ['payments'] },
]

const parsed: ParsedJob = {
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  roleFacts: [],
  gates: [],
  themes: ['payments'],
  scope: 'per-application',
  advisory: '',
}

const formQuestion: Question = {
  q: 'Describe a backend system you designed end to end.',
  constraints: { type: 'long-text', required: true },
  askHuman: [],
  status: 'pending',
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

/** A whole letter: the salutation, a body of `n` words, the close and the signature. */
const letter = (n: number, open = 'Dear Dana Wu,', close = 'Sincerely,\n\nTom Candidate') =>
  `${open}\n\n${words(n)}\n\n${close}`

const input = (over: Partial<Parameters<typeof runAnswerDraft>[0]> = {}) => ({
  question: newCoverLetter('Tom Candidate', 'tom@x.test'),
  parsed,
  jdText: 'Own the ledger and settlement services.',
  today: '2026-09-14',
  facts,
  standardAnswers: {},
  voiceRules: [],
  humanAnswers: [],
  clarifyAnswers: [],
  letter: { name: 'Tom Candidate', recipient: 'Dana Wu', recipientTitle: 'Head of Engineering' },
  ...over,
})

const draft = (over: Partial<AnswerDraftOut> = {}): AnswerDraftOut => ({
  text: letter(120),
  citations: [],
  askHuman: [],
  ...over,
})

const returning = (...outputs: AnswerDraftOut[]) => {
  const generate = vi.fn<GenerateCall>()
  for (const output of outputs) generate.mockImplementationOnce(() => Promise.resolve({ output }))
  generate.mockImplementation(() => Promise.reject(new Error('unexpected extra model call')))
  return generate
}

interface SentRequest {
  system?: string
  prompt: { text?: string }[]
  config: { temperature: number; thinkingConfig: { thinkingLevel: string } }
}
const sent = (generate: ReturnType<typeof returning>, n: number) =>
  generate.mock.calls[n][0] as unknown as SentRequest

const correction = (generate: ReturnType<typeof returning>) => {
  const prompt = sent(generate, 1).prompt
  return prompt[prompt.length - 1].text ?? ''
}

describe('runAnswerDraft — a cover letter', () => {
  it('thinks at MEDIUM on it, as a form answer does', async () => {
    // Provisional: the letter keeps its own level, pending a MEDIUM-vs-HIGH letter test.
    const generate = returning(draft())
    await runAnswerDraft(input(), generate)
    expect(sent(generate, 0).config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' })
    expect(sent(generate, 0).system).toContain('You draft one cover letter')

    const form = returning(draft({ text: 'A backend system I designed.' }))
    await runAnswerDraft(input({ question: formQuestion, letter: undefined }), form)
    expect(sent(form, 0).config.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' })
  })

  it('puts the date it was given in front of the model', async () => {
    const generate = returning(draft())
    await runAnswerDraft(input({ today: '2031-02-03' }), generate)
    expect(sent(generate, 0).prompt.map((p) => p.text ?? '').join('\n')).toContain("Today's date: 2031-02-03.")
  })

  it('returns a letter that opens, closes and fits, without a second call', async () => {
    const out = draft()
    const generate = returning(out)
    await expect(runAnswerDraft(input(), generate)).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('corrects a letter over the ceiling, naming the count, and takes the one that fits', async () => {
    const over = draft({ text: letter(LETTER_WORD_CEILING) })
    const within = draft({ text: letter(200) })
    const generate = returning(over, within)

    await expect(runAnswerDraft(input(), generate)).resolves.toEqual(within)
    expect(correction(generate)).toContain(`words against a ceiling of ${LETTER_WORD_CEILING}`)
  })

  it('corrects a letter that greets a hiring manager when the recipient was named', async () => {
    // The one mistake this document cannot survive: a salutation to somebody the candidate
    // never named, or a stranger's name where a person's is.
    const wrong = draft({ text: letter(120, 'Dear Hiring Manager,') })
    const right = draft({ text: letter(120) })
    const generate = returning(wrong, right)

    await expect(runAnswerDraft(input(), generate)).resolves.toEqual(right)
    expect(correction(generate)).toContain('the letter must open with "Dear Dana Wu,"')
  })

  it('judges a letter drafted before a letterhead was typed against a blank one', async () => {
    // Nothing makes the person save the letterhead before asking for a draft, so the flow can be
    // handed a cover letter with no letterhead at all. A blank one names nobody and signs nobody:
    // "Dear Hiring Manager," above an unsigned close is then the correct letter, and a name the
    // candidate never gave is still refused.
    const generate = returning(draft({ text: letter(120, 'Dear Hiring Manager,', 'Sincerely,') }))
    await runAnswerDraft(input({ letter: undefined }), generate)
    expect(generate).toHaveBeenCalledTimes(1)

    const invented = returning(
      draft({ text: letter(120) }),
      draft({ text: letter(120, 'Dear Hiring Manager,', 'Sincerely,') }),
    )
    await runAnswerDraft(input({ letter: undefined }), invented)
    expect(invented).toHaveBeenCalledTimes(2)
    expect(correction(invented)).toContain('the letter must open with "Dear Hiring Manager,"')
  })

  it('corrects a letter that ends without the name it was given to sign', async () => {
    const unsigned = draft({ text: letter(120, 'Dear Dana Wu,', 'Sincerely,') })
    const signed = draft({ text: letter(120) })
    const generate = returning(unsigned, signed)

    await expect(runAnswerDraft(input(), generate)).resolves.toEqual(signed)
    expect(correction(generate)).toContain("the candidate's name as given")
  })

  it('throws rather than returning a letter still wrong after the correction', async () => {
    const wrong = draft({ text: letter(120, 'Hello,') })
    const generate = returning(wrong, wrong)
    const promise = runAnswerDraft(input(), generate)

    await expect(promise).rejects.toBeInstanceOf(FlowOutputError)
    await expect(promise).rejects.toThrow(/the letter must open with "Dear Dana Wu,"/)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('never puts a form answer through the letter’s checks', async () => {
    // A hundred-word answer has no salutation and no signature, and 400 words is not its
    // ceiling — the stated limit is, and this question has none.
    const out = draft({ text: words(500) })
    const generate = returning(out)
    await expect(
      runAnswerDraft(input({ question: formQuestion, letter: undefined }), generate),
    ).resolves.toEqual(out)
    expect(generate).toHaveBeenCalledTimes(1)
  })
})
