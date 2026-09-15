/**
 * A date with no time on it, for the account overview and the admin table — when someone
 * joined, when they were last here. `Date.parse` takes both ISO and the UTC string Firebase
 * puts on user metadata, so callers pass whichever they have. Locale and zone are options
 * so a test can pin the output; the screens pass neither and get the reader's own.
 */
export function dateOnly(
  when: string | null | undefined,
  opts: { locale?: string; timeZone?: string } = {},
): string {
  if (!when) return '—'
  const ms = Date.parse(when)
  if (Number.isNaN(ms)) return '—'
  return new Date(ms).toLocaleDateString(opts.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: opts.timeZone,
  })
}

/**
 * Today's calendar date in UTC, as `YYYY-MM-DD` — what the draft and clarify routes put in front
 * of the model, so a tenure still running is measured to now rather than to whatever "now" the
 * model assumes. UTC on purpose, unlike the letterhead's local `todayIso`: this is read by a
 * server, and a day either way does not move a duration measured in years.
 */
export function utcToday(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}
