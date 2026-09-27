import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GapsResult, StoredResume } from '@/lib/types'

vi.mock('@/lib/firebase/client', () => ({ auth: {} }))
vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn(), apiDownload: vi.fn(), ApiError: class ApiError extends Error {} }))

import { GAPS_ANSWERS_AT_MOST, GAPS_OPEN_CARDS, gapsAskId, GapsSection } from '@/components/resume/GapsSection'
import { bucketSkills } from '@/lib/resume/gaps'
import { comparedWith, GAPS_ASKED_ENOUGH, HAVE_YOU_DONE_THIS, JUDGE_NAME, moreToAsk } from '@/components/resume/copy'
import { GAPS_SECONDS, secondsNote } from '@/components/resume/timings'
import { LANGUAGE_GATE_SENTENCE } from '@/lib/resume/checkSources'
import { ROLE_FAMILIES } from '@/lib/resume/onetLookup'
import { ONET_ATTRIBUTION } from '@/lib/resume/onet'

// R50: a Gaps judgement judged no bullet, and its question id is s1…sN, never the skill's name.
// R37: every row says whether a posting asked for it and whether the resume names it.
// (F2, acceptance-6) and each flag carries the text it matched, which the page quotes.
const none = { posting: null, resume: null, bank: null }
const skills: GapsResult['skills'] = [
  {
    name: 'PostgreSQL', bucket: 1, inPostings: true, namedInResume: true,
    judgement: { bulletId: '', questionId: 's1', noul: 0.93, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' },
    evidence: { posting: 'Owns the PostgreSQL fleet', resume: 'Tuned Postgres queries down from 40 seconds to 2.', bank: null },
  },
  {
    name: 'Terraform', bucket: 2, inPostings: false, namedInResume: false, judgement: null,
    evidence: { ...none, bank: 'Wrote the Terraform modules for staging' },
  },
  {
    name: 'Kubernetes', bucket: 3, inPostings: true, namedInResume: false, judgement: null,
    evidence: { ...none, posting: 'Keeps the Kubernetes clusters patched' },
  },
]
const gaps = (over: Partial<GapsResult> = {}): GapsResult => ({
  reviewedFrom: '2026-09-21T09:00:00.000Z', judge: 'jev', ranAt: '2026-09-21T09:10:00.000Z',
  roleFamily: 'Software Developers', postingsUsed: 4, onetRelease: '29.2',
  skills, ...over,
})
const resume = (over: Partial<StoredResume> = {}): StoredResume => ({
  addedAt: '2026-09-21T09:00:00.000Z', filename: 'r.pdf', bytes: 1_024,
  text: '', lines: [], sections: [], entries: [], bullets: [], language: 'en', ...over,
})
const html = (r: StoredResume, postingsAvailable = 4, busy = false) =>
  renderToStaticMarkup(
    createElement(GapsSection, {
      resume: r, postingsAvailable, busy,
      onRun: async () => {}, onAnswerAsk: async () => {},
    }),
  )

describe('GapsSection — the role family is confirmed, never inferred', () => {
  it('opens with nothing chosen, and offers the curated families', () => {
    const out = html(resume())
    expect(out).toContain('Choose the closest role family')
    expect(out).toContain(`value="${ROLE_FAMILIES[0].onetSoc}"`)
    expect(out).toContain(`>${ROLE_FAMILIES[0].title}<`)
  })
  it('renders exactly the curated families as its options, after the empty choice', () => {
    // D-18: D1's test owns the families-have-rows invariant; this one owns what is drawn.
    const values = [...html(resume()).matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])
    expect(values).toEqual(['', ...ROLE_FAMILIES.map((f) => f.onetSoc)])
  })
  it('says the language gate from the document, before any run, and offers no trigger', () => {
    // R26: keyed on `resume.language`, never on a stored result.
    const out = html(resume({ language: 'other' }))
    expect(out).toContain(LANGUAGE_GATE_SENTENCE)
    expect(out).not.toContain('Choose the closest role family')
    expect(out).not.toContain('>Compare<')
  })
})

describe('GapsSection — the real N', () => {
  // The copy is `O*NET® data`, never O*NET's (amended 2026-09-24, ledger A6).
  it('names the postings and the family, and counts one as one', () => {
    expect(comparedWith(4, 'Software Developers')).toBe(
      'from the 4 postings you saved and O*NET® data for Software Developers',
    )
    expect(comparedWith(1, 'Web Developers')).toBe(
      'from the 1 posting you saved and O*NET® data for Web Developers',
    )
  })
  it('says what it will compare before a run, and what it compared after one', () => {
    // R54: the pre-run N is what Tier 0 would read (the page passes tier0Terms(apps).postingsUsed),
    // worded prospectively; after a run, the stored N and family.
    expect(html(resume(), 7)).toContain('Will compare from the 7 postings you saved')
    expect(html(resume({ gaps: gaps() }), 7)).toContain(
      'Compared from the 4 postings you saved and O*NET® data for Software Developers.',
    )
  })
  it('never reaches for the number that is not there', () => {
    expect(html(resume({ gaps: gaps() }))).not.toContain('1000')
  })
})

describe('GapsSection — the judge', () => {
  it('names whichever judge answered, whenever a result is on screen', () => {
    // R36: the one JUDGE_NAME map in copy.ts, shared with C11 and E6.
    expect(html(resume({ gaps: gaps({ judge: 'jev' }) }))).toContain(`Judged by ${JUDGE_NAME.jev}.`)
    expect(html(resume({ gaps: gaps({ judge: 'gemini' }) }))).toContain(`Judged by ${JUDGE_NAME.gemini}.`)
    expect(html(resume())).not.toContain('Judged by')
  })
})

describe('GapsSection — the three buckets', () => {
  it('sorts each skill under a heading its bucket and flags support', () => {
    const out = html(resume({ gaps: gaps() }))
    expect(out).toContain('Evidenced in your resume')
    expect(out).toContain('PostgreSQL')
    // R38: bucket 2 is a candidate the user takes to Rewrite, not an input to it.
    expect(out).toContain('In your profile, not visible in your resume — a candidate for a rewrite')
    expect(out).toContain('Terraform')
    expect(out).toContain('Not found in your resume or profile')
    // R37: no heading claims every row came from a posting.
    expect(out).not.toContain('In the postings')
  })
  it('says a posting asked for a skill only when one did', () => {
    const inDemandOnly = resume({
      gaps: gaps({ skills: [{ name: 'Terraform', bucket: 3, inPostings: false, namedInResume: false, judgement: null, evidence: none }] }),
    })
    const out = html(inDemandOnly)
    expect(out).not.toContain('a posting you saved')
    // (F3, ledger-2) O*NET's In Demand flag, in the owner-approved wording; never "hot".
    expect(out).toContain('in demand for Software Developers in O*NET® data')
    expect(out).not.toContain('hot technology')
    // The whole sentence, subject and capital included (amended 2026-09-24, ledger A6).
    expect(out).toContain('It is in demand for Software Developers in O*NET® data, and we could not find it in your resume or your profile.')
    expect(html(resume({ gaps: gaps() }))).toContain('asked for in a posting you saved')
  })
  it('does not call a skill the resume names absent from it', () => {
    const named = resume({
      gaps: gaps({
        skills: [{
          name: 'Apache Kafka', bucket: 3, inPostings: true, namedInResume: true, judgement: null,
          evidence: { ...none, posting: 'Runs the ledger on Apache Kafka', resume: 'Moved the ledger onto Apache Kafka.' },
        }],
      }),
    })
    const out = html(named)
    expect(out).toContain('Named in your resume, with no hands-on use we could read')
    expect(out).not.toContain('Not found in your resume or profile')
    expect(out).toContain(
      'A posting you saved asks for it — “Runs the ledger on Apache Kafka”, and your resume names it — ' +
        '“Moved the ledger onto Apache Kafka.” — but nothing we could read shows hands-on use of it.',
    )
  })
  // (amended 2026-09-25, D5 fix round 1 controller ruling) Bucket 2 splits on namedInResume too.
  it('does not call a profile skill the resume names invisible in it', () => {
    const named = resume({
      gaps: gaps({
        skills: [{
          name: 'Kubernetes', bucket: 2, inPostings: true, namedInResume: true, judgement: null,
          evidence: { posting: 'Keeps the Kubernetes clusters patched', resume: 'Ran Kubernetes on call.', bank: 'Ran the Kubernetes migration' },
        }],
      }),
    })
    const out = html(named)
    expect(out).toContain('In your profile and named in your resume, with no hands-on use we could read — a candidate for a rewrite')
    expect(out).not.toContain('not visible in your resume')
  })
  it('asks about the third bucket rather than asserting an absence', () => {
    const out = html(resume({ gaps: gaps() }))
    expect(HAVE_YOU_DONE_THIS).toBe('Have you done this?')
    expect(out).toContain(`${HAVE_YOU_DONE_THIS} · Kubernetes`)
    expect(out).toContain(
      'A posting you saved asks for it — “Keeps the Kubernetes clusters patched”, and we could not find it in your resume or your profile.',
    )
    expect(out).toContain('border-amber bg-amber-soft')
    expect(out).toContain('id="gaps-ask-heading"')
    expect(out).not.toContain('you lack')
    expect(out).not.toContain('missing skill')
  })
  // (F2, final review acceptance-6) Every statement about the person's own documents is drawn with
  // the text it matched, so a false match ('go-live' read as Go) shows as one.
  it('draws each statement about the person with the text it matched', () => {
    const out = html(resume({ gaps: gaps() }))
    expect(out).toContain('asked for in a posting you saved — “Owns the PostgreSQL fleet”')
    expect(out).toContain('your resume names it — “Tuned Postgres queries down from 40 seconds to 2.”')
    expect(out).toContain('in your profile — “Wrote the Terraform modules for staging”')
    expect(out).toContain('asked for in a posting you saved — “Keeps the Kubernetes clusters patched”')
  })
  it('draws no resume heading without the line it quotes under it', () => {
    // (amended 2026-09-26, F2 fix round) The flag is the quote: a name the PDF wraps across two
    // lines is not named, so no heading says the resume names it and the card asks instead.
    const wrapped = bucketSkills({
      candidates: [{ name: 'Amazon Web Services', inDemand: false }],
      postingTerms: ['Runs the ledger on Amazon Web Services'],
      factClaims: [],
      resumeLines: ['Moved the ledger onto Amazon Web', 'Services in 2025.'],
      judgements: { 'Amazon Web Services': { bulletId: '', questionId: 's1', noul: 0.93, verdict: 'pass', model: 'jev-1.13.0', judge: 'jev' } },
    })
    const out = html(resume({ gaps: gaps({ skills: wrapped }) }))
    expect(out).not.toContain('Evidenced in your resume')
    expect(out).not.toContain('Named in your resume')
    expect(out).not.toContain('your resume names it')
    expect(out).toContain(`${HAVE_YOU_DONE_THIS} · Amazon Web Services`)
    // Where the heading is drawn, its quote is under it.
    const named = html(resume({ gaps: gaps() }))
    expect(named).toContain('Evidenced in your resume')
    expect(named).toContain('your resume names it — “Tuned Postgres queries down from 40 seconds to 2.”')
  })
  it('gives each card a stable id, and hides a card already answered', () => {
    // R31: `gaps-<skill slug>`. C, C++ and C# are three O*NET skills, so three ids.
    expect(gapsAskId('Apache Kafka')).toBe('gaps-apache-kafka')
    expect(gapsAskId('C++')).toBe('gaps-cplusplus')
    expect(gapsAskId('C#')).toBe('gaps-csharp')
    expect(gapsAskId('C')).toBe('gaps-c')
    const answered = resume({
      gaps: gaps(),
      asks: [{
        askId: 'gaps-kubernetes', question: 'Have you done this? · Kubernetes',
        answer: 'Yes, for two years.', answeredAt: '2026-09-21T09:20:00.000Z',
      }],
    })
    expect(html(answered)).not.toContain('Have you done this? · Kubernetes')
  })
})

// Final review, page-2 and acceptance-3: a family's In Demand skills and a few postings can still
// put dozens of skills in bucket 3 (F3). Every one stays listed in its bucket; the amber queue
// opens a few at a time, a posting's demand first, and stops before the shared asks list has no
// room for a rewrite's.
describe('GapsSection — how many it asks at once', () => {
  const hot = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `Hot${i + 1}`, bucket: 3 as const, inPostings: false, namedInResume: false, judgement: null, evidence: none,
    }))
  const posting = (name: string) => ({
    name, bucket: 3 as const, inPostings: true, namedInResume: false, judgement: null,
    evidence: { ...none, posting: `Needs ${name}` },
  })
  const cardCount = (out: string) => out.split(`${HAVE_YOU_DONE_THIS} · `).length - 1
  const perCard = cardCount(html(resume({ gaps: gaps() })))

  it('opens at most GAPS_OPEN_CARDS cards, a posting’s demand first, and lists every row', () => {
    const many = [...hot(12), posting('Kubernetes'), posting('Go')]
    const out = html(resume({ gaps: gaps({ skills: many }) }))
    expect(GAPS_OPEN_CARDS).toBe(10)
    expect(perCard).toBeGreaterThan(0)
    expect(cardCount(out)).toBe(GAPS_OPEN_CARDS * perCard)
    expect(out).toContain(`${HAVE_YOU_DONE_THIS} · Kubernetes`)
    expect(out).toContain(`${HAVE_YOU_DONE_THIS} · Go`)
    expect(out).toContain(`${HAVE_YOU_DONE_THIS} · Hot8`)
    expect(out).not.toContain(`${HAVE_YOU_DONE_THIS} · Hot9`)
    // Still listed in its bucket, and said to be waiting.
    expect(out).toContain('>Hot12<')
    expect(out).toContain(moreToAsk(4))
    expect(moreToAsk(1)).toBe('1 more is listed above. They come up here as you answer these.')
  })
  it('says nothing about more when every card is open', () => {
    const out = html(resume({ gaps: gaps() }))
    expect(out).not.toContain('more are listed above')
    expect(out).not.toContain(GAPS_ASKED_ENOUGH)
  })
  it('stops asking once this resume holds GAPS_ANSWERS_AT_MOST Gaps answers, and says why', () => {
    const asked = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        askId: gapsAskId(`Old${i}`), question: `${HAVE_YOU_DONE_THIS} · Old${i}`,
        answer: 'Yes.', answeredAt: '2026-09-21T09:20:00.000Z',
      }))
    // Answers from other sections do not use Gaps' share.
    const other = { askId: 'rewrite-b1-0a1b2c3d', question: 'How many?', answer: '3', answeredAt: '2026-09-21T09:20:00.000Z' }
    const near = html(resume({ gaps: gaps({ skills: hot(12) }), asks: [other, ...asked(GAPS_ANSWERS_AT_MOST - 2)] }))
    expect(cardCount(near)).toBe(2 * perCard)
    expect(near).toContain(GAPS_ASKED_ENOUGH)
    const full = html(resume({ gaps: gaps({ skills: hot(12) }), asks: asked(GAPS_ANSWERS_AT_MOST) }))
    expect(cardCount(full)).toBe(0)
    expect(full).not.toContain('border-amber bg-amber-soft')
    expect(full).toContain(GAPS_ASKED_ENOUGH)
    expect(full).toContain('>Hot1<')
  })
})

describe('GapsSection — O*NET’s licence condition', () => {
  // The licence link travels with the attribution (amended 2026-09-24, ledger A6): CC BY 4.0
  // asks for a link to the licence, and it sits beside the verbatim string, not inside it.
  const LICENCE_HREF = 'href="https://creativecommons.org/licenses/by/4.0/"'
  it('renders the attribution wherever its rows are drawn', () => {
    const out = html(resume({ gaps: gaps() }))
    expect(out).toContain(ONET_ATTRIBUTION)
    expect(out).toContain(LICENCE_HREF)
  })
  it('does not render it when there is nothing of theirs on screen', () => {
    expect(html(resume())).not.toContain(ONET_ATTRIBUTION)
    expect(html(resume())).not.toContain(LICENCE_HREF)
    expect(html(resume({ gaps: gaps({ skills: [] }) }))).not.toContain(ONET_ATTRIBUTION)
    expect(html(resume({ gaps: gaps({ skills: [] }) }))).not.toContain(LICENCE_HREF)
  })
})

// R35: there is no stored empty state to test. D6 refuses a run with nothing demanded, with the
// spec's sentence (tests/routes.resumeGaps.test.ts), and the page shows it as the run's error.
describe('GapsSection — an earlier upload', () => {
  it('says when the comparison it is showing was of an earlier upload', () => {
    const stale = resume({ addedAt: '2026-09-22T09:00:00.000Z', gaps: gaps() })
    expect(html(stale)).toContain('Reviewed against an earlier upload.')
  })
})

describe('GapsSection — another tool’s wait', () => {
  // The page's `busy` is set by every tool on it; with no press here, nothing in this section may
  // claim the work. The positive path (its own press draws the stages) needs a click, which a
  // static render cannot make; D8's live look covers it.
  it('keeps its resting note and its queue label while another section’s request runs', () => {
    const out = html(resume({ gaps: gaps() }), 4, true)
    expect(out).toContain(secondsNote(GAPS_SECONDS))
    expect(out).not.toContain('Reading the postings you saved…')
    expect(out).not.toContain('Comparing them with your resume…')
    expect(out).toContain('Save answers')
    expect(out).not.toContain('Saving…')
  })
})
