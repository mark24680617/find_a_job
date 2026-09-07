'use client'

import { useEffect, useRef, useState } from 'react'
import { Working } from '@/components/Working'
import { AskRecruiter } from '@/components/process/AskRecruiter'
import { SourceList } from '@/components/process/SourceList'
import { ApiError, apiFetch } from '@/lib/apiFetch'
// `SectionLock` comes from the same pure module as the floor. The lock itself is the page's, and
// the assignment section reads the same type from the same place: a union declared in either
// component, or in the page, would have the three files importing each other in a ring.
import { MIN_BRIEF_CHARS, type BriefInUse, type SectionLock } from '@/lib/assignment'
import { dateOnly } from '@/lib/dates'
import { readable } from '@/lib/readable'
import type { Cited, InterviewRound, Quoted, ResearchSource } from '@/lib/types'

/**
 * The plan: what the brief asks for, what people report about this company's take-home, and a
 * way through the days between.
 *
 * Three states — not planned, planning, planned — and one rule that shapes all of the third:
 * three kinds of sentence are kept visibly apart, because they are true in three different ways.
 * A brief item is true because the brief says so, and carries the brief's own words under it. A
 * reported item is true because somebody wrote it down, and counts the sources that did. The plan
 * is ours, cites nothing, and says so under itself. Nothing on screen may borrow another kind's
 * authority, which is why none of the three is rendered without the thing that backs it.
 *
 * The guard has already dropped every quote that is not in the brief and every "reported"
 * sentence nobody reported, and the route has already refused a plan drawn from a brief that
 * moved underneath the run. So this side decides nothing about the guide: it draws the record,
 * says what is happening while a minute passes, and puts the keyboard where the reading starts.
 */

/*
 * The wait, told as the run actually goes: four grounded searches, then the community, then up to
 * twelve pages read three at a time, then one long synthesis. The lines advance on a clock
 * because the flows report nothing in between — an honest account of the work rather than a
 * progress bar.
 *
 * The clock is set from the runs we have measured rather than from the twelve reads the estimate
 * was built for: four live plans in `docs/superpowers/smoke/2026-09-06-take-home/` finished in
 * 18, 17, 17 and 6 seconds, because the read step finds five or six pages worth opening and not
 * twelve. A wait that over-states itself by three times is a wait somebody walks away from.
 */
const PLAN_STAGES = [
  { at: 0, text: 'Starting the searches…' },
  { at: 3_000, text: 'Searching for what people report…' },
  { at: 8_000, text: 'Reading the best write-ups…' },
  { at: 14_000, text: 'Laying out the plan…' },
]
const PLAN_NOTE = 'Usually takes under half a minute.'

/**
 * The two reasons the button cannot be pressed. They are different facts and say different
 * things: one is about the brief, and the way out of it is to add a real one; the other is about
 * a request already in flight, and the way out of it is to wait.
 */
const TOO_SHORT = 'The notice is too short to plan from — add the brief.'
const READING = 'Wait for the brief to be read.'
/**
 * The 409. The route re-reads the round after the run and refuses when the brief in use is no
 * longer the one the plan was drawn from — somebody added a brief in another tab while this one
 * was searching. Ours is the sentence rather than the server's: the server's is a log line, and
 * what a person needs to know is that nothing was lost and the way on is one click.
 */
const CHANGED = 'The brief changed while the plan was being drawn — plan again.'
/**
 * A 200 whose body carries no plan. The route answers with the round as stored, so this is the
 * shape of a run that wrote nothing — and it is a failure however cheerful the status was.
 */
const NO_PLAN = 'The plan did not come back — plan again.'

/**
 * The tail of the dated line. A plan the search came back empty from says so in words rather
 * than counting to nothing, and where this says `without sources` the `All {n} sources`
 * disclosure at the foot is not rendered at all: a disclosure that opens on an empty list
 * promises evidence there is none of.
 */
function fromSources(n: number): string {
  return n === 0 ? 'without sources' : `from ${n} ${n === 1 ? 'source' : 'sources'}`
}

interface Props {
  appId: string
  round: InterviewRound
  /** The employer. Three lines here name it, and nothing on a round carries it. */
  company: string
  /** Which text is the brief, decided once by the page and handed to both sections. */
  brief: BriefInUse
  /** Shared with the assignment section: only one of the two may be working at a time. */
  lock: SectionLock
  setLock: (l: SectionLock) => void
  /** The route answers with the round as stored; the page replaces its copy with that one. */
  onRound: (round: InterviewRound) => void
}

export function TakeHomeSection({ appId, round, company, brief, lock, setLock, onRound }: Props) {
  const [error, setError] = useState('')
  /** Set just before the state update that re-renders, and read once by the effect below. */
  const focusPlanned = useRef(false)
  const plannedRef = useRef<HTMLParagraphElement>(null)

  const guide = round.takeHome
  // The lock is the busy flag. Only this section ever sets `'planning'`, so a second copy of the
  // same fact held locally would be a second copy that can disagree with the page's.
  const planning = lock === 'planning'
  // A read in flight is asked about first, because the ordinary way a brief gets added is a
  // notice too short to plan from and a real brief on its way in: told in the other order, the
  // section would spend those seconds asking for the brief somebody is in the middle of adding.
  // In the planned state neither can be the floor — a plan only exists for a brief long enough to
  // draw one from, and storing a brief deletes the plan — so there the read is the only arm that
  // ever fires. Both are written anyway: one expression, whichever state we are in.
  const blocked = lock === 'reading' ? READING : brief.text.length < MIN_BRIEF_CHARS ? TOO_SHORT : ''

  // Focus follows the answer rather than the click: the plan replaces most of the section, and
  // leaving the keyboard on a button that has just been taken away strands it at the top of the
  // document. A ref rather than state, and no dependency list — the instruction is one-shot, set
  // just before the state update that re-renders and cleared by the first effect after it. An
  // effect that cleared it with `setState` would both cost a second render and be exactly the
  // synchronous set-in-effect the lint forbids. Nothing moves on the first render.
  useEffect(() => {
    if (!focusPlanned.current) return
    focusPlanned.current = false
    plannedRef.current?.focus()
  })

  async function plan() {
    // The assignment section's panel is frozen while this runs, and this is the same refusal from
    // the other side: one of the two sections works at a time, and the lock is how each knows.
    if (lock !== null) return
    setLock('planning')
    setError('')
    try {
      const next = await apiFetch<InterviewRound>(
        `/api/applications/${appId}/interviews/${round.id}/take-home`,
        { method: 'POST' },
      )
      // A 200 carrying no plan is a failed plan, whatever the status said. Taking the round
      // anyway would replace the one on screen with a copy that has nothing new in it and leave
      // the section back at its resting offer, as though nobody had pressed anything.
      if (!next.takeHome) {
        setError(NO_PLAN)
        return
      }
      // Set before the state that re-renders, so the effect above runs after the render that put
      // the line it is reaching for on screen.
      focusPlanned.current = true
      onRound(next)
    } catch (err) {
      // Recognised by the status and never by the message: the wording is the server's to change.
      if (err instanceof ApiError && err.status === 409) {
        setError(CHANGED)
        return
      }
      // Everything else keeps the server's own sentence, which is written for the reader — the
      // 400s here say exactly what was refused, and a 422 says why the plan could not be drawn.
      // The plan on screen, if there was one, is untouched: the route leaves the old one stored.
      setError(
        readable(err instanceof Error ? err.message : '') || 'The plan couldn’t be drawn. Try again.',
      )
    } finally {
      setLock(null)
    }
  }

  return (
    <section aria-labelledby="plan-heading" className="mt-10">
      <h2 id="plan-heading" className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
        The plan
      </h2>

      {!guide && !planning && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <p className="max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-2">
            Reads the brief, searches for what people report about {company}’s take-home, and lays
            out a plan inside its limits.
          </p>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={blocked !== ''}
            onClick={() => void plan()}
          >
            Plan the take-home
          </button>
          {blocked !== '' && <span className="text-sm text-ink-3">{blocked}</span>}
          <span className="text-sm text-ink-3">Takes under half a minute.</span>
        </div>
      )}

      {error !== '' && (
        <p role="alert" className="mt-3 max-w-[62ch] text-sm text-danger">
          {error}
        </p>
      )}

      {/*
        The wait sits above the plan rather than in place of it. `Working` swaps its children out
        while busy, so a guide handed to it as `children` would blank the minute of reading
        somebody was part-way through and then announce every block of the new one at once. The
        region carries the four status lines and nothing else; the plan already on screen stays
        where it is, still true until a better one replaces it. Mounted whatever is happening —
        a status region that arrives already carrying its message is not announced.
      */}
      <Working busy={planning} className="mt-3 empty:mt-0" stages={PLAN_STAGES} note={PLAN_NOTE} />

      {guide && (
        <div className="mt-3 grid gap-10">
          <div className="text-sm text-ink-3">
            {!guide.grounded && (
              <p className="mb-1 max-w-[62ch] text-ink-2">
                The web could not be reached — this is drawn from the brief alone.
              </p>
            )}
            {/*
              Belt and braces. The route re-reads the round and refuses a plan whose brief moved
              under it, so this line should be unreachable — but a plan that describes a document
              the reader has since replaced is the one thing on this screen that would be quietly
              wrong, and a line costs nothing next to that.
            */}
            {guide.plannedFrom !== brief.identity && (
              <p className="mb-1 max-w-[62ch] text-ink-2">Planned from an earlier brief — plan again.</p>
            )}
            <p ref={plannedRef} tabIndex={-1}>
              Planned {dateOnly(guide.plannedAt)} {fromSources(guide.sources.length)}
              {' · '}
              <button
                type="button"
                className="btn-link"
                disabled={planning || blocked !== ''}
                onClick={() => void plan()}
              >
                Plan again
              </button>
              {blocked !== '' && <> · {blocked}</>}
            </p>
          </div>

          <div className="min-w-0">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
              What the brief asks for
            </h3>
            <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink">
              {guide.brief.task}
            </p>
            <QuotedList title="Deliverables" items={guide.brief.deliverables} />
            <QuotedList title="Constraints" items={guide.brief.constraints} />
            <QuotedList title="How it will be judged" items={guide.brief.evaluation} />
          </div>

          <div className="min-w-0">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
              What people report about {company}’s take-home
            </h3>
            {/*
              A take-home nobody has written about is the ordinary case — the three real map runs
              say `no` once and `unknown` twice — so the empty state is a plain sentence rather
              than four empty headings. Saying it out loud is also the only way a reader can tell
              a thin search from a broken one.
            */}
            <Reported
              company={company}
              sources={guide.sources}
              lists={[
                { title: 'What others were given', items: guide.reported.tasks },
                { title: 'What reviewers look for', items: guide.reported.evaluation },
                { title: 'Why people say they were rejected', items: guide.reported.pitfalls },
                { title: 'How long it takes', items: guide.reported.time },
              ]}
            />
          </div>

          {/* An empty plan is a promise the model did not keep; the line under it would then be
              claiming authorship of nothing. */}
          {guide.plan.length > 0 && (
            <div className="min-w-0">
              <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">A plan</h3>
              {guide.brief.timeLimit && (
                <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
                  Within: {guide.brief.timeLimit.text}
                </p>
              )}
              <ol className="mt-2 grid max-w-[62ch] gap-2.5">
                {guide.plan.map((step, i) => (
                  <li key={`${step.step}-${i}`} className="grid gap-x-3 sm:grid-cols-[2rem_minmax(0,1fr)]">
                    {/* The list numbers itself for assistive tech; this is the same number, set
                        the way the stage ledger sets its own. */}
                    <span className="tnum text-[0.9375rem] text-accent" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] leading-relaxed text-ink">{step.step}</p>
                      {step.budget && <p className="tnum mt-0.5 text-sm text-ink-3">{step.budget}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-sm text-ink-3">Suggested — not from any source.</p>
            </div>
          )}

          <AskRecruiter items={guide.askRecruiter} />

          <div className="text-sm text-ink-3">
            {guide.caveats.length > 0 && (
              <ul className="grid max-w-[62ch] gap-1">
                {guide.caveats.map((c, i) => (
                  <li key={`${c}-${i}`}>{c}</li>
                ))}
              </ul>
            )}
            {/* `All {n} sources` keeps the plural at one, which the per-item disclosures above
                and the `Planned … from {n} sources` line do not: this is the fixed label the
                process section already carries at the foot of a map, and the two screens saying
                it differently would be the odder thing. */}
            {guide.sources.length > 0 && (
              <details className="faq mt-3">
                <summary className="btn-link inline cursor-pointer">
                  All {guide.sources.length} sources
                </summary>
                <div className="mt-2">
                  <SourceList sources={guide.sources} />
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * A list whose every item rests on the brief's own words. The sentence is the model's reading;
 * the span under it is the brief, verbatim and checked in code, set the way the rehearsal lines
 * on a prep brief are set — a rule down the side and the reading serif, because it is a quotation
 * and should look like one. The prefix says whose words they are, since the reported lists below
 * quote nobody.
 *
 * A list with nothing in it is not rendered: an empty heading is a promise the model did not
 * keep, and the guard drops a quote it could not find rather than paraphrasing one.
 */
function QuotedList({ title, items }: { title: string; items: Quoted[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-4">
      <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">{title}</h4>
      <ul className="mt-2 grid gap-3">
        {items.map((item, i) => (
          <li key={`${item.quote}-${i}`} className="max-w-[62ch]">
            <p className="text-[0.9375rem] leading-relaxed text-ink">{item.text}</p>
            <p className="mt-1 border-l-2 border-line-strong pl-4 font-display text-[0.9375rem] leading-relaxed text-ink-2">
              <span className="font-sans text-sm text-ink-3">The brief:</span> {item.quote}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The four reported lists, or the one sentence that stands for all of them. Each item counts the
 * sources behind it and hands them over on the same disclosure the stage ledger uses — the count
 * is the claim's weight, and opening it is how a reader checks the claim rather than trusting it.
 * A source id that resolves to nothing shows nothing: "two sources" with nobody behind it is the
 * one thing this product may not say.
 */
function Reported({
  company,
  sources,
  lists,
}: {
  company: string
  sources: ResearchSource[]
  lists: { title: string; items: Cited[] }[]
}) {
  if (lists.every((list) => list.items.length === 0)) {
    return (
      <p className="mt-2 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">
        Nobody has written about {company}’s take-home that the search could find.
      </p>
    )
  }
  return (
    <>
      {lists.map(({ title, items }) =>
        items.length === 0 ? null : (
          <div key={title} className="mt-4">
            <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">{title}</h4>
            <ul className="mt-2 grid gap-3">
              {items.map((item, i) => {
                // The sources this item rests on, each of them once: an id repeated is one
                // person saying it twice, and the count under the sentence is its weight. Read
                // off the sources rather than off the ids, the way the process map reads its
                // own — which is also what keeps an id resolving to nothing out of the count.
                const ids = new Set(item.sourceIds)
                const cited = sources.filter((s) => ids.has(s.id))
                return (
                  <li key={`${item.text}-${i}`} className="max-w-[62ch]">
                    <p className="text-[0.9375rem] leading-relaxed text-ink">{item.text}</p>
                    {cited.length > 0 && (
                      <details className="faq mt-1 text-sm">
                        <summary className="btn-link inline cursor-pointer">
                          {cited.length} {cited.length === 1 ? 'source' : 'sources'}
                        </summary>
                        <div className="mt-2">
                          <SourceList sources={cited} />
                        </div>
                      </details>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ),
      )}
    </>
  )
}
