'use client'

import type { ResearchSource } from '@/lib/types'

/** Titles and hosts, as links. Used inline under a stage and in the footer of the section. */
export function SourceList({ sources }: { sources: ResearchSource[] }) {
  if (sources.length === 0) return null
  return (
    <ul className="grid gap-1 text-sm">
      {sources.map((s) => (
        <li key={s.id} className="flex min-w-0 items-baseline gap-x-2">
          <span className="tnum shrink-0 text-xs text-accent">{s.id}</span>
          <a href={s.url} target="_blank" rel="noreferrer" className="btn-link min-w-0 truncate">
            {s.title}
          </a>
          <span className="shrink-0 text-ink-3">{s.host}</span>
        </li>
      ))}
    </ul>
  )
}
