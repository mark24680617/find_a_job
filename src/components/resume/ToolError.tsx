/**
 * Where a failed request's sentence is drawn (final review, page-5). The page is long — the
 * Diagnose table, Gaps' rows, the rewrite cards — and one alert above the upload card left a
 * press that failed looking like a press that did nothing. So the page records which control
 * sent the request, and the section that owns that control draws the sentence beside it.
 */
export type ErrorAt =
  | 'upload'
  | 'diagnose'
  | 'diagnose-asks'
  | 'gaps'
  | 'gaps-asks'
  | 'rewrite'
  | 'rewrite-asks'
  | `accept-${string}`

export type ToolError = { at: ErrorAt; text: string } | null

/** The sentence, beside the control named `at`, or nothing when the failure was elsewhere. */
export function ErrorLine({ error, at, className = '' }: { error?: ToolError; at: ErrorAt; className?: string }) {
  if (!error || error.at !== at) return null
  return (
    <p role="alert" className={`max-w-[62ch] text-sm text-danger${className ? ` ${className}` : ''}`}>
      {error.text}
    </p>
  )
}
