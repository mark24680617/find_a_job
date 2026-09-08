import { describe, it, expect } from 'vitest'
import {
  asksForStory, blankLetterhead, isCoverLetter, LETTER_Q, LETTERHEAD_FIELD_MAX, letterFileName,
  needsStoryAsk, newCoverLetter, readLetterhead, STORY_ASK, todayIso,
} from '@/lib/letter/letterhead'
import type { AskHuman } from '@/lib/types'

describe('newCoverLetter', () => {
  it('is a pending long-text question of the cover-letter kind with no limit and a letterhead', () => {
    const q = newCoverLetter('Tom Candidate', 'tom@example.test')
    expect(q).toEqual({
      q: LETTER_Q, kind: 'cover-letter',
      constraints: { type: 'long-text', required: false },
      askHuman: [], status: 'pending',
      letter: { name: 'Tom Candidate', email: 'tom@example.test', phone: '', location: '', recipient: '', recipientTitle: '', companyAddress: '' },
    })
    expect(isCoverLetter(q)).toBe(true)
    expect(isCoverLetter({ kind: undefined })).toBe(false)
    expect(blankLetterhead()).toEqual(q.letter && { ...q.letter, name: '', email: '' })
  })
})

describe('readLetterhead', () => {
  it('reads what is there and blanks what is not', () => {
    expect(readLetterhead(undefined)).toEqual(blankLetterhead())
    expect(readLetterhead({ name: 42, email: null, recipient: 'Dana Wu' })).toEqual({ ...blankLetterhead(), recipient: 'Dana Wu' })
  })
  it('trims, normalises line ends, strips controls and cuts at the cap', () => {
    const long = 'x'.repeat(LETTERHEAD_FIELD_MAX + 5)
    const read = readLetterhead({ companyAddress: ' 1 Main St\r\nSeattle, WA \u0007', name: long })
    expect(read.companyAddress).toBe('1 Main St\nSeattle, WA')
    expect(read.name).toHaveLength(LETTERHEAD_FIELD_MAX)
  })
  it('folds a newline into a space in every field but the address block', () => {
    // The address block is the one value the layout breaks into its own lines. A newline left in
    // any of the other six reaches the prompt as `Addressed to: Dana\nWu` and the guard as a
    // required opening of `Dear Dana\nWu,`, which no letter the model returns will ever start
    // with — two model calls and a 422 the person cannot act on, every attempt.
    const read = readLetterhead({ name: 'Tom\nCandidate', recipient: 'Dana\r\nWu', companyAddress: '1 Main St\nSeattle, WA' })
    expect(read.name).toBe('Tom Candidate')
    expect(read.recipient).toBe('Dana Wu')
    expect(read.companyAddress).toBe('1 Main St\nSeattle, WA')
  })
  it('cuts by code point, so the cap never leaves half a character behind', () => {
    const read = readLetterhead({ name: `${'x'.repeat(LETTERHEAD_FIELD_MAX - 1)}\u{1F600}y` })
    expect(read.name.endsWith('\u{1F600}')).toBe(true)
    expect(Array.from(read.name)).toHaveLength(LETTERHEAD_FIELD_MAX)
  })
})

describe('letterFileName', () => {
  it('is the name and the company, ASCII, hyphenated', () => {
    expect(letterFileName('Tom Candidate', 'Marram Systems')).toBe('Tom-Candidate-Cover-Letter-Marram-Systems.pdf')
    expect(letterFileName('Zoë O’Brien', 'Söderberg & Co.')).toBe('Zoe-OBrien-Cover-Letter-Soderberg-Co.pdf')
  })
  it('keeps a hyphenated name in two parts rather than closing it up', () => {
    expect(letterFileName('Jean-Luc Picard', 'Marram Systems')).toBe('Jean-Luc-Picard-Cover-Letter-Marram-Systems.pdf')
  })
  it('drops a part that leaves nothing, and the whole name when there is none', () => {
    expect(letterFileName('', 'Marram Systems')).toBe('Cover-Letter-Marram-Systems.pdf')
    expect(letterFileName('邱明', '')).toBe('Cover-Letter.pdf')
  })
})

describe('asksForStory', () => {
  it('is true for the ask’s own wording', () => {
    expect(asksForStory(STORY_ASK)).toBe(true)
    expect(asksForStory({ question: STORY_ASK.question.toUpperCase() })).toBe(true)
  })

  it('is true for the model asking the same thing in words of its own', () => {
    // The smoke's run 1, verbatim: the ask the product owes, phrased by the model.
    expect(asksForStory({
      question: 'What specific incident or failure prompted the ledger batching project, and what were the broader architectural consequences?',
    })).toBe(true)
    expect(asksForStory({ question: 'Walk me through what led up to that migration.' })).toBe(true)
  })

  it('is false for the other questions a letter asks', () => {
    expect(asksForStory({ question: 'Why do you want to work at Marram Systems?' })).toBe(false)
    expect(asksForStory({ question: 'Do you need visa sponsorship for the UK?' })).toBe(false)
  })

  it('is false for the gap ask, which the letter’s rule 1 asks for in its own right', () => {
    // The wordings the phrase list gave up to keep: matched here, the story ask would be owed
    // and never appended for the life of the letter.
    expect(asksForStory({ question: 'What happened during the eight months between the two roles?' })).toBe(false)
    expect(asksForStory({ question: 'What is the story behind the pivot from platform work into payments?' })).toBe(false)
  })
})

describe('needsStoryAsk', () => {
  it('is true for a cover letter with no telling that nobody has asked for yet', () => {
    expect(needsStoryAsk({ kind: 'cover-letter' }, [])).toBe(true)
    expect(needsStoryAsk({ kind: 'cover-letter', story: '   ' }, [])).toBe(true)
    expect(needsStoryAsk({ kind: 'cover-letter' }, [{ question: 'Why this company?', why: 'no fact covers it' }])).toBe(true)
  })

  it('is false when the model already asked for the story in its own words', () => {
    const asked: AskHuman = {
      question: 'What specific incident or failure prompted the ledger batching project, and what were the broader architectural consequences?',
      why: 'The narrative needs the story behind your lead achievement.',
    }
    expect(needsStoryAsk({ kind: 'cover-letter' }, [asked])).toBe(false)
  })

  it('is false once the candidate has told the story', () => {
    expect(needsStoryAsk({ kind: 'cover-letter', story: 'The billing job double-charged 40 accounts.' }, [])).toBe(false)
  })

  it('is false when the ask is already in the queue, answered or not', () => {
    expect(needsStoryAsk({ kind: 'cover-letter' }, [STORY_ASK])).toBe(false)
    expect(needsStoryAsk({ kind: 'cover-letter' }, [{ ...STORY_ASK, answer: 'We batched the writes.' }])).toBe(false)
  })

  it('is false for a form question, whatever it carries', () => {
    expect(needsStoryAsk({ kind: undefined }, [])).toBe(false)
    expect(needsStoryAsk({ kind: undefined, story: '' }, [])).toBe(false)
  })
})

describe('todayIso', () => {
  it('is the local date, not the UTC one', () => {
    // 23:30 local on the 7th: toISOString would say the 8th in any zone east of UTC.
    expect(todayIso(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07')
    expect(todayIso(new Date(2026, 0, 3, 0, 5))).toBe('2026-01-03')
  })
})
