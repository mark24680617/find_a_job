import { describe, it, expect } from 'vitest'
import { letterProblems } from '@/lib/letter/guard'
import { LETTER_WORD_CEILING } from '@/lib/letter/letterhead'

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const letter = (body: string, close = 'Sincerely,\n\nTom Candidate', open = 'Dear Hiring Manager,') => `${open}\n\n${body}\n\n${close}`

describe('letterProblems', () => {
  it('passes a letter that opens, closes and fits', () => {
    expect(letterProblems(letter(words(250)), { name: 'Tom Candidate', recipient: '' })).toEqual([])
  })
  it('counts the whole text against the ceiling', () => {
    const [problem] = letterProblems(letter(words(LETTER_WORD_CEILING)), { name: 'Tom Candidate', recipient: '' })
    expect(problem).toBe(`over one page: ${LETTER_WORD_CEILING + 6} words against a ceiling of ${LETTER_WORD_CEILING} for the whole letter`)
  })
  it('wants the salutation the letterhead named', () => {
    expect(letterProblems(letter(words(20)), { name: 'Tom Candidate', recipient: 'Dana Wu' })).toEqual([
      'the letter must open with "Dear Dana Wu," as instructed (it opened with "Dear Hiring Manager,")',
    ])
    expect(letterProblems(letter(words(20), undefined, 'Dear Dana Wu,'), { name: 'Tom Candidate', recipient: 'Dana Wu' })).toEqual([])
    expect(letterProblems(letter(words(20), undefined, 'Hello,'), { name: 'Tom Candidate', recipient: '' })).toEqual([
      'the letter must open with "Dear Hiring Manager," as instructed (it opened with "Hello,")',
    ])
  })
  it('wants the close and the name as given, and accepts no name', () => {
    expect(letterProblems(letter(words(20), 'Best,\n\nTom Candidate'), { name: 'Tom Candidate', recipient: '' })).toEqual([
      'the letter must close with "Sincerely," and the candidate\'s name as given',
    ])
    expect(letterProblems(letter(words(20), 'Sincerely,\n\nSomeone Else'), { name: 'Tom Candidate', recipient: '' })).toHaveLength(1)
    expect(letterProblems(letter(words(20), 'Sincerely,'), { name: '', recipient: '' })).toEqual([])
  })
  it('is silent for a question that is not a letter', () => {
    expect(letterProblems('anything', undefined)).toEqual([])
  })
})
