import type { RoundType } from '@/lib/types'

/**
 * What each round is called in front of a person. The stored values are slugs the model
 * writes; these are the words that go on a card and into a calendar entry, and they live
 * here rather than in a component because the .ics route needs the same ones.
 */
export const ROUND_LABEL: Record<RoundType, string> = {
  'recruiter-screen': 'Recruiter screen',
  technical: 'Technical',
  behavioral: 'Behavioral',
  panel: 'Panel',
  onsite: 'Onsite',
  other: 'Interview',
}

/** `Sat 5 Sep, 10:00` in the reader's own zone — the only zone an interview matters in. */
export function formatWhen(iso: string | undefined): string {
  const at = Date.parse(iso ?? '')
  if (Number.isNaN(at)) return ''
  return new Date(at).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
