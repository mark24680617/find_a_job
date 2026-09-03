'use client'

import Link from 'next/link'
import { SourceList } from '@/components/process/SourceList'
import { mapRoundToStage, STAGE_LABEL } from '@/lib/processMap'
import { formatWhen, ROUND_LABEL } from '@/lib/rounds'
import type { InterviewRound, ProcessMap, ProcessStage } from '@/lib/types'

/**
 * The loop as a ledger: numbered, ruled, no cards. Each stage says what it is, what it probes
 * and how people say to prepare, and either counts the sources that report it or says it is
 * inferred. A logged round is pinned under the stage it maps to — where you are, on the map
 * of where everyone goes.
 */

interface Props {
  map: ProcessMap
  rounds: InterviewRound[]
  appId: string
}

function StageRow({ stage, map, rounds, appId }: Props & { stage: ProcessStage }) {
  const sources = map.sources.filter((s) => stage.sourceIds.includes(s.id))
  const pinned = rounds.filter((r) => mapRoundToStage(r, rounds, map)?.order === stage.order)
  const meta = [stage.format === 'unknown' ? '' : stage.format, stage.duration ?? ''].filter(Boolean).join(' · ')
  return (
    <li className="grid gap-x-6 gap-y-3 py-5 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
      <span className="tnum font-display text-lg text-accent" aria-hidden="true">
        {String(stage.order).padStart(2, '0')}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h4 className="text-[1.0625rem] font-medium text-ink">{stage.name}</h4>
          <span className="chip uppercase tracking-[0.12em]">{STAGE_LABEL[stage.kind]}</span>
          {meta && <span className="text-sm text-ink-3">{meta}</span>}
        </div>
        <p className="mt-1.5 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-2">{stage.whatItProbes}</p>
        {stage.tips.length > 0 && (
          <ul className="mt-2 grid max-w-[62ch] gap-1 text-[0.9375rem] leading-relaxed text-ink-2">
            {stage.tips.map((t, i) => (
              <li key={`${t}-${i}`} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-3">–</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-sm">
          {stage.confidence === 'inferred' || sources.length === 0 ? (
            <span className="text-ink-3">inferred</span>
          ) : (
            <details className="faq">
              <summary className="btn-link inline cursor-pointer">
                {sources.length} {sources.length === 1 ? 'source' : 'sources'}
              </summary>
              <div className="mt-2">
                <SourceList sources={sources} />
              </div>
            </details>
          )}
        </div>
        {pinned.map((r) => (
          <p key={r.id} className="mt-3 text-sm">
            <Link href={`/applications/${appId}/interviews/${r.id}`} className="btn-link font-medium text-accent">
              Your {ROUND_LABEL[r.roundType]}
            </Link>
            {formatWhen(r.datetime) && <span className="tnum text-ink-2"> · {formatWhen(r.datetime)}</span>}
          </p>
        ))}
      </div>
    </li>
  )
}

export function StageLedger({ map, rounds, appId }: Props) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {map.stages.map((stage) => (
        <StageRow key={stage.order} stage={stage} map={map} rounds={rounds} appId={appId} />
      ))}
    </ol>
  )
}
