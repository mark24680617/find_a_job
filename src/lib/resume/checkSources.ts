/**
 * Who documents each rule — the evidence table's third column, and the reason the table has three
 * columns rather than two. A check the product runs without being able to name why is a check the
 * product should not run, so the source travels with the id rather than being written in a
 * component: a row cannot reach the page without one.
 *
 * Every string below is spec §6.1's second column verbatim, including the one that says the claim
 * is ours (amended 2026-09-24, R32), with typographic apostrophes because every one of them is
 * drawn on the page (amended 2026-09-24, R21). Changing one is a spec change, and this file is
 * where the diff shows.
 */

/** The language every check in this suite assumes. §6.1, risk 11: the gate covers the Nouls too. */
export const CHECK_LANGUAGE = 'en'

/** What the page says instead of a verdict when the gate holds. §6.1's own wording. */
export const LANGUAGE_GATE_SENTENCE = 'Written for English-language resumes. These were not run.'

export const CHECK_SOURCES = {
  'text-layer':
    'Oracle Taleo: image-format resumes "will not be parsed" [Taleo documentation]; SAP SuccessFactors uses Textkernel and does not license OCR parsing [likely]',
  'file-size':
    'Greenhouse parse-failure page (a 100 MB upload ceiling against a 2.5 MB parse ceiling, so a heavy PDF uploads fine and silently fails to parse)',
  'contact-in-header':
    'Greenhouse parse-failure page ("name/contact info in headers, footers or text boxes")',
  'multi-column':
    'Textkernel: ≥15% of CVs use columns, and naive rendering "mix[es] bits and pieces of each column together"; after an ML fix well-rendered CVs went 62% → 90%, which is Textkernel’s own marketing about its own product [likely]',
  'section-headings': 'Greenhouse parse-failure page ("inconsistent section formatting")',
  // One row of §6.1's table, two ids: whether the dates can be read at all and whether they run
  // newest-first are different failures with different fixes, and the source is the same sentence.
  'dates-parseable':
    'Workday: "Resume parsing results can vary based on resume format and order of words"',
  'dates-reverse-chronological':
    'Workday: "Resume parsing results can vary based on resume format and order of words"',
  'employment-gap':
    'Joseph Fuller, HBS: roughly half of US companies filter out applicants with a >6-month employment gap. Reported neutrally (D4)',
  'spaced-letters': 'Greenhouse parse-failure page',
  'font-size':
    'Our judgement, not vendor-documented. No vendor publishes a point-size threshold; this is legibility, and the third column says so rather than borrowing a name that does not make the claim',
  'placeholder-residue':
    'Greenhouse "actively skips data it reads as fake", so leftover template text can wipe a field',
  'self-description':
    'docs/notes/cover-letter-doctrine.md §4.2, shipped as data with the reason string attached so the UI can explain a flag instead of silently changing the candidate’s words',
  // The other row of §6.1's table that carries two ids, for the reason the row itself names: the
  // zero-size half ships either way and the colour half only if Task A3 found fill colour
  // reachable — which it did, so both ship (R9). The string is §6.1's verbatim, off-page caveat
  // included: off-page text is excluded for free and never flagged. <!-- R21, amended 2026-09-24 -->
  'hidden-text-geometry':
    'Flagged, never suggested: extraction-visible and trivially detectable [ats-reality]. Colour-based detection ships only if the §9.3 spike finds fill colour reachable; the zero-size half ships either way. Off-page text is a special case: `pdfjs-dist`’s `getTextContent()` does not return text drawn outside the page box [plan Task A3, to be re-confirmed by the spike], so it is excluded from every model input for free but cannot be flagged, and the check table says so rather than claiming a detection it cannot make',
  'hidden-text-colour':
    'Flagged, never suggested: extraction-visible and trivially detectable [ats-reality]. Colour-based detection ships only if the §9.3 spike finds fill colour reachable; the zero-size half ships either way. Off-page text is a special case: `pdfjs-dist`’s `getTextContent()` does not return text drawn outside the page box [plan Task A3, to be re-confirmed by the spike], so it is excluded from every model input for free but cannot be flagged, and the check table says so rather than claiming a detection it cannot make',
  'ligature-damage':
    'A mechanically verifiable failure: the glyph reads "office" and the extracted text says "ofce", which is the text a recruiter searches [mechanism verified against Mozilla bug 1810914, via the map]',
  // (plan) The four per-bullet judgements, which need ids for the same reason the checks do:
  // ResumeFindingsOutSchema puts a checkId on every finding and C9's guard requires it to name
  // something handed over, so a finding about a failing bullet has to have a row here to exist.
  // The XYZ attribution is the plan's fixed string and nothing more is claimed for it — never
  // "Google's formula", never an efficacy number (spec §6.3).
  // C11's evidence table reads these four through `sourceFor` and declares no copy (R32).
  'bullet-result': 'Laszlo Bock, Google’s former SVP of People Operations, 2014',
  'bullet-action': 'Laszlo Bock, Google’s former SVP of People Operations, 2014',
  'bullet-scale': 'Laszlo Bock, Google’s former SVP of People Operations, 2014',
  'bullet-self-description':
    'docs/notes/cover-letter-doctrine.md §4.2, shipped as data with the reason string attached so the UI can explain a flag instead of silently changing the candidate’s words',
} as const

export type CheckId = keyof typeof CHECK_SOURCES

/** Display order, and the order `runChecks` returns rows in. */
export const CHECK_IDS = Object.keys(CHECK_SOURCES) as CheckId[]

export function sourceFor(id: CheckId): string {
  return CHECK_SOURCES[id]
}
