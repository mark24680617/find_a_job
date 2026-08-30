'use client'

import {
  STANDARD_FIELDS,
  REMOTE_OPTIONS,
  NOTICE_OPTIONS,
  UNKNOWN,
  parseField,
  serializeField,
  type StandardField,
  type StdValue,
  type NoticeOption,
  type MoneyPeriod,
} from '@/lib/standardFields'

/**
 * The answers only the candidate can give: work authorization, notice period, salary. The ingest
 * writes "UNKNOWN" whenever the resume does not state one, and the whole point of this section is
 * that UNKNOWN is a visible, answerable thing rather than a silently empty field.
 *
 * Each answer has a *type* — a yes/no, a date, a salary — so it is offered the right control
 * instead of a blank box. Storage does not change: every control reads and writes one canonical
 * string on `profile.standardAnswers` (still `Record<string,string>`), so the PUT is untouched and
 * `profileIngest` keeps writing plain strings. A stored value that does not fit its kind falls
 * back to a plain text box so nothing is ever dropped. The type map and the pure parse/serialize
 * functions live in `@/lib/standardFields`; the keys and their order come from STANDARD_KEYS, not
 * from a copy of the list.
 */

interface Props {
  answers: Record<string, string>
  onChange: (answers: Record<string, string>) => void
}

/** Boxed controls (date, select, number, free text) — a visible field the pointer reads as one. */
const BOX =
  'w-full rounded-[3px] border border-field-line bg-surface px-2.5 py-1.5 text-sm text-ink transition-colors hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-55'

/** Radios and checkboxes, tinted pine so a chosen option carries the "grounded" accent. */
const TICK = 'h-4 w-4 shrink-0 accent-[var(--accent)]'

/** `custom_key` -> `Custom key` — only for the stray keys an ingest invents outside the eight. */
function humanize(key: string): string {
  const words = key.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function StandardAnswers({ answers, onChange }: Props) {
  const standardKeys: string[] = STANDARD_FIELDS.map((f) => f.key)
  // The eight standard fields first and always, then any stray key an ingest happened to add.
  const extras = Object.keys(answers).filter((k) => !standardKeys.includes(k))

  const unanswered =
    STANDARD_FIELDS.filter((f) => parseField(f.kind, answers[f.key] ?? UNKNOWN).type === 'unknown')
      .length + extras.filter((k) => isBlankExtra(answers[k])).length
  const total = STANDARD_FIELDS.length + extras.length

  return (
    <section aria-labelledby="standard-answers-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="standard-answers-heading" className="font-display text-xl tracking-tight text-ink">
          Standard answers
        </h2>
        {unanswered > 0 && (
          <p className="tnum text-sm text-ink-3">
            {unanswered} of {total} unanswered
          </p>
        )}
      </div>

      <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        Only you know this — the agent will never guess it. Anything left as{' '}
        <span className="font-medium text-amber">Unknown</span> becomes a question it asks you
        instead of a sentence it invents.
      </p>

      <dl className="mt-5 border-t border-line-strong">
        {STANDARD_FIELDS.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            stored={answers[field.key] ?? UNKNOWN}
            onStore={(stored) => onChange({ ...answers, [field.key]: stored })}
          />
        ))}
        {extras.map((key) => (
          <ExtraRow
            key={key}
            fieldKey={key}
            value={answers[key] ?? ''}
            onStore={(stored) => onChange({ ...answers, [key]: stored })}
          />
        ))}
      </dl>
    </section>
  )
}

function isBlankExtra(value: string | undefined): boolean {
  return value === undefined || value === UNKNOWN || value.trim() === ''
}

function FieldRow({
  field,
  stored,
  onStore,
}: {
  field: StandardField
  stored: string
  onStore: (stored: string) => void
}) {
  const value = parseField(field.kind, stored)
  const unanswered = value.type === 'unknown'
  const labelId = `sa-label-${field.key}`

  return (
    <div className="grid gap-x-6 gap-y-2 border-b border-line py-3.5 sm:grid-cols-[15rem_1fr] sm:items-start">
      <dt className="sm:pt-1.5">
        <span id={labelId} className="text-sm font-medium text-ink-2">
          {field.label}
        </span>
      </dt>
      <dd className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <Control field={field} value={value} labelId={labelId} onStore={onStore} />
        </div>
        {unanswered ? (
          <span className="shrink-0 bg-amber-soft px-2 py-0.5 text-xs font-medium tracking-wide text-amber">
            Only you know this
          </span>
        ) : (
          <button
            type="button"
            className="shrink-0 text-sm text-ink-3 underline-offset-4 hover:text-ink hover:underline"
            onClick={() => onStore(UNKNOWN)}
          >
            Clear
          </button>
        )}
      </dd>
    </div>
  )
}

interface ControlProps {
  field: StandardField
  value: StdValue
  labelId: string
  onStore: (stored: string) => void
}

function Control({ field, value, labelId, onStore }: ControlProps) {
  // A stored value that does not fit its kind (an old free-text answer, something an ingest
  // wrote) is shown verbatim so it is never lost. Emptying it hands the field back to its typed
  // control by way of the UNKNOWN state.
  if (value.type === 'text') {
    return (
      <div>
        <input
          className={BOX}
          aria-labelledby={labelId}
          value={value.text}
          onChange={(e) => onStore(e.target.value === '' ? UNKNOWN : e.target.value)}
        />
        <p className="mt-1 text-xs text-ink-3">Saved as free text — clear it to pick from the options.</p>
      </div>
    )
  }

  switch (field.kind) {
    case 'yesno': {
      const current = value.type === 'yesno' ? value.value : null
      return (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {(['Yes', 'No'] as const).map((opt) => (
            <label key={opt} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name={`sa-${field.key}`}
                className={TICK}
                checked={current === opt}
                onChange={() => onStore(serializeField({ type: 'yesno', value: opt }))}
              />
              {opt}
            </label>
          ))}
        </div>
      )
    }

    case 'yesno_note': {
      const choice = value.type === 'reloc' ? value.value : null
      const note = value.type === 'reloc' ? value.note : ''
      const write = (c: 'Yes' | 'No' | 'Depends', n: string) =>
        onStore(serializeField({ type: 'reloc', value: c, note: n }))
      return (
        <div className="grid gap-2">
          <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {(['Yes', 'No', 'Depends'] as const).map((opt) => (
              <label key={opt} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={`sa-${field.key}`}
                  className={TICK}
                  checked={choice === opt}
                  onChange={() => write(opt, note)}
                />
                {opt}
              </label>
            ))}
          </div>
          {choice && (
            <input
              className={`${BOX} sm:max-w-[24rem]`}
              aria-label={`${field.label} — detail`}
              placeholder="Add a detail (optional)"
              value={note}
              onChange={(e) => write(choice, e.target.value)}
            />
          )}
        </div>
      )
    }

    case 'multiselect': {
      const selected = value.type === 'multiselect' ? value.values : []
      const toggle = (opt: (typeof REMOTE_OPTIONS)[number]) => {
        const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]
        onStore(serializeField({ type: 'multiselect', values: next }))
      }
      return (
        <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {REMOTE_OPTIONS.map((opt) => (
            <label key={opt} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className={TICK}
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
              />
              {opt}
            </label>
          ))}
        </div>
      )
    }

    case 'date': {
      const isAsap = value.type === 'asap'
      const dateVal = value.type === 'date' ? value.value : ''
      return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <input
            type="date"
            className={`${BOX} w-auto`}
            aria-labelledby={labelId}
            value={dateVal}
            disabled={isAsap}
            onChange={(e) =>
              onStore(e.target.value ? serializeField({ type: 'date', value: e.target.value }) : UNKNOWN)
            }
          />
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className={TICK}
              checked={isAsap}
              onChange={(e) => onStore(e.target.checked ? 'ASAP' : UNKNOWN)}
            />
            As soon as possible
          </label>
        </div>
      )
    }

    case 'select': {
      const current =
        value.type === 'notice' ? value.value : value.type === 'notice_other' ? 'Other' : ''
      const otherText = value.type === 'notice_other' ? value.text : ''
      const onSelect = (v: string) => {
        if (v === '') onStore(UNKNOWN)
        else if (v === 'Other') onStore(serializeField({ type: 'notice_other', text: '' }))
        else onStore(serializeField({ type: 'notice', value: v as NoticeOption }))
      }
      return (
        <div className="grid gap-2">
          <select
            className={`${BOX} w-full sm:w-auto`}
            aria-labelledby={labelId}
            value={current}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">—</option>
            {NOTICE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value="Other">Other</option>
          </select>
          {value.type === 'notice_other' && (
            <input
              className={`${BOX} sm:max-w-[24rem]`}
              aria-label={`${field.label} — detail`}
              placeholder="e.g. gardening leave until November"
              value={otherText}
              onChange={(e) => onStore(serializeField({ type: 'notice_other', text: e.target.value }))}
            />
          )}
        </div>
      )
    }

    case 'money': {
      const amount = value.type === 'money' ? value.amount : null
      const period: MoneyPeriod = value.type === 'money' ? value.period : 'year'
      return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="inline-flex items-center gap-1.5">
            <span className="text-sm text-ink-2">$</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              className={`${BOX} w-32`}
              aria-labelledby={labelId}
              placeholder="0"
              value={amount === null ? '' : String(amount)}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === '') return onStore(UNKNOWN)
                const n = Number(raw)
                if (Number.isFinite(n)) onStore(serializeField({ type: 'money', amount: n, period }))
              }}
            />
          </div>
          <select
            className={`${BOX} w-auto`}
            aria-label={`${field.label} — period`}
            value={period}
            disabled={amount === null}
            onChange={(e) =>
              amount !== null &&
              onStore(serializeField({ type: 'money', amount, period: e.target.value as MoneyPeriod }))
            }
          >
            <option value="year">per year</option>
            <option value="hour">per hour</option>
          </select>
        </div>
      )
    }
  }
}

/**
 * The stray keys outside the eight — whatever an ingest invented — keep the original quiet text
 * field: read as text until you reach for it, cleared back to UNKNOWN when emptied.
 */
function ExtraRow({
  fieldKey,
  value,
  onStore,
}: {
  fieldKey: string
  value: string
  onStore: (stored: string) => void
}) {
  const unknown = isBlankExtra(value)
  return (
    <div className="grid gap-x-6 gap-y-2 border-b border-line py-3.5 sm:grid-cols-[15rem_1fr] sm:items-start">
      <dt className="sm:pt-1.5">
        <label htmlFor={`answer-${fieldKey}`} className="text-sm font-medium text-ink-2">
          {humanize(fieldKey)}
        </label>
      </dt>
      <dd className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          id={`answer-${fieldKey}`}
          className={`field min-w-0 flex-1 ${unknown ? 'text-ink-3' : ''}`}
          placeholder="Only you know this"
          value={unknown ? '' : value}
          onChange={(e) => onStore(e.target.value)}
          // Clearing must restore the UNKNOWN signal, not store an empty string — an empty
          // string reads as "answered with nothing".
          onBlur={(e) => (e.target.value.trim() === '' && !unknown ? onStore(UNKNOWN) : undefined)}
        />
        {unknown ? (
          <span className="shrink-0 bg-amber-soft px-2 py-0.5 text-xs font-medium tracking-wide text-amber">
            Only you know this
          </span>
        ) : (
          <button
            type="button"
            className="shrink-0 text-sm text-ink-3 underline-offset-4 hover:text-ink hover:underline"
            onClick={() => onStore(UNKNOWN)}
          >
            Clear
          </button>
        )}
      </dd>
    </div>
  )
}
