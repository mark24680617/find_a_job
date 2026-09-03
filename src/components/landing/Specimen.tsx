'use client'

import { useState } from 'react'

/**
 * The mechanism, felt rather than described: a drafted answer with three underlined phrases,
 * and the fact behind whichever one is under the pointer. Real DOM, not a picture, because the
 * point is that a citation can be followed. The candidate is the sample world's — a visitor who
 * later loads the sample data meets the same person.
 *
 * A mouse selects on arrival, a finger or a keyboard selects on activation, and nothing clears —
 * the panel stays for reading. Selecting on arrival and toggling on activation would cancel each
 * other out: a tap sends a pointer enter of its own and then a click, so the fact would appear and
 * vanish again inside one gesture, and at the keyboard Tab would show the fact that Enter then
 * took away.
 */

type FactId = 'f7' | 'f8' | 'f9'

const FACTS: Record<FactId, { claim: string; source: string }> = {
  f7: {
    claim: 'Owns the payments service at Northwind Logistics, which handles 12,000 requests a day at a 99.95% success rate',
    source: 'Owns the payments service: 12,000 requests/day at a 99.95% success rate.',
  },
  f8: {
    claim: 'Cut p99 checkout latency from 840ms to 210ms by batching ledger writes',
    source: 'Cut p99 checkout latency from 840ms to 210ms by batching ledger writes.',
  },
  f9: {
    claim: 'Led the migration of 14 services from RabbitMQ to Kafka',
    source: 'Led the migration of 14 services from RabbitMQ to Kafka.',
  },
}

export function Specimen() {
  const [active, setActive] = useState<FactId | null>(null)

  // An inline `<span role="button">` and a text underline, exactly as the workspace's own
  // citations are drawn — see `CitationText`. A real `<button>` is an inline-block box: a
  // phrase this long would be moved whole onto its own line rather than breaking across two,
  // and centred there by the UA default, which pulls the cited words out of the sentence they
  // belong to. A span flows as body text, so the underline tracks the words and the sentence
  // stays intact, while still answering the pointer and the keyboard.
  const cite = (id: FactId, text: string) => (
    <span
      role="button"
      tabIndex={0}
      data-fact={id}
      aria-pressed={active === id}
      // A touch sends a pointer enter of its own just before the click — a genuine one, typed
      // `touch`; the emulated events are the mouse ones that follow it. So arrival only selects
      // when the pointer is a real mouse, which can hover without committing to anything.
      //
      // No `aria-label`: an accessible name would replace these words rather than describe them,
      // and a screen reader would read the instruction in the middle of the drafted sentence.
      // The phrase names itself, and `role="button"` already says it can be operated.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setActive(id)
      }}
      onFocus={() => setActive(id)}
      onClick={() => setActive(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.key === ' ') e.preventDefault()
          setActive(id)
        }
      }}
      className={`inline cursor-pointer rounded-[2px] underline decoration-accent decoration-dotted decoration-1 underline-offset-[3px] transition-colors hover:bg-accent-soft ${
        active === id ? 'bg-accent-soft decoration-solid' : ''
      }`}
    >
      {text}
    </span>
  )

  const fact = active ? FACTS[active] : null

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_15rem] md:items-start md:gap-6">
      <div className="min-w-0">
        <p className="text-sm text-ink-3">Tell us about a system you own.</p>
        <p className="mt-2 max-w-[58ch] font-display text-[1.0625rem] leading-relaxed text-ink">
          I own the payments service at Northwind Logistics, which{' '}
          {cite('f7', 'handles 12,000 requests a day at a 99.95% success rate')}. Last year I{' '}
          {cite('f8', 'cut p99 checkout latency from 840ms to 210ms')} by batching ledger writes, and{' '}
          {cite('f9', 'led the migration of 14 services from RabbitMQ to Kafka')} without a
          customer-visible incident.
        </p>
        <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-ink-2">
          Nothing without an underline is a claim about the candidate. Everything with one can be
          checked.
        </p>
      </div>

      <aside aria-live="polite" className="min-w-0 border border-line bg-surface px-4 py-4">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Source</p>
        {fact ? (
          <div className="mt-2">
            <p className="tnum text-xs text-accent">{active}</p>
            <p className="mt-1 font-display text-[0.9375rem] leading-relaxed text-ink">{fact.claim}</p>
            <p className="mt-2 border-t border-line pt-2 text-sm leading-relaxed text-ink-2">“{fact.source}”</p>
          </div>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-ink-3">
            Select an underlined phrase to see the fact it’s drawn from.
          </p>
        )}
      </aside>
    </div>
  )
}
