/**
 * Which kind of loop to expect, read off the job title. The family steers two of the five
 * search queries and the synthesis's sense of what is usual — a coding round is ordinary for
 * an engineer and would be odd for an account director. ML is tested before engineering
 * because "ML Engineer" is an ML loop, not a generic engineering one.
 */
export type RoleFamily = 'software engineering' | 'data science / ML' | 'product' | 'design' | 'general'

const RULES: [RegExp, RoleFamily][] = [
  [/machine learning|\bml\b|data scien|research scientist|\bai\b/i, 'data science / ML'],
  [/software|engineer|developer|\bsde\b|\bswe\b|programmer/i, 'software engineering'],
  [/product manager|\bpm\b|product owner/i, 'product'],
  [/designer|\bux\b|\bui\b/i, 'design'],
]

export function roleFamily(role: string): RoleFamily {
  for (const [pattern, family] of RULES) if (pattern.test(role)) return family
  return 'general'
}
