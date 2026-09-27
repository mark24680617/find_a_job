import type { CheckId } from '@/lib/resume/checkSources'

/**
 * How to fix each row, one fixed sentence per check id (F1, final review acceptance-5). D2: every
 * counted item expands to its line, who documents the rule and how to fix it, and a model finding
 * is not always written, so this is the floor the evidence table draws when none covers a failing
 * row — never beside one, so a row never carries two fixes.
 *
 * Each sentence is checked against its row in spec §6.1 and says only what the row's source
 * supports: what to change in the document, never what an applicant tracking system will do with
 * it. Typographic apostrophes, because every one is drawn on the page.
 */
export const FIX_FOR: Record<CheckId, string> = {
  'text-layer':
    'Export the PDF from the document you wrote it in, rather than scanning or photographing a printed copy, so the file carries its text.',
  'file-size':
    'Export it again with images compressed or taken out, so the file is under 2.5 MB.',
  'contact-in-header':
    'Move your name and contact details out of the page header or footer and into the first lines of the page itself.',
  'multi-column':
    'Set the resume in one column, so every line reads in order from the top of the page to the bottom.',
  'section-headings':
    'Give each section a plain heading, such as Experience, Education or Skills.',
  'dates-parseable':
    'Write each date as a month and a year, such as March 2021, or as a year on its own.',
  'dates-reverse-chronological':
    'List your roles newest first, so the most recent one sits at the top.',
  // Never drawn: the gap row is reported, not failed (D4 — never advise hiding it). Stated here
  // only because every id has a sentence.
  'employment-gap':
    'Nothing to change: the period is stated, and only you can say what it was.',
  'spaced-letters':
    'Type each word as one run of letters, and set any wider spacing in the font settings rather than with spaces.',
  'font-size':
    'Set the text at 9 pt or larger.',
  'placeholder-residue':
    'Replace or delete the template text left in these lines.',
  'self-description':
    'Replace the flagged word with a plain one, and any claim about yourself with something you did and what came of it.',
  'hidden-text-geometry':
    'Delete the text the page does not show: a reader never sees it, and the file still carries it.',
  'hidden-text-colour':
    'Delete the white or near-white text: a reader can barely see it, if at all, and the file still carries it.',
  'ligature-damage':
    'Export the PDF again from the original document with its fonts embedded, then check that a word like “office” copies out whole.',
  'bullet-result':
    'Say what changed because of the work, with a number where you have one.',
  'bullet-action':
    'Start with what you did, in a specific verb, rather than what you were responsible for.',
  'bullet-scale':
    'Say how large it was: the team, the users, the money or the time involved.',
  'bullet-self-description':
    'Replace the description of yourself with something you did, and what came of it.',
}
