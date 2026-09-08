import type { AskHuman, Letterhead, Question } from '@/lib/types'

/**
 * The cover letter's small decisions, in one place: what the question looks like when it is
 * created, how a stored letterhead is read back, what the exported file is called, and the two
 * numbers a letter is measured against.
 *
 * The letterhead lives on the question rather than on the profile because the profile document
 * is replaced whole by the editor's PUT and by two routes' setProfile: a contact field there is
 * a field three writers can clobber, and the one place a letterhead is ever read is the letter
 * it belongs to. What that cost — retyping a phone number per application — is now spared by
 * `Profile.contact`: four fields the person edits on their profile, which the fill route copies
 * into the blanks of this letterhead rather than storing a letterhead there.
 *
 * Pure and free of imports beyond a type, because both halves of the product read it: the pane
 * and the letterhead panel are client components, and the draft route, the finalize route and
 * the PDF route are server code. Anything that reached for Firestore or a model here would put
 * one of the two out of reach.
 */

/** The question's text. It is what the list draws and what the pane's heading replaces. */
export const LETTER_Q = 'Cover letter'

/** A letterhead field is one line of an address block, not a paragraph. */
export const LETTERHEAD_FIELD_MAX = 200

/**
 * The whole letter's ceiling in words — the top of the institutional 250–400 band, which is the
 * convention a one-page letter rests on. The prompt asks for less (its rule 6); this is what the
 * flow refuses, so a good 355-word letter does not spend the one correction round.
 */
export const LETTER_WORD_CEILING = 400

/** What the pane tells the person to aim for, and what the prompt's rule 6 asks for. */
export const LETTER_WORD_TARGET = { min: 200, max: 320 } as const

export const isCoverLetter = (q: Pick<Question, 'kind'>): boolean => q.kind === 'cover-letter'

/**
 * The one question a letter cannot be written without and the resume cannot answer: what
 * actually happened in the example the letter leads with (doctrine §7, question 5). The prompt
 * asks the model to ask it — rule 5's block (2) — and the wording is the product's rather than
 * the model's, because it is asked on every letter that has not been told the story and a
 * question the person sees every time should read the same way every time.
 */
export const STORY_ASK: AskHuman = {
  question: 'What actually happened in the example the letter leads with — what you did, and what came of it? Rough is fine.',
  why: 'The lead paragraph is written from your resume alone. The letter needs the part the resume cannot say, in your words.',
}

/**
 * The phrases a question asking for the story is built out of. Deliberately short and
 * deliberately specific: the list errs towards the wordings a model actually reaches for when it
 * asks this — the smoke's runs asked about an "incident", about what "prompted" the work, about
 * what "came of it" — and away from anything a letter's other questions might contain.
 *
 * "what happened" and "the story" are off it for that second reason, though a story question does
 * reach for both: the reason for a gap is an ask of its own (the letter's rule 1, and block (3) is
 * the bridge it feeds), and "what happened during those months" or "the story behind the pivot" is
 * that question in those words. A gap ask matched here would cost the story ask for the life of
 * the letter — the answered gap ask stays in the merged queue while the story box stays blank — and
 * that is the expensive half of the trade below. A story question worded that way is missed
 * instead, which costs one repeated card.
 */
const STORY_PHRASES = [
  'actually happened', 'incident', 'came of it', 'what you did',
  'walk me through', 'led up to', 'what prompted', 'how it went', 'the outcome',
]

/**
 * Whether this ask is the story ask, whoever wrote it: `STORY_ASK`'s own question, or one that
 * reads as the same question in the model's words.
 *
 * Wording is all this has to go on. Reading two questions for the same meaning is a judgement,
 * and a judgement here is a second model call on every draft — paid on every letter, to decide
 * whether to draw one card or two. So the match is textual, and the two ways it can be wrong are
 * not the same size: a miss costs one repeated card on the pane, and a false match costs the ask
 * altogether, on a letter that needed it. The list is short for that reason.
 */
export function asksForStory(ask: Pick<AskHuman, 'question'>): boolean {
  const question = ask.question.toLowerCase()
  return question === STORY_ASK.question.toLowerCase() || STORY_PHRASES.some((phrase) => question.includes(phrase))
}

/**
 * Whether this draft has to carry the ask: a cover letter, no telling behind it, and nobody — the
 * model or an earlier draft — has already asked for the story, in the product's wording or in
 * the model's own. What is left is a model wording none of `asksForStory`'s phrases match, which
 * still leaves two cards on the pane for one question (spec §5, and the smoke's README).
 */
export function needsStoryAsk(question: Pick<Question, 'kind' | 'story'>, asks: AskHuman[]): boolean {
  if (!isCoverLetter(question) || question.story?.trim()) return false
  return !asks.some(asksForStory)
}

/** The seven fields, each blank except what the account already knows. */
export function blankLetterhead(name = '', email = ''): Letterhead {
  return { name, email, phone: '', location: '', recipient: '', recipientTitle: '', companyAddress: '' }
}

/**
 * The question the page appends. No `limit` and no `unit`: a form's word limit is a fact the
 * employer stated, and no employer stated one for a cover letter — its length rule is the
 * one-page convention, held as a ceiling in the flow rather than printed beside `Optional` as
 * though a form had asked for it.
 */
export function newCoverLetter(name: string, email: string): Question {
  return {
    q: LETTER_Q,
    kind: 'cover-letter',
    constraints: { type: 'long-text', required: false },
    askHuman: [],
    status: 'pending',
    letter: blankLetterhead(name, email),
  }
}

// Everything C0 and C1 except `\n`, which the address block needs: a control character in a
// field is either a paste artefact or an attempt to break a line of the PDF apart.
const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g

// The address block is the one field the layout breaks into its own lines; the other six are each
// one line wherever they are used. A newline left in one of those reaches the prompt as
// `Addressed to: Dana\nWu` and the guard as a required opening of `Dear Dana\nWu,` — which no
// letter the model returns can ever start with, so every draft spends its correction round and
// then refuses. Folded to a space here, the prompt, the guard, the preview and the PDF all agree.
function field(value: unknown, multiline = false): string {
  if (typeof value !== 'string') return ''
  const lines = value.replace(/\r\n?/g, '\n')
  const clean = (multiline ? lines : lines.replace(/\n/g, ' ')).replace(CONTROLS, '').trim()
  // Cut by code point, as `countUnits` counts them: `String.slice` counts UTF-16 units, and a cut
  // that lands inside a surrogate pair leaves half a character to be reported at export as one
  // the font cannot set — a character the person can neither read nor delete.
  return Array.from(clean).slice(0, LETTERHEAD_FIELD_MAX).join('')
}

/**
 * The letterhead as stored, made safe. The application PATCH validates only that its body is an
 * object, so the record can hold anything a client sent; this is applied on every read from it,
 * which is why the seven fields are named here rather than copied across from the value.
 */
export function readLetterhead(value: unknown): Letterhead {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    name: field(v.name),
    email: field(v.email),
    phone: field(v.phone),
    location: field(v.location),
    recipient: field(v.recipient),
    recipientTitle: field(v.recipientTitle),
    companyAddress: field(v.companyAddress, true),
  }
}

// Accents are folded rather than dropped (`Zoë` → `Zoe`). The apostrophe alone is dropped where
// it stands, so the letters around it close up (`O’Brien` → `OBrien`); everything else that is
// not a letter or a digit separates, and a run of it is one hyphen (`Jean-Luc Picard` →
// `Jean-Luc-Picard`, `Söderberg & Co.` → `Soderberg-Co`). A name of no ASCII at all yields
// nothing, and its hyphen goes with it.
const ascii = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036F]/g, '').replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean).join('-')

/**
 * `Tom-Candidate-Cover-Letter-Marram-Systems.pdf`. ASCII only, because this is computed on the
 * client and handed to the download: the server's own content-disposition filename is a
 * constant, since a header value outside Latin-1 throws in Node.
 */
export function letterFileName(name: string, company: string): string {
  return [ascii(name), 'Cover-Letter', ascii(company)].filter(Boolean).join('-') + '.pdf'
}

/**
 * The LOCAL date, as `YYYY-MM-DD`. Not `toISOString().slice(0, 10)`, which is UTC: a letter
 * exported at half past eleven on a September evening would be dated the eighth.
 */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
