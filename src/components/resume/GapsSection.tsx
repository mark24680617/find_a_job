'use client'

import { useState } from 'react'
import { Working } from '@/components/Working'
import { AskHumanQueue } from '@/components/review/AskHumanQueue'
import {
  A_POSTING_ASKS, ASKED_FOR_IN_A_POSTING, cited, comparedWith, GAPS_ASKED_ENOUGH, HAVE_YOU_DONE_THIS,
  IN_YOUR_PROFILE, JUDGE_NAME, moreToAsk, ONET_DATABASE_URL, ONET_LICENCE_URL, STALE,
  YOUR_RESUME_NAMES_IT,
} from '@/components/resume/copy'
import { GAPS_SECONDS, secondsNote } from '@/components/resume/timings'
import { ErrorLine, type ToolError } from '@/components/resume/ToolError'
import { CHECK_LANGUAGE, LANGUAGE_GATE_SENTENCE } from '@/lib/resume/checkSources'
import { ROLE_FAMILIES } from '@/lib/resume/onetLookup'
import { ONET_ATTRIBUTION } from '@/lib/resume/onet'
import type { GapsResult, StoredResume } from '@/lib/types'

/**
 * Gaps: what the postings this person saved ask for, against what this document evidences.
 *
 * Two things keep it honest. The role family is **confirmed**, never inferred — a comparison
 * against the wrong occupation is worse than no comparison. And the page states the real N:
 * the postings are this person's own saved applications, typically a handful, and saying so is
 * the difference between a comparison and a claim about the market.
 *
 * The third bucket is a question, never a finding. The product cannot state an absence about
 * somebody any more than it can state a presence, so a skill it cannot see becomes an amber
 * card that asks.
 *
 * Every sentence about a row is built from what the row records (R37): "a posting you saved"
 * only when `inPostings` is true — otherwise the skill is in scope because O*NET marks it In
 * Demand for the family —
 * and "not found in your resume" only when `namedInResume` is false. And a statement about the
 * person's own documents is drawn only with the text its flag matched (F2, acceptance-6): the
 * posting term, the resume line, the fact claim. A flag with no text draws no statement.
 */

type Skill = GapsResult['skills'][number]

const STAGES = [
  { at: 0, text: 'Reading the postings you saved…' },
  { at: 3_000, text: 'Comparing them with your resume…' },
]

/**
 * The buckets as headings, built from the bucket and the flags (R37, R38) — none of which says
 * "you lack", and none of which says every row came from a posting. Bucket 3 splits on
 * `namedInResume`, because a skill the resume names but the judge did not pass is not absent.
 */
const GROUPS: { key: string; heading: string; has: (skill: Skill) => boolean }[] = [
  { key: 'evidenced', heading: 'Evidenced in your resume', has: (s) => s.bucket === 1 },
  {
    key: 'profile',
    heading: 'In your profile, not visible in your resume — a candidate for a rewrite',
    has: (s) => s.bucket === 2 && !s.namedInResume,
  },
  // (amended 2026-09-25, D5 fix round 1 controller ruling) A bucket-2 row the resume names is not
  // "not visible in your resume"; it gets its own heading, mirroring bucket 3's split (R37).
  {
    key: 'profile-named',
    heading: 'In your profile and named in your resume, with no hands-on use we could read — a candidate for a rewrite',
    has: (s) => s.bucket === 2 && s.namedInResume,
  },
  {
    key: 'named',
    heading: 'Named in your resume, with no hands-on use we could read',
    has: (s) => s.bucket === 3 && s.namedInResume,
  },
  {
    key: 'absent',
    heading: 'Not found in your resume or profile',
    has: (s) => s.bucket === 3 && !s.namedInResume,
  },
]

/**
 * What the row can say about itself, each statement about the person with its quote (R37, F2):
 * where the demand came from, that the resume names it, that the profile holds it. O*NET's In
 * Demand flag is a statement about the family, not the person, and needs no quote.
 */
function rowStatements(skill: Skill, roleFamily: string): string[] {
  const { posting, resume, bank } = skill.evidence
  const said: string[] = []
  if (!skill.inPostings) said.push(`in demand for ${roleFamily} in O*NET® data`)
  else if (posting !== null) said.push(cited(ASKED_FOR_IN_A_POSTING, posting))
  if (skill.namedInResume && resume !== null) said.push(cited(YOUR_RESUME_NAMES_IT, resume))
  if (bank !== null) said.push(cited(IN_YOUR_PROFILE, bank))
  return said
}

/**
 * Why the card asks, from the same flags and their quotes (R37, F2). The In-Demand-only sentence
 * has a subject and uses O*NET as an adjective (amended 2026-09-24, ledger A6; F3's wording,
 * owner-approved). A card is bucket 3, so the profile holds nothing to quote.
 */
function askWhy(skill: Skill, roleFamily: string): string {
  const { posting, resume } = skill.evidence
  const demand = !skill.inPostings
    ? `It is in demand for ${roleFamily} in O*NET® data`
    : posting !== null ? cited(A_POSTING_ASKS, posting) : null
  const seen = !skill.namedInResume
    ? 'we could not find it in your resume or your profile'
    : `${cited(YOUR_RESUME_NAMES_IT, resume as string)} — but nothing we could read shows hands-on use of it`
  return demand !== null ? `${demand}, and ${seen}.` : `${seen[0].toUpperCase()}${seen.slice(1)}.`
}

/**
 * One stable id per card (R31), so answering the same card twice is the duplicate the asks route
 * refuses. `+` and `#` are spelled out: C, C++ and C# are three O*NET skills and three cards.
 */
export function gapsAskId(skill: string): string {
  const slug = skill
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `gaps-${slug}`
}

/**
 * How many bucket-3 cards are open at once (final review, page-2). O*NET's In Demand skills count
 * as demanded (F3; 3 to 37 a family on release 31.0) beside whatever the saved postings ask for,
 * so bucket 3 can still run to dozens; each is listed in its bucket above, and a queue of that
 * many amber cards would bury the one signal amber is kept for. A posting's demand is asked
 * first, then O*NET's.
 */
export const GAPS_OPEN_CARDS = 10

/**
 * How many Gaps answers the page asks for on one resume (final review, acceptance-3). The asks
 * route keeps one list per resume, capped at 100 (`MAX_ASKS`, R55) and shared with Diagnose and
 * Rewrite, and a Replace keeps it; the rewrite's number asks are the Y rule's only source the
 * person writes, so Gaps leaves them most of it.
 */
export const GAPS_ANSWERS_AT_MOST = 40

interface Props {
  resume: StoredResume
  /** How many of this person's own saved applications Tier 0 would read — `tier0Terms(apps).postingsUsed` (R54). */
  postingsAvailable: number
  busy: boolean
  /** A failed request's sentence; drawn here only when it came from this section (page-5). */
  error?: ToolError
  onRun: (roleFamily: string, onetSoc: string) => Promise<void>
  onAnswerAsk: (answers: { askId: string; question: string; answer: string }[]) => Promise<void>
}

export function GapsSection({ resume, postingsAvailable, busy, error = null, onRun, onAnswerAsk }: Props) {
  const gaps = resume.gaps
  const [onetSoc, setOnetSoc] = useState(() => {
    const stored = ROLE_FAMILIES.find((f) => f.title === gaps?.roleFamily)
    return stored?.onetSoc ?? ''
  })
  const family = ROLE_FAMILIES.find((f) => f.onetSoc === onetSoc)
  // The page's `busy` is one flag for every tool on it; this section's regions speak only for a
  // request this section sent, so pressing Diagnose never draws the Gaps stages here.
  const [pending, setPending] = useState<'compare' | 'answers' | null>(null)
  async function track(kind: 'compare' | 'answers', request: Promise<void>) {
    setPending(kind)
    try {
      await request
    } finally {
      setPending(null)
    }
  }
  // R26: keyed on the document, so the sentence is there before any run and no trigger is offered.
  const gated = resume.language !== CHECK_LANGUAGE
  const stale = gaps !== undefined && gaps.reviewedFrom !== resume.addedAt
  const answered = new Set((resume.asks ?? []).map((a) => a.askId))
  const open = (gaps?.skills ?? []).filter((skill) => skill.bucket === 3 && !answered.has(gapsAskId(skill.name)))
  const ordered = [...open.filter((s) => s.inPostings), ...open.filter((s) => !s.inPostings)]
  const room = Math.max(0, GAPS_ANSWERS_AT_MOST - [...answered].filter((id) => id.startsWith('gaps-')).length)
  const cards = ordered
    .slice(0, Math.min(GAPS_OPEN_CARDS, room))
    .map((skill) => ({
      askId: gapsAskId(skill.name),
      question: `${HAVE_YOU_DONE_THIS} · ${skill.name}`,
      why: askWhy(skill, gaps?.roleFamily ?? 'this role'),
    }))
  const waiting = ordered.length - cards.length
  // R54: before a run, what Tier 0 would read, said as what will be compared.
  const compared = gaps
    ? `Compared ${comparedWith(gaps.postingsUsed, gaps.roleFamily)}.`
    : `Will compare ${comparedWith(postingsAvailable, family?.title ?? 'the role you pick')}.`

  return (
    <section aria-labelledby="gaps-heading">
      <h2 id="gaps-heading" className="font-display text-xl tracking-tight text-ink">
        What the postings ask for
      </h2>
      {(gaps || !gated) && (
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">{compared}</p>
      )}
      {gaps && (
        <p className="mt-1 text-sm text-ink-3">{`Judged by ${JUDGE_NAME[gaps.judge]}.`}</p>
      )}

      {stale && <p className="mt-2 text-sm text-ink-3">{STALE}</p>}

      {gated ? (
        <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-ink-2">{LANGUAGE_GATE_SENTENCE}</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="min-w-0">
              <label htmlFor="role-family" className="block text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                Role family
              </label>
              <select
                id="role-family"
                className="field field-boxed mt-1.5 px-3 py-2 text-[0.9375rem]"
                value={onetSoc}
                onChange={(e) => setOnetSoc(e.target.value)}
              >
                <option value="">Choose the closest role family</option>
                {ROLE_FAMILIES.map((f) => (
                  <option key={f.onetSoc} value={f.onetSoc}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={family === undefined}
              onClick={() => family && void track('compare', onRun(family.title, family.onetSoc))}
            >
              {gaps ? 'Compare again' : 'Compare'}
            </button>
          </div>

          <Working
            busy={busy && pending === 'compare'}
            className="mt-3 empty:mt-0"
            stages={STAGES}
            note={secondsNote(GAPS_SECONDS)}
          >
            {/* At rest the same measured note sits under the trigger, so the wait is known before
                the press, as C11's DiagnoseSection does. This branch is the one that draws the
                trigger, so the note needs no condition of its own (amended 2026-09-25, ledger C11). */}
            <p className="text-sm text-ink-3">{secondsNote(GAPS_SECONDS)}</p>
          </Working>
          {/* R35's empty-candidates refusal lands here too, beside the Compare it answers. */}
          <ErrorLine error={error} at="gaps" className="mt-2" />
        </>
      )}

      {gaps && gaps.skills.length > 0 && (
        <>
          <div className="mt-6 grid gap-8">
            {GROUPS.map((group) => {
              const rows = gaps.skills.filter(group.has)
              return rows.length === 0 ? null : (
                <div key={group.key}>
                  <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                    {group.heading}
                  </h3>
                  <ul className="mt-3 max-w-[70ch] border-t border-line">
                    {rows.map((skill) => (
                      <li
                        key={skill.name}
                        className="border-b border-line py-2.5 text-[0.9375rem] leading-relaxed text-ink"
                      >
                        {skill.name}
                        {rowStatements(skill, gaps.roleFamily).map((said) => (
                          <span key={said} className="mt-0.5 block text-sm text-ink-3">
                            {said}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          {/*
            A licence condition, not a courtesy: it renders wherever their rows do. The string is
            O*NET's, verbatim; the two links follow it rather than sit inside it, and their text is
            the bare URL, so nothing in the paragraph is our wording (amended 2026-09-24, ledger A6).
          */}
          <p className="mt-6 max-w-[70ch] text-sm leading-relaxed text-ink-3">
            {ONET_ATTRIBUTION}{' '}
            <a href={ONET_DATABASE_URL} className="btn-link" target="_blank" rel="noreferrer">
              onetcenter.org/database.html
            </a>{' '}
            <a href={ONET_LICENCE_URL} className="btn-link" target="_blank" rel="noreferrer">
              creativecommons.org/licenses/by/4.0
            </a>
          </p>

          {cards.length > 0 && (
            <AskHumanQueue
              // Remounted when the set of open cards changes, as DiagnoseSection's is, so its
              // inputs re-seed rather than shifting onto the card after one just answered.
              key={cards.map((c) => c.askId).join('|')}
              asks={cards}
              busy={busy && pending === 'answers'}
              headingId="gaps-ask-heading"
              // amended 2026-09-25, ledger C11: answering here only saves; nothing re-drafts.
              action="save"
              onSubmit={(answers) =>
                void track('answers', onAnswerAsk(
                  // The queue hands back question and answer; the card's stable id travels with
                  // them (R31). Each question names its skill, so it finds exactly one card.
                  answers.flatMap((a) => {
                    const card = cards.find((c) => c.question === a.question)
                    return card ? [{ askId: card.askId, question: a.question, answer: a.answer }] : []
                  }),
                ))
              }
            />
          )}
          <ErrorLine error={error} at="gaps-asks" className="mt-3" />
          {waiting > 0 && (
            <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-ink-3">
              {room > cards.length ? moreToAsk(waiting) : GAPS_ASKED_ENOUGH}
            </p>
          )}
        </>
      )}
    </section>
  )
}
