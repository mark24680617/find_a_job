/**
 * Whether a string the server threw is safe to show a person.
 *
 * `apiFetch` throws whatever the API said. A route that fails before it can map the failure
 * answers with the framework's own HTML error page rather than our `{ error }` JSON, so a
 * message that looks like markup — or is simply too long to be a sentence — is not one a
 * reader should ever see. This returns the trimmed message when it is showable and an empty
 * string when it is not, so a caller supplies its own fallback: `readable(msg) || 'Try again.'`
 *
 * Lifted out of the profile vault and the wizard's source step — the review screen is the
 * third place that takes raw server messages and owes the reader the same protection.
 */
export function readable(msg: string): string {
  const message = msg.trim()
  if (!message || message.length > 200 || /<[a-z!/]/i.test(message)) return ''
  return message
}
