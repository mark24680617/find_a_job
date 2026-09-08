import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Application, Question } from '@/lib/types'
import { LETTERHEAD_FIELD_MAX, newCoverLetter } from '@/lib/letter/letterhead'
import { MAX_LETTER_CHARS } from '@/lib/letter/layout'

// The handler with Firestore and the renderer faked: no Admin SDK, no pdf-lib. What is under
// test is the export contract — which requests are refused and in what words, what the renderer
// is handed, and the headers a browser needs to save the file. The renderer itself is proved
// against real bytes in `letter.pdf.test.ts`.

const { requireUser, getApplication } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getApplication: vi.fn(),
}))
const { renderLetterPdf } = vi.hoisted(() => ({ renderLetterPdf: vi.fn() }))

vi.mock('@/lib/auth', () => ({ requireUser }))
vi.mock('@/lib/db', () => ({ getApplication }))
// The error class is the real one: the route branches on `instanceof`, and a stand-in would let
// a route that never matched it pass this file while answering 500 in production.
vi.mock('@/lib/letter/pdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/letter/pdf')>()),
  renderLetterPdf,
}))

import { GET } from '@/app/api/applications/[id]/cover-letter/pdf/route'
import { LetterRenderError } from '@/lib/letter/pdf'

const FINAL = 'Dear Dana Wu,\n\nI built a ledger.\n\nSincerely,\n\nTom Candidate'

const letterQuestion = (over: Partial<Question> = {}): Question => {
  const q = newCoverLetter('Tom Candidate', 'tom@x.test')
  return { ...q, letter: { ...q.letter!, recipient: 'Dana Wu' }, final: FINAL, status: 'final', ...over }
}

const formQuestion = (): Question => ({
  q: 'Where are you based?',
  constraints: { type: 'short-text', required: false },
  askHuman: [],
  status: 'pending',
})

const application = (over: Partial<Application> = {}): Application => ({
  id: 'app-1',
  company: 'Marram Systems',
  role: 'Senior Backend Engineer',
  jdRaw: 'Build a ledger.',
  adapter: 'ashby',
  questions: [formQuestion(), letterQuestion()],
  status: 'draft',
  timeline: [{ event: 'created', at: '2026-08-27T00:00:00.000Z' }],
  createdAt: '2026-08-27T00:00:00.000Z',
  ...over,
})

const bytes = new TextEncoder().encode('%PDF-1.7 pretend')

const req = (date = '2026-09-07') =>
  new Request(`https://example.test/api/applications/app-1/cover-letter/pdf?date=${date}`)

const bare = () => new Request('https://example.test/api/applications/app-1/cover-letter/pdf')

const ctx = (id = 'app-1') => ({ params: Promise.resolve({ id }) })

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error

beforeEach(() => {
  vi.resetAllMocks()
  requireUser.mockResolvedValue({ uid: 'user-1' })
  getApplication.mockResolvedValue(application())
  renderLetterPdf.mockResolvedValue(bytes)
})

describe('GET .../cover-letter/pdf — what it refuses', () => {
  it('401s before reading the record or rendering anything', async () => {
    requireUser.mockResolvedValue(new Response('{"error":"unauthenticated"}', { status: 401 }))
    expect((await GET(req(), ctx())).status).toBe(401)
    expect(getApplication).not.toHaveBeenCalled()
    expect(renderLetterPdf).not.toHaveBeenCalled()
  })

  it('400s a date that is well shaped but is not a day that exists', async () => {
    const res = await GET(req('2026-02-31'), ctx())
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('date must be a real YYYY-MM-DD')
    expect(getApplication).not.toHaveBeenCalled()
  })

  it('400s a missing date, and every other shape that is not one', async () => {
    for (const url of [bare(), req(''), req('7 September 2026'), req('2026-9-7')]) {
      const res = await GET(url, ctx())
      expect(res.status).toBe(400)
      expect(await errorOf(res)).toBe('date must be a real YYYY-MM-DD')
    }
    expect(renderLetterPdf).not.toHaveBeenCalled()
  })

  it('404s an application that is not there — or is not the caller’s', async () => {
    getApplication.mockResolvedValue(null)
    const res = await GET(req(), ctx('nope'))
    expect(res.status).toBe(404)
    expect(getApplication).toHaveBeenCalledWith('user-1', 'nope')
    expect(renderLetterPdf).not.toHaveBeenCalled()
  })

  it('404s an application whose questions hold no cover letter', async () => {
    getApplication.mockResolvedValue(application({ questions: [formQuestion()] }))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(404)
    expect(await errorOf(res)).toBe('no cover letter on this application')
  })

  it('400s a letter nobody has saved yet, and one saved as whitespace', async () => {
    for (const final of [undefined, '', '   \n  ']) {
      getApplication.mockResolvedValue(application({ questions: [letterQuestion({ final })] }))
      const res = await GET(req(), ctx())
      expect(res.status).toBe(400)
      expect(await errorOf(res)).toBe('save the letter before exporting it')
    }
    expect(renderLetterPdf).not.toHaveBeenCalled()
  })

  it('400s a final the record holds as something other than text', async () => {
    // The application PATCH validates only that its body is an object, so the record's own owner
    // can leave a number where the letter goes. Every other refusal here is a sentence the pane
    // can show, and this one is too rather than a TypeError and a 500.
    for (const final of [42, {}, ['Dear Dana Wu,']]) {
      getApplication.mockResolvedValue(application({ questions: [letterQuestion({ final: final as never })] }))
      const res = await GET(req(), ctx())
      expect(res.status).toBe(400)
      expect(await errorOf(res)).toBe('save the letter before exporting it')
    }
    expect(renderLetterPdf).not.toHaveBeenCalled()
  })

  it('422s a final past the character cap the finalize route never applied', async () => {
    const huge = 'a'.repeat(MAX_LETTER_CHARS + 1)
    getApplication.mockResolvedValue(application({ questions: [letterQuestion({ final: huge })] }))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(422)
    expect(await errorOf(res)).toBe('the letter is too long to set')
    expect(renderLetterPdf).not.toHaveBeenCalled()
  })
})

describe('GET .../cover-letter/pdf — when the renderer refuses', () => {
  it('422s a character the font cannot set, counting them and carrying them through', async () => {
    const unsupported = [{ char: '邱', where: 'in your name' }, { char: 'Ω', where: 'in “Ω is not in WinAnsi.”' }]
    renderLetterPdf.mockRejectedValue(new LetterRenderError('the font cannot set every character', { unsupported, total: 2 }))

    const res = await GET(req(), ctx())
    expect(res.status).toBe(422)
    expect(await res.clone().json()).toEqual({
      error: 'The PDF font can’t set 2 characters — use a Latin spelling, or copy the letter as text.',
      unsupported,
      total: 2,
    })
  })

  it('says one character rather than 1 characters', async () => {
    renderLetterPdf.mockRejectedValue(
      new LetterRenderError('the font cannot set every character', { unsupported: [{ char: '邱', where: 'in your name' }], total: 1 }),
    )
    const res = await GET(req(), ctx())
    expect(await errorOf(res)).toBe('The PDF font can’t set 1 character — use a Latin spelling, or copy the letter as text.')
  })

  it('counts every character the renderer found while carrying only the few it named', async () => {
    // A letter written in Chinese carries several hundred distinct characters. The renderer names
    // a handful of them; the sentence still says how many there are, so the body stays a body and
    // the person is not read several hundred near-identical sentences.
    const unsupported = [{ char: '邱', where: 'in your name' }]
    renderLetterPdf.mockRejectedValue(new LetterRenderError('the font cannot set every character', { unsupported, total: 214 }))

    const res = await GET(req(), ctx())
    expect(await res.clone().json()).toEqual({
      error: 'The PDF font can’t set 214 characters — use a Latin spelling, or copy the letter as text.',
      unsupported,
      total: 214,
    })
  })

  it('422s a letter that ran past the page count, naming it', async () => {
    renderLetterPdf.mockRejectedValue(new LetterRenderError('the letter is too long', { pages: 4 }))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(422)
    expect(await errorOf(res)).toBe('The letter runs to 4 pages — cut it to one before exporting.')
  })

  it('lets a failure that is not the renderer’s judgment go up as a 500', async () => {
    renderLetterPdf.mockRejectedValue(new Error('pdf-lib fell over'))
    await expect(GET(req(), ctx())).rejects.toThrow('pdf-lib fell over')
  })
})

describe('GET .../cover-letter/pdf — the file', () => {
  it('answers with the bytes the renderer returned, as an attachment nothing caches', async () => {
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="cover-letter.pdf"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('renders the SAVED letter, the saved letterhead read back safe, and the client’s date', async () => {
    await GET(req('2026-09-07'), ctx())
    expect(renderLetterPdf).toHaveBeenCalledWith({
      letter: {
        name: 'Tom Candidate',
        email: 'tom@x.test',
        phone: '',
        location: '',
        recipient: 'Dana Wu',
        recipientTitle: '',
        companyAddress: '',
      },
      company: 'Marram Systems',
      text: FINAL,
      dateIso: '2026-09-07',
    })
  })

  it('reads a letterhead the record holds in any shape at all, rather than trusting it', async () => {
    // The application PATCH validates only that its body is an object, so the stored letterhead
    // can be anything a client sent. It is made safe on the way out, here as everywhere.
    const rough = { name: '  Tom Candidate\r\n', recipient: 7, extra: 'not a field' }
    getApplication.mockResolvedValue(
      application({ questions: [letterQuestion({ letter: rough as never })] }),
    )

    await GET(req(), ctx())
    expect(renderLetterPdf.mock.calls[0][0].letter).toEqual({
      name: 'Tom Candidate',
      email: '',
      phone: '',
      location: '',
      recipient: '',
      recipientTitle: '',
      companyAddress: '',
    })
  })

  it('hands the typesetter a company name that is text, and no more of it than a line', async () => {
    // The same PATCH that can leave a number where the letter goes can leave one where the
    // company does, and the company is the one value on the page that never passes through
    // `readLetterhead`. A 2 MB name would otherwise be measured and wrapped before the page
    // count refused it.
    getApplication.mockResolvedValue(application({ company: 42 as never }))
    await GET(req(), ctx())
    expect(renderLetterPdf.mock.calls[0][0].company).toBe('')

    renderLetterPdf.mockClear()
    getApplication.mockResolvedValue(application({ company: 'M'.repeat(LETTERHEAD_FIELD_MAX + 50) }))
    await GET(req(), ctx())
    expect(renderLetterPdf.mock.calls[0][0].company).toHaveLength(LETTERHEAD_FIELD_MAX)
  })

  it('finds the letter by its kind, wherever the form’s questions left it', async () => {
    const letter = letterQuestion({ final: 'Dear Hiring Manager,\n\nSincerely,' })
    getApplication.mockResolvedValue(
      application({ questions: [formQuestion(), formQuestion(), letter, formQuestion()] }),
    )

    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    expect(renderLetterPdf.mock.calls[0][0].text).toBe('Dear Hiring Manager,\n\nSincerely,')
  })
})
