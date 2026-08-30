/** What every adapter returns once a posting URL has been resolved to text. */
export interface FetchedPosting {
  company: string
  role: string
  jdText: string
  adapter: string
}

/** What the pure parse functions return; the caller stamps on which adapter produced it. */
export type ParsedPosting = Omit<FetchedPosting, 'adapter'>

/**
 * Thrown when a posting cannot be fetched for a reason the user can act on. `reason` is
 * shown verbatim in the UI, so it says what happened and what to do about it — never a
 * stack trace or a status code on its own.
 */
export class FetchBlockedError extends Error {
  constructor(public reason: string) {
    super(reason)
    this.name = 'FetchBlockedError'
  }
}

/** Everything the user can do about a blocked fetch is the same thing. */
export const PASTE_INSTEAD = 'paste the job description text instead'
