import { normalizeWs } from '@/lib/research/quotes'

/**
 * The two blocks of `docs/notes/cover-letter-doctrine.md` §4.2 that can appear on a resume, as
 * data with the reason attached — the doctrine's own instruction: "Ship as data with the reason
 * string attached, so the UI can explain a rewrite instead of silently changing the candidate's
 * words." Nothing here rewrites anything; the flag and its reason are the whole output.
 *
 * The other three blocks of §4.2 — openers, flattery about the company, process and closing
 * deadwood — are letter shapes. A resume has no salutation and no sign-off, so a check for them
 * would fire on nothing and dilute the ones that fire on something.
 *
 * Every form is written out. No stemming and no edit distance: a near-match here would flag a
 * word the candidate did not write, which is the same failure as inventing one.
 *
 * This is the product's one banned-phrase member list (amended 2026-09-24, R33). Task E1's
 * `BANNED_PHRASES` is derived from `DOCTRINE_PHRASES` rather than declared beside it, and E1's
 * test asserts every form here is matched by its `bannedIn`, so a rewrite Stage E accepts can
 * never be flagged by the next Diagnose. The two matchers stay separate; the prompts may ask for
 * more than either enforces.
 */
export interface DoctrinePhrase {
  /** Lower-cased, whole-word forms. Multi-word entries match across a single space. */
  match: string[]
  /** Why it fails, in the doctrine's own terms. Shown beside the flag; never applied. */
  reason: string
}

const NO_EVENT =
  'An adjective with no event attached. The doctrine files this under self-description without evidence: it asserts the conclusion the reader is supposed to draw.'

export const DOCTRINE_PHRASES: DoctrinePhrase[] = [
  {
    match: ['uniquely qualified', 'the best candidate', "i'm the best candidate"],
    reason:
      'Unknowable, and it raises doubts about self-awareness rather than settling them (cover-letter-doctrine.md §4.2).',
  },
  {
    match: ['work well independently and as part of a team', 'works well independently and as part of a team'],
    reason:
      'A baseline expectation — "like announcing that you show up on time and shower regularly" (cover-letter-doctrine.md §4.2).',
  },
  { match: ['hard-working', 'hard working', 'hardworking'], reason: NO_EVENT },
  { match: ['detail-oriented', 'detail oriented'], reason: NO_EVENT },
  { match: ['proactive self-starter', 'self-starter', 'self starter'], reason: NO_EVENT },
  { match: ['team player'], reason: NO_EVENT },
  { match: ['go-getter'], reason: NO_EVENT },
  { match: ['results-driven', 'results driven'], reason: NO_EVENT },
  { match: ['proven track record'], reason: NO_EVENT },
  { match: ['great communication skills', 'excellent communication skills'], reason: NO_EVENT },
  {
    match: ['passionate about', 'passionate'],
    reason:
      'Passion with no cited object. The doctrine bans the word where nothing is named that the reader can check (cover-letter-doctrine.md §4.2).',
  },
  {
    // The lexical core of §4.2's LLM-register list, with the inflections a resume writes them in.
    match: [
      'delve', 'delved', 'delving',
      'underscore', 'underscored', 'underscores',
      'meticulous', 'meticulously',
      'commendable',
      'intricate', 'intricacies',
      'realm', 'tapestry',
      'boast', 'boasted', 'boasts',
      'leverage', 'leveraged', 'leveraging', 'leverages',
      'spearhead', 'spearheaded', 'spearheading', 'spearheads',
      'robust', 'seamless', 'seamlessly', 'synergy', 'synergies', 'holistic',
      'resonate', 'resonated', 'testament',
      'navigate', 'navigated', 'navigating',
      'foster', 'fostered', 'fostering',
      'elevate', 'elevated', 'elevating',
      'unlock', 'unlocked', 'unlocking',
      'embark', 'embarked', 'embarking',
      'pivotal', 'myriad',
      'cutting-edge', 'cutting edge', // <!-- R33: in E1's list, so in the one list -->
    ],
    reason:
      'LLM register, sourced to the excess-vocabulary literature (cover-letter-doctrine.md §4.2). Weight the structural tells higher than the lexical ones: a word on the list is a signal, not proof, and several were already rising before 2022.',
  },
]

/**
 * For each entry of the list, in list order, the first of its forms that `text` contains as whole
 * words; [] on clean text. Whole words means the form stands between spaces, or is followed by a
 * comma or a full stop — nothing looser, for the reason the header gives. Exported so the findings
 * guard (Task C9) holds a model's prose to the same match the self-description check holds the
 * resume to (R33), one hit per entry as C9 reports them.
 */
export function doctrinePhrasesIn(text: string): string[] {
  const words = ` ${normalizeWs(text).toLowerCase()} `
  return DOCTRINE_PHRASES.flatMap((phrase) => {
    const hit = phrase.match.find(
      (form) => words.includes(` ${form} `) || words.includes(` ${form},`) || words.includes(` ${form}.`),
    )
    return hit === undefined ? [] : [hit]
  })
}
