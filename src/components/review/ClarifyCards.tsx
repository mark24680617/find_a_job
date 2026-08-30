'use client'

import type { ClarifyAnswer, ClarifyQuestion } from '@/lib/types'

/**
 * The positioning round: before an answer is drafted, the agent asks the human the calls it
 * will not make for them — which angle to lead with, which of two true things to foreground.
 * These are amber, because amber means the same thing everywhere in this product: only you know
 * this, the agent will never guess it. Each card carries a recommended pick, already selected,
 * so the fast path is to glance and draft; the slow path is to disagree and change it.
 *
 * A card's live selection is {values, other}: the chosen option value(s), plus free text — an
 * override the human can always write in their own words, whatever the model set. For a
 * single-choice card, choosing "In my own words" is stored as the OTHER sentinel in `values` and
 * the answer is the free text alone; for a multi-choice card the free text is simply one more
 * value. The selections are unsaved UI state — they are not persisted until the human drafts with
 * them.
 */

/** Sentinel for the "Something else" radio on a single-choice card, held in `values`. */
export const OTHER = '__other__'

export interface CardState {
  /** Chosen option values; for a radio, at most one, possibly the OTHER sentinel. */
  values: string[]
  /** Free text for the own-answer field — always available, whatever the model set. */
  other: string
}

/** The initial state of one card: the human's stored answer if there is one, else the recommendation. */
export function seedCard(q: ClarifyQuestion, stored?: ClarifyAnswer): CardState {
  const optionValues = new Set(q.options.map((o) => o.value))
  if (stored) {
    // A stored answer holds option values verbatim and, at most, one string that matches no
    // option — that one is the free text the human typed.
    const reals = stored.answer.filter((v) => optionValues.has(v))
    const otherText = stored.answer.find((v) => !optionValues.has(v)) ?? ''
    if (q.allowMultiple) return { values: reals, other: otherText }
    if (reals.length > 0) return { values: [reals[0]], other: otherText }
    if (otherText) return { values: [OTHER], other: otherText }
    return { values: [], other: '' }
  }
  // No stored answer: pre-select the recommendation when it names a real option.
  return { values: optionValues.has(q.recommended) ? [q.recommended] : [], other: '' }
}

/** Seed every card at once, keyed by clarify-question id. */
export function seedSelections(
  questions: ClarifyQuestion[],
  stored: ClarifyAnswer[],
): Record<string, CardState> {
  const byId = new Map(stored.map((a) => [a.id, a]))
  return Object.fromEntries(questions.map((q) => [q.id, seedCard(q, byId.get(q.id))]))
}

/** Fold one card's live selection into the {id, question, answer} the draft route stores. */
export function toClarifyAnswer(q: ClarifyQuestion, state: CardState): ClarifyAnswer {
  const otherText = state.other.trim()
  let answer: string[]
  if (q.allowMultiple) {
    const reals = state.values.filter((v) => q.options.some((o) => o.value === v))
    answer = otherText ? [...reals, otherText] : reals
  } else if (state.values[0] === OTHER) {
    // A blank own answer must not silently drop the card — that would discard its positioning,
    // recommendation and all. Fall back to the recommendation, so the draft still gets a call.
    const reco = q.options.some((o) => o.value === q.recommended) ? [q.recommended] : []
    answer = otherText ? [otherText] : reco
  } else {
    answer = state.values.filter((v) => q.options.some((o) => o.value === v))
  }
  return { id: q.id, question: q.question, answer }
}

const RecommendedTag = () => (
  <span className="ml-2 shrink-0 rounded-[2px] border border-accent px-1.5 py-px text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-accent">
    recommended
  </span>
)

interface Props {
  questions: ClarifyQuestion[]
  /** Live selection per card, keyed by clarify-question id; missing entries fall back to the seed. */
  selections: Record<string, CardState>
  onChange: (id: string, next: CardState) => void
  busy: boolean
}

export function ClarifyCards({ questions, selections, onChange, busy }: Props) {
  return (
    <div className="grid min-w-0 gap-4">
      {questions.map((q) => {
        const state = selections[q.id] ?? seedCard(q)
        const whyId = `${q.id}-why`
        const otherId = `${q.id}-other`
        const otherOn = q.allowMultiple ? true : state.values[0] === OTHER

        function toggleMulti(value: string) {
          const has = state.values.includes(value)
          const values = has ? state.values.filter((v) => v !== value) : [...state.values, value]
          onChange(q.id, { ...state, values })
        }

        return (
          <fieldset
            key={q.id}
            disabled={busy}
            aria-describedby={q.why ? whyId : undefined}
            className="min-w-0 border border-amber bg-amber-soft px-5 py-4"
          >
            <legend className="float-left max-w-full text-[0.9375rem] font-medium leading-snug text-ink">
              {q.question}
            </legend>
            {/* legend floats, so a clearing spacer keeps the options below it */}
            <div className="clear-both" />
            {q.why !== '' && (
              <p id={whyId} className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-ink-2">
                Why it’s asking: {q.why}
              </p>
            )}

            <div className="mt-3 grid gap-2">
              {q.options.map((opt, i) => {
                const isRecommended = opt.value === q.recommended
                const checked = q.allowMultiple
                  ? state.values.includes(opt.value)
                  : state.values[0] === opt.value
                return (
                  <label
                    key={`${opt.value}-${i}`}
                    className="flex min-w-0 items-start gap-2.5 text-[0.9375rem] leading-snug text-ink"
                  >
                    <input
                      type={q.allowMultiple ? 'checkbox' : 'radio'}
                      name={q.id}
                      checked={checked}
                      onChange={() =>
                        q.allowMultiple
                          ? toggleMulti(opt.value)
                          : onChange(q.id, { ...state, values: [opt.value] })
                      }
                      style={{ accentColor: 'var(--accent)' }}
                      className="mt-[0.1875rem] h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      {opt.label}
                      {isRecommended && <RecommendedTag />}
                    </span>
                  </label>
                )
              })}

              {/* Every positioning card offers a write-your-own override, whatever the model
                  set: the recommended pick stays the fast path, this is the always-open escape. */}
              {!q.allowMultiple && (
                <label className="flex min-w-0 items-start gap-2.5 text-[0.9375rem] leading-snug text-ink">
                  <input
                    type="radio"
                    name={q.id}
                    checked={state.values[0] === OTHER}
                    onChange={() => onChange(q.id, { ...state, values: [OTHER] })}
                    style={{ accentColor: 'var(--accent)' }}
                    className="mt-[0.1875rem] h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">In my own words</span>
                </label>
              )}
            </div>

            {otherOn && (
              <div className="mt-3">
                <label htmlFor={otherId} className="sr-only">
                  Your own answer to: {q.question}
                </label>
                <input
                  id={otherId}
                  type="text"
                  value={state.other}
                  onChange={(e) => onChange(q.id, { ...state, other: e.target.value })}
                  placeholder={q.allowMultiple ? 'Something else — in your words' : 'In your words'}
                  className="field field-boxed px-3 py-2 text-[0.9375rem] leading-relaxed"
                />
              </div>
            )}
          </fieldset>
        )
      })}
    </div>
  )
}
