import {
  FlowOutputError,
  generateStructured,
  type GenerateCall,
  type Part,
  type ThinkingLevel,
} from '@/ai/genkit'
import { buildFormParsePrompt, type FormParseInput } from '@/ai/prompts/formParse'
import { FormParseOutSchema, type FormParseOut } from '@/ai/schemas'

/**
 * Reading a form is mostly transcription — the questions are right there. The judgment is
 * narrow and local: which control this field is, and therefore how long the answer may be.
 * It is set to MEDIUM anyway, as a hedge on thin evidence: in the 2026-09-14 evaluation one run
 * with no thinking dropped the form's stated "Max 500 characters", and runs with no thinking kept
 * pure data fields as questions in 3 of 3, against 1 of 2 at MEDIUM. The screenshot form read the
 * same either way (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

/** A length limit the pasted text states outright, with the words it states it in. */
type StatedLimit = { limit: number; unit: 'chars' | 'words'; phrase: string }

/**
 * The three shapes of a stated length limit the guard reads. In each, group 1 is the number (500,
 * or 1,000 with its thousands comma) and group 2 the unit: char, chars, character or characters
 * read as "chars", word or words as "words". Nothing else is a unit, so "5 MB", "2 pages" and
 * "500 employees" never read as limits. A minimum is no limit, and a range ("between 100 and 300
 * words") carries no bound word these look for, so it is left to the model: no check, and no
 * false alarm either. So is every phrasing these do not read, such as "Character limit: 500",
 * "Word limit: 250", "Limit: 500 characters", "fewer than 200 words", "500 characters remaining",
 * a part-filled counter like "137 / 500", a number with a dot, whitespace of any width or an
 * apostrophe (' or ’) between its thousands, or a limit-last phrase wrapped onto a second line: it
 * goes unchecked, and fails safe. Not so a zero-width space or word joiner (U+200B, U+2060)
 * between the thousands, which is no whitespace: the last group still reads, as a limit of 0.
 *
 * They run on the server over text anyone can paste, so each reads in one pass: no two
 * quantifiers in a row can split the same whitespace between them, and a number takes at most two
 * thousands groups, so a long run of them is not read again from every comma.
 */
const LIMIT_PATTERNS = [
  // The bound first: "Max 500 characters", "maximum of 300 words", "up to 1,000 characters",
  // "no more than 200 words", "at most 150 words".
  /\b(?:max(?:imum)?\.?(?:\s+of)?|up\s+to|no\s+more\s+than|at\s+most)[\s:]*(\d{1,3}(?:,\d{3}){1,2}|\d+)[\s-]*(char(?:acter)?s?|words?)\b/gi,
  // The bound last, on one line: "250 words maximum", "500 character limit", "150-word limit",
  // "200 words or fewer", "(500 chars max)". A bound word with a number after it opens the next
  // limit, so in "Minimum 100 words maximum 300 words" the minimum is not read as one. The bound
  // word and that number are looked for on the limit's own line only, since a number on the next
  // line belongs to whatever stands there, often the next field: "in 200 words" over "Max file
  // size: 10 MB" is no limit, and "250 words maximum" over a "0 / 250" counter is still one. The
  // number is read whole or not at all: one that follows a dot or a comma, or a digit and then an
  // apostrophe (' or ’) or any whitespace but \n and \r, is the tail of a longer number ("1.500",
  // "2 000" with whitespace of any width, the Swiss "1'500"), and no limit of 500 or of 0. A space
  // or an apostrophe with no digit before it marks no tail, so "in 300 words or fewer" and "Answer
  // in '500 characters max'" still read, and neither does a digit that closes the line above, so
  // "Python 3" over "250 words maximum" still reads. The exception is a line that a U+2028 or
  // U+2029 separator ends: that is whitespace too, so the limit after it goes unread, and fails
  // safe.
  /(?<![.,]|\d[^\S\r\n]|\d['\u2019])\b(\d{1,3}(?:,\d{3}){1,2}|\d+)[ \t-]*(char(?:acter)?s?|words?)[ \t]*(?:max(?:imum)?|limit|or[ \t]+(?:less|fewer))\b(?![ \t:]*\d)/gi,
  // A counter on a line of its own: "0 / 500", "0/1000 characters". Only a count of 0 is read,
  // because a counter on a blank form starts there, and that keeps a step marker like "1 / 3" from
  // reading as a limit. A counter that names no unit says how many but not of what: it is listed
  // in characters, the likelier reading, but checked by its number alone (see problemsWith), and
  // it folds into a limit that names its unit and states the same number (see statedLimits).
  /^[ \t]*0[ \t]*\/[ \t]*(\d{1,3}(?:,\d{3}){1,2}|\d+)(?:[ \t]*(char(?:acter)?s?|words?))?[ \t]*\r?$/gim,
]

/**
 * The length limits the pasted text states outright, in the order the form states them, each
 * once: a counter under "Max 500 characters" restates that limit and is folded into it.
 */
export function statedLimits(text: string): StatedLimit[] {
  const matches = LIMIT_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)]).sort(
    (a, b) => a.index - b.index,
  )
  // A counter that names no unit leaves group 2 empty. Where a limit that names its unit states the
  // counter's number, the counter is that limit's: "0 / 250" under "250 words maximum" counts
  // words, and is no second limit of 250 characters.
  const statedWithUnit = new Set(
    matches.filter((m) => m[2]).map((m) => Number(m[1].replace(/,/g, ''))),
  )
  const seen = new Set<string>()
  const limits: StatedLimit[] = []
  for (const [matched, digits, unitWord = ''] of matches) {
    const limit = Number(digits.replace(/,/g, ''))
    if (!unitWord && statedWithUnit.has(limit)) continue
    const unit = /^w/i.test(unitWord) ? 'words' : 'chars'
    if (seen.has(`${limit}:${unit}`)) continue
    seen.add(`${limit}:${unit}`)
    limits.push({ limit, unit, phrase: matched.replace(/\s+/g, ' ').trim() })
  }
  return limits
}

/**
 * What a form puts after a question to mark it required, taken off before looking for the "?".
 * The space before it is trimmed afterwards rather than matched here, where a leading `\s*` would
 * be tried again from every space in a long run of them.
 */
const REQUIRED_MARK = /(?:\*|\(required\)|required)$/i

/**
 * A line that asks for a pure data field, which the prompt has the model skip even when a form
 * phrases it as a question, as a Typeform-style form phrases every field ("What's your email
 * address?", "Upload your resume?"). Such a line is left out of the question count. Counted, five
 * of them made every correct two-question read of one such form short, and the second look that
 * followed added them as questions and was kept, a worse read, in 3 of 5 live runs.
 *
 * Matched as whole words in any case, with boundaries that know accented letters: "rename" and
 * "curl" ask for no data field, and "Résumé?" does, though no ASCII word boundary follows its é.
 * A real question that uses one of these words ("Have you shipped a mobile app?") is left out
 * too. That only ever means less is checked, never a false alarm: a line left out of the count
 * can only lower it, and a lower count can only ask less of a read.
 */
const DATA_FIELD =
  /(?<![\p{L}\p{N}])(?:name|e-?mail|phone|mobile|linkedin|github|portfolio|website|url|r[eé]sum[eé]|cv)(?![\p{L}\p{N}])/iu

/**
 * What the schema cannot see: Genkit checks the read's SHAPE, and a read that drops six of seven
 * questions and both stated limits is perfectly well-formed (docs/notes/deps.md, "Sampling
 * parameters dropped"). This holds the read against what the pasted text states outright.
 *
 * Only pasted text is read: a form sent as screenshots alone leaves nothing to check against, so
 * that read is never second-guessed. Unlike the other guarded flows' problems these never become
 * an error message, so they may quote the form, which is the employer's text and not the
 * candidate's.
 */
export function problemsWith(out: FormParseOut, input: FormParseInput): string[] {
  if (!input.text) return []
  const problems: string[] = []

  for (const { limit, unit, phrase } of statedLimits(input.text)) {
    // Only a counter's phrase can hold no unit word, and that counter is held to its number alone.
    const unitNamed = /char|word/i.test(phrase)
    const carried = out.questions.some(
      (q) => q.constraints.limit === limit && (!unitNamed || q.constraints.unit === unit),
    )
    if (!carried) {
      const size = unitNamed ? `${limit} ${unit === 'chars' ? 'characters' : 'words'}` : `${limit}`
      problems.push(
        `the form states ${JSON.stringify(phrase)}, but no question carries a limit of ${size}`,
      )
    }
  }

  // A rough count, so only a read with fewer than half of it is short. A line that asks for a data
  // field is left out of it (see DATA_FIELD), and the problem says how many were: it goes to a
  // model with the form in front of it, which can count the lines too. One that asks in other
  // words still counts, and a page pasted with the form can carry questions that are no field at
  // all. Below three lines there is too little to go on.
  const endingInQuestionMark = input.text
    .split('\n')
    .filter((line) => line.trim().replace(REQUIRED_MARK, '').trimEnd().endsWith('?'))
  const leftOut = endingInQuestionMark.filter((line) => DATA_FIELD.test(line)).length
  const asked = endingInQuestionMark.length - leftOut
  const got = out.questions.length
  if (asked >= 3 && got < Math.ceil(asked / 2)) {
    const notCounting = leftOut
      ? `, not counting ${leftOut} that ${leftOut === 1 ? 'names' : 'name'} a data field`
      : ''
    problems.push(
      `the form has ${asked} lines that end in a question mark${notCounting}, but only ${got} ${got === 1 ? 'question' : 'questions'} came back`,
    )
  }

  // A problem said once, as the other guarded flows do: the list is read by a model as
  // instructions, and repetition does it no good.
  return [...new Set(problems)]
}

/**
 * How much of each list the correction spells out, and how long any one of its lines may run.
 * Both lists grow with the paste — a problem per distinct limit it states, quoting the phrase, and
 * a line per question the first read returned — and spelled out whole they were an amplifier
 * anyone signed in could aim at the bill: 50,000 distinct "0 / N" counters, a 488 KB paste, made a
 * 3.6 MB correction, sent on top of the paste and again on its retry, and one phrase as long as the
 * paste (a run of colons after "max") made one line as long. Past a cap the correction says how
 * many more there were, which loses the model nothing it needs: the lists only point, and the whole
 * form is in front of it again. Ten is room for every distinct limit a form plausibly states, since
 * "Max 500 characters" under each of twenty questions is one, and fifty questions for all but the
 * longest questionnaires. Only what is sent is capped: `problemsWith` still returns every problem,
 * because whether the second read is kept turns on how many each read has.
 */
const LISTED_PROBLEMS = 10
const LISTED_QUESTIONS = 50
const LINE_CHARS = 300
/** What a cut line keeps of its end: the limit no question carries, or a question's constraints. */
const TAIL_CHARS = 100

/**
 * A line cut from its middle to LINE_CHARS, so its start and its end both survive. A cut through a
 * surrogate pair would leave half a character on its own, which `toWellFormed` makes U+FFFD.
 */
const clipped = (line: string): string =>
  line.length <= LINE_CHARS
    ? line
    : `${line.slice(0, LINE_CHARS - TAIL_CHARS - 3)} … ${line.slice(-TAIL_CHARS)}`.toWellFormed()

/** At most `max` items, a clipped line each, and then one line saying how many more there were. */
const listed = <T>(items: T[], max: number, line: (item: T) => string): string[] => [
  ...items.slice(0, max).map((item) => clipped(line(item))),
  ...(items.length > max ? [`- … and ${items.length - max} more`] : []),
]

/**
 * The correction, carrying the first read back with it, as `resumeFindings`' does: without it the
 * model is asked to repair a read it cannot see. Its next-to-last line restates the rules: a list
 * of what was missed reads as leave to add every line that ends in "?", and a data field added as
 * a question counts toward the questions that came back, so a read padded with them can pass the
 * count and be kept. In live runs 3 of 4 second reads added them without that line, 0 of 4 with it.
 */
const correction = (previous: FormParseOut, problems: string[]): Part => ({
  text: [
    'Your previous read of this form missed part of it.',
    '',
    'What you returned:',
    ...(previous.questions.length === 0
      ? ['(no questions)']
      : listed(previous.questions, LISTED_QUESTIONS, ({ q, constraints: c }) => {
          const limit = c.limit === undefined ? 'no limit' : `limit ${c.limit} ${c.unit ?? '(no unit)'}`
          return `- ${JSON.stringify(q)}: ${c.type}, ${limit}, ${c.required ? 'required' : 'not required'}`
        })),
    '',
    'What it missed:',
    ...listed(problems, LISTED_PROBLEMS, (p) => `- ${p}`),
    '',
    'The rules have not changed: pure data fields (name, email, phone, links, uploads) are still skipped, and a line is not a field just because it ends in a question mark.',
    'Read the whole form again and return every answerable field with the constraints the form states. Return the full structured output.',
  ].join('\n'),
})

/**
 * A form as pasted text and/or screenshots in, its questions and artifact scope out.
 *
 * The read is held against what the pasted text states, and a read that misses something is asked
 * for once more, with what it missed. The second read is returned only if it has strictly fewer
 * problems; otherwise the first is.
 *
 * Unlike `answerDraft`, `bulletRewrite` and `resumeFindings`, this never refuses a read because of
 * these checks. Their checks are exact: a fact id is in the bank or it is not. These read free text
 * a person pasted, so either can misfire on a form that is fine, and a check that misfires must not
 * be able to make a form unparseable — the guard can only buy a second look. For the same reason a
 * second look that cannot be had at all leaves the first read standing.
 */
export async function runFormParse(
  input: FormParseInput,
  generate?: GenerateCall,
): Promise<FormParseOut> {
  const { system, parts } = buildFormParsePrompt(input)
  const ask = (prompt: Part[]) =>
    generateStructured(
      { parts: prompt, system, schema: FormParseOutSchema, thinkingLevel: THINKING_LEVEL },
      generate,
    )

  const first = await ask(parts)
  const problems = problemsWith(first, input)
  if (problems.length === 0) return first

  const second = await ask([...parts, correction(first, problems)]).catch((error: unknown) => {
    if (error instanceof FlowOutputError) return null
    throw error
  })
  if (second === null) return first
  return problemsWith(second, input).length < problems.length ? second : first
}
