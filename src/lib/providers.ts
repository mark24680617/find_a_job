/**
 * Firebase names sign-in providers by id; people are told what they sign in with. Only the
 * two this app switches on get a name — anything else is shown as its id rather than a
 * guess. The password provider is the one that decides what the account page offers: a
 * password and an email can only be changed on an account that has a password.
 */

export const PASSWORD_PROVIDER = 'password'

const LABEL: Record<string, string> = {
  'google.com': 'Google',
  [PASSWORD_PROVIDER]: 'Email and password',
}

export function providerLabel(id: string): string {
  if (id === '') return '—'
  return LABEL[id] ?? id
}

export function hasPasswordProvider(ids: string[]): boolean {
  return ids.includes(PASSWORD_PROVIDER)
}
