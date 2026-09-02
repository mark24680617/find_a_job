'use client'

import type { Question } from '@/lib/types'

/**
 * The form's questions, as a ruled list you move through — a catalogue drawer, not a wall of
 * cards. Each row carries only what tells you where you are: the question, the length it has to
 * hit, and where the answer stands. Amber marks a row the agent is still waiting on you for,
 * because amber means that one thing throughout.
 */

interface Props {
  questions: Question[]
  selected: number
  onSelect: (index: number) => void
  /** Open the intake to read more questions onto the end of the list, without re-parsing. */
  onAddQuestion: () => void
}

const STATUS: Record<Question['status'], { label: string; dot: string }> = {
  // pending is a hollow ring — nothing written; final is pine — saved. Drafted sits between.
  pending: { label: 'Not started', dot: 'border border-field-line' },
  drafted: { label: 'Drafted', dot: 'bg-ink-3' },
  final: { label: 'Final', dot: 'bg-accent' },
}

function constraintChip(q: Question): string | null {
  const { limit, unit } = q.constraints
  if (limit !== undefined && unit !== undefined) return `≤${limit} ${unit}`
  if (q.constraints.type === 'file') return 'file'
  return null
}

export function QuestionList({ questions, selected, onSelect, onAddQuestion }: Props) {
  return (
    <nav aria-label="Questions" className="self-start border border-line bg-surface">
      <h2 className="flex items-baseline justify-between border-b border-line px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">Questions</span>
        <span className="tnum text-xs text-ink-3">{questions.length}</span>
      </h2>
      <ul className="divide-y divide-line">
        {questions.map((q, i) => {
          const active = i === selected
          const status = STATUS[q.status]
          const chip = constraintChip(q)
          const needsYou = q.askHuman.some((a) => !a.answer?.trim())
          return (
            <li key={i}>
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(i)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                  active ? 'bg-accent-soft' : 'hover:bg-canvas'
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${status.dot}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[0.9375rem] leading-snug text-ink">{q.q}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="sr-only">{status.label}. </span>
                    {chip && (
                      <span className="chip tnum">
                        {chip}
                      </span>
                    )}
                    {needsYou && <span className="text-xs font-medium text-amber">needs you</span>}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-line px-4 py-3">
        <button type="button" className="btn-link text-sm" onClick={onAddQuestion}>
          Add a question
        </button>
      </div>
    </nav>
  )
}
