'use client'

/**
 * Amber, because it means what amber means everywhere here: only a person can settle this.
 * These are the questions the evidence left open, to put to the recruiter before the first
 * round.
 */
export function AskRecruiter({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="min-w-0 border border-amber bg-amber-soft px-5 py-4">
      {/* A heading, like the four blocks beside it, so heading navigation reaches this one too. */}
      <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-amber">Ask the recruiter</h3>
      <ul className="mt-2 grid gap-1.5">
        {items.map((q, i) => (
          <li key={`${q}-${i}`} className="max-w-[58ch] text-[0.9375rem] leading-snug text-ink">
            {q}
          </li>
        ))}
      </ul>
    </div>
  )
}
