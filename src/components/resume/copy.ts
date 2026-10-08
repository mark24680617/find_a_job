import type { Judge } from '@/lib/types'

/**
 * The sentences the spec fixes word for word, in one place so there is one place to check them
 * against `docs/superpowers/specs/2026-09-21-resume-review-loop-design.md`. Every apostrophe is
 * typographic: React escapes a straight one to `&#x27;` in the rendered markup, which is also
 * why the tests assert `’`.
 */

/** §6.1, the empty state: nothing stored. */
export const NO_RESUME = 'No resume here yet. Upload the PDF you actually send to employers.'

/**
 * §6.1, the empty state for an account that has facts and no stored resume. It says what the
 * product can see — facts on file, no document behind them — rather than where the facts came
 * from, which nothing in this repo records: `Profile` (`src/lib/types.ts:5-12`) has no
 * provenance field and `POST /api/profile/reconcile` takes `pdfBase64 | pastedText | url`
 * (`src/app/api/profile/reconcile/route.ts:57`) and stores none of the three. The spec was
 * rewritten to this wording for that reason; it is quoted from §6.1 verbatim.
 */
export const PROFILE_NOT_A_DOCUMENT =
  'You have a profile already, but no document here to check it against.'

/** §6.1, what a check says when the document has no text layer to run it against. */
export const NO_TEXT_TO_READ = 'Not run: there is no text to read.'

/** §6.3's empty state: nothing failed, so there is nothing to rewrite. */
export const NOTHING_TO_REWRITE = 'Nothing to rewrite. Every bullet carried a result, an action and a scale.'

/** §5.2, drawn beside any artifact whose `reviewedFrom` is not the current `addedAt`. */
export const STALE = 'Reviewed against an earlier upload.'

/**
 * §8's disclosure as the page has carried it since 2026-10-07: one line, at the owner's ruling
 * (Amendments, item 17). The README keeps §8's line in full — the two vendors, TypeSafe's terms
 * and where the document is stored.
 */
export const DISCLOSURE =
  'Your resume is private to your account, and you can delete it at any time.'

/**
 * §8's stated gap. When fill colour cannot be read on a build, the zero-size checks still run and
 * still exclude, and the page carries this one line rather than silently carrying the gap.
 * `EvidenceTable` renders it once, under the count, only while `COLOUR_HIDDEN_TEXT` is false —
 * which it is not on this build, because Task A3 found fill colour reachable (R9).
 */
export const COLOUR_UNDETECTABLE = 'Colour-hidden text cannot be detected on this build.'

/** Whose reading answered, named rather than implied. The one map: C11, D8 and E6 import it (R36). */
export const JUDGE_NAME: Record<Judge, string> = {
  jev: 'TypeSafe’s Jev',
  gemini: 'Google’s Gemini',
}

/**
 * A run that judged no line, said as that (amended 2026-09-24, ledger B3). Without
 * it the count reads `N checks, 0 need attention` over a per-line judge that had nothing to
 * read — a count that claims more than was done (D2). `EvidenceTable` draws it under the count;
 * E6 draws it in place of `NOTHING_TO_REWRITE` when the fresh review judged no line.
 */
export const NO_BULLETS_FOUND =
  'We found no bullet lines under a heading we recognise, so no line of your resume was judged.'

/**
 * D4's neutral report (final review, page-3): the gap row's chip when a period was found. Plain,
 * never the danger chip — §7 gives neutral rows a plain chip — and it says the period was
 * reported, not that it needs anything.
 */
export const GAP_REPORTED = 'Reported'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** `2024-03` → `March 2024`: `findGaps` answers in `YYYY-MM`, which is not how a person writes it. */
function monthText(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined
  return m && name ? `${name} ${m[1]}` : month
}

/** D4's sentence, word for word: the period, and nothing about why or what to do. */
export function noEntriesBetween(from: string, to: string): string {
  return `No entries between ${monthText(from)} and ${monthText(to)}.`
}

/**
 * D4's sentence for the dates-parseable row (F1, final review acceptance-5): the dates that could
 * not be read, named by the raw text the resume printed and never by a guess at what it meant.
 */
export const COULD_NOT_READ_DATES = 'Could not read these dates'

/** `Could not read these dates: “on and off from ’14”.` */
export function couldNotReadDates(raws: string[]): string {
  return `${COULD_NOT_READ_DATES}: ${raws.map((r) => `“${r}”`).join(', ')}.`
}

/**
 * The resume line a rewrite card or an accepted line stands in for (final review, page-6), so a
 * card is never a sentence attached to no line: with several lines ticked, and for a skip above
 * all, the person should not have to guess which line it is about.
 */
export function inPlaceOf(line: string): string {
  return `In place of: “${line}”`
}

/** The same for a skipped line, which the rewrite left as it was. */
export function leftAsItIs(line: string): string {
  return `Left as it is: “${line}”`
}

/** §6.2, the empty state: nothing in the postings or In Demand in O*NET data to compare. */
export const NOTHING_TO_COMPARE =
  'Nothing to compare against yet. Save an application, or pick a closer role.'

/** §6.2, bucket 3: the product asks, and never says "you lack this skill". */
export const HAVE_YOU_DONE_THIS = 'Have you done this?'

/**
 * Gaps' three statements about the person's own documents (F2, final review acceptance-6). Each
 * is drawn only through `cited`, with the text its flag matched, and not at all when the row
 * recorded none: the product never states a fact about the person it cannot cite, and a quote
 * beside the statement is what lets a false match ('go-live' read as Go) show as one.
 */
export const ASKED_FOR_IN_A_POSTING = 'asked for in a posting you saved'
export const A_POSTING_ASKS = 'A posting you saved asks for it'
export const YOUR_RESUME_NAMES_IT = 'your resume names it'
export const IN_YOUR_PROFILE = 'in your profile'

/** A statement and the text that backs it, in the page's quote style. */
export function cited(statement: string, quote: string): string {
  return `${statement} — “${quote}”`
}

/**
 * Under Gaps' queue when more bucket-3 cards wait than are open (final review, page-2): every row
 * is already listed above, so this says where the rest are and when they are asked.
 */
export function moreToAsk(waiting: number): string {
  return `${waiting} more ${waiting === 1 ? 'is' : 'are'} listed above. They come up here as you answer these.`
}

/**
 * Under Gaps' queue once it has asked all it will on this resume (final review, acceptance-3): the
 * asks route keeps one list of answers per resume, and the rewrite's number asks need room in it.
 */
export const GAPS_ASKED_ENOUGH =
  'The rest are listed above and not asked here, which keeps room on this resume for the answers a rewrite needs.'

/**
 * §6.2's copy rule, with the real number in it — never the number 1000. `O*NET® data`, not a
 * possessive: O*NET's trademark terms ask for the ® mark and for O*NET used as an adjective
 * (amended 2026-09-24, ledger A6).
 */
export function comparedWith(postings: number, roleFamily: string): string {
  const saved = `${postings} ${postings === 1 ? 'posting' : 'postings'}`
  return `from the ${saved} you saved and O*NET® data for ${roleFamily}`
}

/**
 * The two links beside ONET_ATTRIBUTION (amended 2026-09-24, ledger A6). CC BY 4.0 §3(a)(1)(C)
 * and O*NET's terms ask for a link to the licence; the attribution string itself stays verbatim,
 * so the links sit after it, and their visible text is the bare URL rather than words of ours.
 */
export const ONET_DATABASE_URL = 'https://www.onetcenter.org/database.html'
export const ONET_LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/'
