'use client'

import { dateOnly } from '@/lib/dates'
import type { ProcessMap } from '@/lib/types'

/**
 * The write-ups we read, each reduced to what a candidate should take from it: the points,
 * the questions people report being asked, and at most two lines in the writer's own words —
 * checked verbatim against the page, which is why they may be shown as quotes at all.
 */
export function GuideList({ map }: { map: ProcessMap }) {
  if (map.guides.length === 0) return null
  const byId = new Map(map.sources.map((s) => [s.id, s]))
  return (
    <div className="grid gap-6 divide-y divide-line border-y border-line">
      {map.guides.map((g) => {
        const source = byId.get(g.sourceId)
        if (!source) return null
        return (
          <article key={g.sourceId} className="min-w-0 pt-6 first:pt-0 pb-6 last:pb-0">
            <h4 className="text-[1.0625rem] font-medium text-ink">
              <a href={source.url} target="_blank" rel="noreferrer" className="btn-link">
                {source.title}
              </a>
            </h4>
            {/*
              Three facts about the write-up rather than one warning about all of them. An
              undated page and an old page are different things to know, and a prep site's
              summary is a different thing again from somebody's own account.

              Both qualifiers are written so a guide saved before either rule existed reads
              correctly. Such a guide has no `firstHand` at all — absent is not "no", so only
              a literal false says "second-hand" — and its `stale` was computed when undated
              counted as old, so "may be out of date" needs a date to be out of date from.
            */}
            <p className="mt-1 text-sm text-ink-3">
              {source.host}
              {source.publishedAt ? <> · {dateOnly(source.publishedAt)}</> : <> · date not stated</>}
              {source.publishedAt && g.stale && <> · may be out of date</>}
              {g.firstHand === false && <> · second-hand</>}
            </p>
            <ul className="mt-3 grid max-w-[62ch] gap-1 text-[0.9375rem] leading-relaxed text-ink-2">
              {g.takeaways.map((t, i) => (
                <li key={`${t}-${i}`} className="flex gap-2">
                  <span aria-hidden="true" className="text-ink-3">–</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            {g.questionsReported.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Questions they were asked</p>
                <ul className="mt-1.5 grid max-w-[62ch] gap-1 text-[0.9375rem] leading-relaxed text-ink">
                  {g.questionsReported.map((q, i) => (
                    <li key={`${q}-${i}`}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            {g.quotes.slice(0, 2).map((q, i) => (
              <p key={`${q}-${i}`} className="mt-3 max-w-[58ch] border-t border-line pt-2 text-sm leading-relaxed text-ink-2">
                “{q}”
              </p>
            ))}
          </article>
        )
      })}
    </div>
  )
}
