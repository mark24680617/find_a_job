import type { AppStatus, Application, TimelineEvent } from '@/lib/types'

/**
 * Where a record has got to, and what that means for the screen it is drawn on.
 *
 * The application page is one screen serving five stages: a draft is answers being written, an
 * interviewing record is a loop being run, an offer or a rejection is neither. What the page
 * shows follows from the status, so the decisions are made here rather than inline — pure, and
 * readable for every stage in a test, instead of inferred from a rendered page.
 */

/** The stages past applying — the answers were sent; what matters now is the loop. */
export function pastApplying(status: AppStatus): boolean {
  return status === 'interviewing' || status === 'offer' || status === 'rejected'
}

/**
 * "What to expect" is drawn only while the loop is being run. Before that there is no loop to
 * research yet, and after it the research is about rounds that have already happened.
 */
export function showsProcess(status: AppStatus): boolean {
  return status === 'interviewing'
}

/**
 * The PATCH "Log an interview" sends before the intake opens: a draft or applied record moves to
 * interviewing, with the same timeline event the board writes for that move — one history, in one
 * wording, whichever surface made the move. Null for a record already there or past it: nothing
 * to move, and an offer or a rejection must never be dragged back into the loop.
 */
export function logInterviewPatch(
  app: Pick<Application, 'status' | 'timeline'>,
  at = new Date().toISOString(),
): { status: 'interviewing'; timeline: TimelineEvent[] } | null {
  if (app.status !== 'draft' && app.status !== 'applied') return null
  return {
    status: 'interviewing',
    timeline: [...app.timeline, { event: 'status → interviewing', at }],
  }
}
