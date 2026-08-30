'use client'

import { Fragment, useState } from 'react'
import type { Fact } from '@/lib/types'
import { FactSections } from '@/components/profile/FactSections'
import { nextFactId } from '@/lib/profileView'

/**
 * The fact bank: one row per claim the agent is allowed to make about you.
 *
 * An ingest returns tens of facts from a single page of resume, so the table has to stay
 * readable at that size: source snippets are collapsed until asked for, and the editable cells
 * look like text until the pointer or the keyboard reaches them.
 *
 * Two readings of the same working copy sit behind a toggle. **Organized** is the human view —
 * an identity block and the facts sorted into resume sections, for reading. **All facts** is the
 * raw table below, the AI substrate, where every claim is edited, tagged, sourced and deleted.
 * Editing lives only in the raw table; because both views render the same `facts`, a correction
 * there shows up organized on the next render.
 *
 * Nothing here saves. Every change goes up to the page, which owns the dirty state and the PUT.
 */

type View = 'organized' | 'all'

interface Props {
  facts: Fact[]
  // Read-only, for the identity block — an ingest occasionally writes a contact detail here.
  standardAnswers: Record<string, string>
  onChange: (facts: Fact[]) => void
}

/** Grow a claim's box to its content: claims are sentences, and a truncated one can't be checked. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function FactBank({ facts, standardAnswers, onChange }: Props) {
  const [view, setView] = useState<View>('organized')
  const [openSource, setOpenSource] = useState<string | null>(null)
  // Tags round-trip through a string. Parsing on every keystroke would eat the comma the
  // moment it was typed, so the raw text is held here until the field is left.
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({})
  const [focusId, setFocusId] = useState<string | null>(null)

  const patch = (id: string, change: Partial<Fact>) =>
    onChange(facts.map((f) => (f.id === id ? { ...f, ...change } : f)))

  function addFact() {
    const id = nextFactId(facts)
    setFocusId(id)
    // Adding is an edit, so it happens in the raw table — jump there to type the new claim.
    setView('all')
    onChange([...facts, { id, claim: '', sourceSnippet: '', tags: [] }])
  }

  return (
    <section aria-labelledby="fact-bank-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="fact-bank-heading" className="font-display text-xl tracking-tight text-ink">
          Fact bank
          <span className="tnum ml-3 text-sm font-normal text-ink-3">{facts.length}</span>
        </h2>
        <div className="flex items-center gap-3">
          {facts.length > 0 && (
            <div
              role="group"
              aria-label="Fact view"
              className="inline-flex overflow-hidden rounded-[3px] border border-line"
            >
              {(['organized', 'all'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  className={`px-3 py-1.5 text-sm transition-colors ${option === 'all' ? 'border-l border-line' : ''} ${
                    view === option ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:text-ink'
                  }`}
                  onClick={() => setView(option)}
                >
                  {option === 'organized' ? 'Organized' : 'All facts'}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-quiet" onClick={addFact}>
            Add a fact
          </button>
        </div>
      </div>

      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        Every sentence the agent writes about you points at one of these. Delete anything that
        isn’t true and the agent can no longer say it.
      </p>

      {facts.length === 0 ? (
        <p className="mt-6 border border-dashed border-line px-5 py-8 text-sm text-ink-2">
          No facts yet. Add your resume above and the agent will pull them out — or write the
          first one by hand.
        </p>
      ) : view === 'organized' ? (
        <FactSections facts={facts} standardAnswers={standardAnswers} />
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-[0.9375rem]">
            <thead>
              <tr className="border-b border-line-strong text-left text-xs uppercase tracking-[0.12em] text-ink-3">
                <th scope="col" className="w-14 py-2 pr-3 font-medium">
                  Ref
                </th>
                <th scope="col" className="py-2 pr-6 font-medium">
                  Claim
                </th>
                <th scope="col" className="w-56 py-2 pr-4 font-medium">
                  Tags
                </th>
                <th scope="col" className="w-40 py-2 text-right font-medium">
                  <span className="sr-only">Source and delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {facts.map((fact) => {
                const expanded = openSource === fact.id
                return (
                  <Fragment key={fact.id}>
                    <tr className="border-b border-line align-top">
                      <td className="tnum py-3 pr-3 font-medium text-accent">{fact.id}</td>

                      <td className="py-2.5 pr-6">
                        <label className="sr-only" htmlFor={`claim-${fact.id}`}>
                          Claim for {fact.id}
                        </label>
                        <textarea
                          id={`claim-${fact.id}`}
                          rows={1}
                          autoFocus={focusId === fact.id}
                          placeholder="What is true about you?"
                          className="field leading-relaxed"
                          value={fact.claim}
                          ref={autoGrow}
                          onInput={(e) => autoGrow(e.currentTarget)}
                          onChange={(e) => patch(fact.id, { claim: e.target.value })}
                        />
                      </td>

                      <td className="py-2.5 pr-4">
                        <label className="sr-only" htmlFor={`tags-${fact.id}`}>
                          Tags for {fact.id}, comma separated
                        </label>
                        <input
                          id={`tags-${fact.id}`}
                          placeholder="backend, payments"
                          className="field text-sm text-ink-2"
                          value={tagDraft[fact.id] ?? fact.tags.join(', ')}
                          onChange={(e) =>
                            setTagDraft((d) => ({ ...d, [fact.id]: e.target.value }))
                          }
                          onBlur={(e) => {
                            patch(fact.id, {
                              tags: e.target.value
                                .split(',')
                                .map((t) => t.trim())
                                .filter(Boolean),
                            })
                            setTagDraft((d) => {
                              const next = { ...d }
                              delete next[fact.id]
                              return next
                            })
                          }}
                        />
                      </td>

                      <td className="py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={`source-${fact.id}`}
                            className="btn-link px-2 py-1.5 text-sm"
                            onClick={() => setOpenSource(expanded ? null : fact.id)}
                          >
                            {expanded ? 'Hide source' : 'Source'}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete fact ${fact.id}`}
                            className="btn btn-danger min-h-9 px-2.5 text-sm"
                            onClick={() => onChange(facts.filter((f) => f.id !== fact.id))}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="border-b border-line">
                        <td />
                        <td colSpan={3} id={`source-${fact.id}`} className="pb-4 pr-6">
                          {fact.sourceSnippet ? (
                            <blockquote className="border border-line bg-surface px-4 py-3 font-display text-sm leading-relaxed text-ink-2">
                              {fact.sourceSnippet}
                            </blockquote>
                          ) : (
                            <p className="text-sm text-ink-3">
                              No source snippet — you wrote this one by hand.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
