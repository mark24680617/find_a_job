import { countUnits } from '@/lib/countText'
import { LETTER_WORD_CEILING } from '@/lib/letter/letterhead'

/**
 * The three things a cover letter has to be that its schema cannot see: short enough to be one
 * page, opened as the letterhead says, and signed as the letterhead says. They are rules 6 and 7
 * of the letter's SYSTEM, asked for in the prompt and checked here — a model told to count its
 * own words is a model that sometimes counts them wrong, and a salutation to a name nobody gave
 * is the one mistake this document cannot survive.
 *
 * Each problem is phrased as a clause that works twice, exactly as the answer flow's own
 * problems are: appended to the prompt it names the fix, and shown to the person it explains the
 * refusal. `undefined` for the letterhead means this is not a cover letter at all, and there is
 * nothing here to check.
 */
export function letterProblems(
  text: string,
  letter: { name: string; recipient: string } | undefined,
): string[] {
  if (!letter) return []
  const problems: string[] = []

  // The whole text, salutation and sign-off included: the ceiling is what fits on the page, and
  // the page carries every word of it.
  const count = countUnits(text, 'words')
  if (count > LETTER_WORD_CEILING) {
    problems.push(
      `over one page: ${count} words against a ceiling of ${LETTER_WORD_CEILING} for the whole letter`,
    )
  }

  const recipient = letter.recipient.trim()
  const salutation = recipient ? `Dear ${recipient},` : 'Dear Hiring Manager,'
  const opened = text.trimStart().split('\n')[0]
  if (!text.trimStart().startsWith(salutation)) {
    problems.push(
      `the letter must open with ${JSON.stringify(salutation)} as instructed (it opened with ${JSON.stringify(opened)})`,
    )
  }

  // The name is checked at the end rather than anywhere in the text: a letter that mentions the
  // candidate's name in a sentence and then trails off unsigned is the failure this catches.
  const name = letter.name.trim()
  if (!text.includes('Sincerely,') || (name && !text.trimEnd().endsWith(name))) {
    problems.push(`the letter must close with "Sincerely," and the candidate's name as given`)
  }

  return problems
}
