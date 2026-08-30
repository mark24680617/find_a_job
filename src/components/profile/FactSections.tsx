'use client'

import { Fragment, useState } from 'react'
import type { Fact } from '@/lib/types'
import {
  extractIdentity,
  GENERAL,
  groupByEntity,
  groupFacts,
  knownEntities,
  type Identity,
} from '@/lib/profileView'

/**
 * The human reading of the fact bank: who you are up top, the rest sorted into the sections a
 * resume would have. It is a *view* — nothing here is stored, and every fact still lives in the
 * raw table behind the toggle, which stays the honest source of truth the agent reads from.
 *
 * Presentation only: no editing happens here. A claim that needs correcting is corrected in the
 * All-facts table; because both render the same working copy, the fix shows up here on the next
 * render. Sources stay collapsed until asked for, exactly as the table does.
 *
 * Experience and Projects sub-group by entity — the company or project a fact belongs to —
 * because those are the two sections where a career of any length turns into thirty
 * undifferentiated lines, and "which of these were at Fenwick" is the question a person is
 * actually asking. Nothing else sub-groups: Contact, Education and Skills are short, and
 * splitting a five-row section by employer makes it longer to read, not shorter. A section with
 * no entity to group by renders exactly as it always did.
 */

interface Props {
  facts: Fact[]
  standardAnswers: Record<string, string>
}

/** The identity rows, in the order a person reads them — who, then where, then how to reach. */
const IDENTITY_ROWS: { key: keyof Identity; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'location', label: 'Location' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website' },
]

/** The two sections long enough that "which of these were at Fenwick" is worth answering. */
const SUB_GROUPED: readonly string[] = ['Experience', 'Projects']

export function FactSections({ facts, standardAnswers }: Props) {
  const identity = extractIdentity(facts, standardAnswers)
  const groups = groupFacts(facts)
  const rows = IDENTITY_ROWS.filter((r) => identity[r.key])
  // Read off the WHOLE bank, not one section: a company named by an Experience fact's tag is
  // still that company when a Projects claim mentions it.
  const known = knownEntities(facts)

  return (
    <div className="mt-5">
      {rows.length > 0 && (
        <div className="border border-line bg-surface">
          <div className="border-b border-line px-5 py-3">
            <h3 className="font-display text-lg tracking-tight text-ink">Identity</h3>
          </div>
          <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[7rem_1fr]">
            {rows.map((row) => (
              <Fragment key={row.key}>
                <dt className="text-sm text-ink-3">{row.label}</dt>
                <dd className="min-w-0 break-words text-[0.9375rem] text-ink">{identity[row.key]}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}

      {groups.map((group) => (
        <SectionBlock
          key={group.section}
          heading={group.section}
          facts={group.facts}
          entities={SUB_GROUPED.includes(group.section) ? known : []}
        />
      ))}
    </div>
  )
}

function SectionBlock({
  heading,
  facts,
  entities,
}: {
  heading: string
  facts: Fact[]
  /** The names this section may sub-group by. Empty means: don't. */
  entities: readonly string[]
}) {
  // Each section owns which of its rows is showing its source; only one is open at a time.
  const [openSource, setOpenSource] = useState<string | null>(null)

  const subGroups = entities.length > 0 ? groupByEntity(facts, entities) : []
  // One General group is not a grouping — it is the same list under a heading that says nothing.
  const subGrouped = subGroups.some((g) => g.entity !== GENERAL)

  return (
    <section className="mt-8">
      <h3 className="font-display text-lg tracking-tight text-ink">
        {heading}
        <span className="tnum ml-3 text-sm font-normal text-ink-3">{facts.length}</span>
      </h3>
      {subGrouped ? (
        subGroups.map((group) => (
          <div key={group.entity} className="mt-5 first:mt-4">
            {/* Quieter than the section above it and louder than a row: the entity is a shelf
                within the drawer, not another drawer. */}
            <h4 className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
              {group.entity}
              <span className="tnum ml-2.5 normal-case tracking-normal">{group.facts.length}</span>
            </h4>
            <FactRows facts={group.facts} openSource={openSource} onToggleSource={setOpenSource} />
          </div>
        ))
      ) : (
        <FactRows facts={facts} openSource={openSource} onToggleSource={setOpenSource} />
      )}
    </section>
  )
}

/** The ruled list of claims — one shape whether or not the section sub-groups. */
function FactRows({
  facts,
  openSource,
  onToggleSource,
}: {
  facts: Fact[]
  openSource: string | null
  onToggleSource: (id: string | null) => void
}) {
  return (
    <ul className="mt-3 border-t border-line-strong">
      {facts.map((fact) => {
        const expanded = openSource === fact.id
        return (
          <li key={fact.id} className="border-b border-line">
            <div className="flex items-start gap-4 py-3">
              <span className="tnum w-9 shrink-0 pt-0.5 text-sm font-medium text-accent">
                {fact.id}
              </span>
              <p className="min-w-0 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                {fact.claim.trim() || <span className="text-ink-3">Empty claim</span>}
              </p>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`org-source-${fact.id}`}
                className="btn-link shrink-0 px-2 py-0.5 text-sm"
                onClick={() => onToggleSource(expanded ? null : fact.id)}
              >
                {expanded ? 'Hide source' : 'Source'}
              </button>
            </div>
            {expanded && (
              <div id={`org-source-${fact.id}`} className="pb-4 pl-13">
                {fact.sourceSnippet ? (
                  <blockquote className="border border-line bg-surface px-4 py-3 font-display text-sm leading-relaxed text-ink-2">
                    {fact.sourceSnippet}
                  </blockquote>
                ) : (
                  <p className="text-sm text-ink-3">No source snippet — you wrote this one by hand.</p>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
