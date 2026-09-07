import type { RoleFamily } from '@/lib/research/roleFamily'

/**
 * The five searches, decided here and not by the model, so a run is reproducible and the
 * synthesis is the only place judgment happens. The company is always quoted — an unquoted
 * name like "Stripe" or "Notion" drifts into the product, not the employer — and the fifth
 * query is about the role family alone, for a company nobody has written about.
 */
export interface PlannedQuery {
  id: string
  query: string
  intent: 'process' | 'experience' | 'questions' | 'take-home' | 'guide' | 'feedback'
}

/** Double quotes inside a name would end the phrase early; they are dropped, not escaped. */
const phrase = (s: string) => `"${s.replace(/"/g, '').trim()}"`

export function planQueries(company: string, role: string, family: RoleFamily, year: number): PlannedQuery[] {
  const c = phrase(company)
  return [
    { id: 'q1', query: `${c} ${phrase(role)} interview process`, intent: 'process' },
    { id: 'q2', query: `${c} interview experience ${family}`, intent: 'experience' },
    { id: 'q3', query: `${c} interview questions ${family}`, intent: 'questions' },
    { id: 'q4', query: `${c} take home assignment interview`, intent: 'take-home' },
    { id: 'q5', query: `${family} interview loop guide ${year}`, intent: 'guide' },
  ]
}

/**
 * The four searches a take-home run makes. Same discipline as above and one difference of
 * emphasis: the third asks for feedback and rejections by name, because what a candidate
 * cannot get from the brief is how the thing was judged, and that is the sentence people write
 * only when it went badly. The fourth is about the role family alone, for a company nobody has
 * written a word about — which, on the three real process-map runs, is most of them.
 */
export function planTakeHomeQueries(company: string, family: RoleFamily, year: number): PlannedQuery[] {
  const c = phrase(company)
  return [
    { id: 'q1', query: `${c} take home assignment ${family}`, intent: 'take-home' },
    { id: 'q2', query: `${c} take-home interview experience`, intent: 'experience' },
    // "take home" is quoted for the same reason the company is: unquoted it drifts onto
    // working from home, which is a different thing people write about far more often.
    { id: 'q3', query: `${c} "take home" feedback rejected`, intent: 'feedback' },
    { id: 'q4', query: `${family} take home assignment what reviewers look for ${year}`, intent: 'guide' },
  ]
}
