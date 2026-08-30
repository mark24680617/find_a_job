'use client'

import type { VoiceRule } from '@/lib/types'

/**
 * Voice rules are not written here — they are distilled from the edits the candidate makes to
 * a draft, and applied to every draft after that. So the list is read-only apart from delete:
 * the only meaningful correction is "the agent learned the wrong thing about how I write".
 */

interface Props {
  rules: VoiceRule[]
  onChange: (rules: VoiceRule[]) => void
}

/** `2026-08-27T09:14:00Z` -> `27 Aug 2026`. Unparseable stamps are shown as they were stored. */
function shortDate(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function VoiceRules({ rules, onChange }: Props) {
  return (
    <section aria-labelledby="voice-rules-heading">
      <h2 id="voice-rules-heading" className="font-display text-xl tracking-tight text-ink">
        Voice rules
        <span className="chip ml-3 align-middle font-sans">Optional</span>
        {rules.length > 0 && (
          <span className="tnum ml-3 text-sm font-normal text-ink-3">{rules.length}</span>
        )}
      </h2>

      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        Learned from your edits, not written by you. Each one carries the change it came from.
      </p>

      {rules.length === 0 ? (
        <p className="mt-6 border border-dashed border-line px-5 py-8 text-sm text-ink-2">
          Nothing learned yet. Rewrite a draft answer and the agent works out what you changed —
          shorter sentences, fewer adjectives, real numbers — then writes that way next time.
        </p>
      ) : (
        <ul className="mt-5 border-t border-line-strong">
          {rules.map((rule, i) => (
            <li
              key={`${rule.createdAt}-${i}`}
              className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-line py-4"
            >
              <div className="min-w-[20ch] flex-1">
                <p className="text-[0.9375rem] leading-relaxed text-ink">{rule.rule}</p>
                <p className="mt-1.5 max-w-[70ch] font-display text-sm leading-relaxed text-ink-2">
                  {rule.evidence}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tnum text-xs text-ink-3">{shortDate(rule.createdAt)}</span>
                <button
                  type="button"
                  aria-label={`Delete voice rule: ${rule.rule}`}
                  className="btn btn-danger min-h-9 px-2.5 text-sm"
                  onClick={() => onChange(rules.filter((_, j) => j !== i))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
