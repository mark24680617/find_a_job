import type { AppStatus, Application, TimelineEvent } from '@/lib/types'

/**
 * The decisions the application page makes about where a record has got to, and the one the
 * board makes about where a move leaves the person.
 *
 * The application page is one screen serving five stages: a draft is answers being written, an
 * interviewing record is a loop being run, an offer or a rejection is neither. What the page
 * shows follows from the status, so the decisions are made here rather than inline — pure, and
 * readable for every stage in a test, instead of inferred from a rendered page. Where a board
 * move lands, and whether an address asks for the intake, are the same kind of decision made
 * about the same stages, so they are read the same way.
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

/**
 * Where a move on the board leaves the person. Saying a record is being interviewed is almost
 * always saying an interview has just been arranged, and the notice for it is sitting in an
 * inbox — so that one move goes on to the application, carrying `log=1` to ask for the intake.
 * Every other move is bookkeeping that finishes on the board, and stays there.
 */
export function afterBoardMove(next: AppStatus, id: string): string | null {
  return next === 'interviewing' ? `/applications/${id}?log=1` : null
}

/**
 * Whether an address asks for the notice intake. The page reads it once, when its state is
 * created: the flag is a request to open the box on arrival, not a record of whether the box
 * is open — so closing it does not have to rewrite the address, and a reload of an address
 * that says `log=1` opens an empty intake, which is what it says.
 */
export function intakeOpenFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('log') === '1'
}
