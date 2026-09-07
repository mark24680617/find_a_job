import { normalizeWs, QUOTE_CAP } from '@/lib/research/quotes'
import type { Cited, Quoted, TakeHomeGuide } from '@/lib/types'

/**
 * What a take-home guide may not do, checked in code after the model has done its part — the
 * same discipline as the process map's guard and the brief's citation check. The guide's whole
 * claim is that its three kinds of sentence stay apart: the brief's own words, what people
 * report, and a plan that is ours and cites nothing. Two of those three are checkable, and this
 * is where they are checked.
 *
 * Some rules reject and some repair, and which is which follows the process map's reasoning: a
 * rejection costs the candidate another model call and, in the end, the whole guide, so it is
 * kept for the things that make the guide untrustworthy as a whole — a citation onto a source
 * we never handed over, a plan so long it is not a plan, a guide that never says what the
 * assignment is. A single unsupported sentence is dropped instead; the other nine tenths of the
 * guide are still worth reading, and the candidate is waiting.
 *
 * A repaired **copy** comes back rather than a repair in place, because the caller needs both:
 * the copy is what ships, and the model's own unrepaired output is what goes back to it in the
 * correction.
 */

/**
 * The guide as the run assembles it: the five fields the model writes, and none of the ones the
 * run adds around them (`sources`, `guides`, `grounded`, `plannedFrom`, `plannedAt`). It is
 * declared here, beside the function whose argument and return type it is, exactly as
 * `SynthesizedMap` is declared in `src/lib/research/guard.ts` — which is also what keeps this
 * module pure: a guard that had to import the shape of its own parameter from `@/ai` would have
 * an edge back into the flow layer for no reason. `src/ai/flows/takeHomeSynthesize.ts`
 * re-exports it, so a caller may import it from either side.
 */
export type SynthesizedGuide = Pick<
  TakeHomeGuide,
  'brief' | 'reported' | 'plan' | 'askRecruiter' | 'caveats'
>

/** Long enough to plan four days of work; past that it is a transcript, not a plan. */
const MAX_PLAN_STEPS = 12

export function guardTakeHomeGuide(
  guide: SynthesizedGuide,
  sourceIds: Set<string>,
  briefText: string,
): { guide: SynthesizedGuide; problems: string[] } {
  const problems: string[] = []
  const haystack = normalizeWs(briefText)

  /**
   * A sentence about the brief survives only when the brief really says it: a quote that is
   * empty (every text contains one), longer than a quote may be, or not in the brief at all
   * takes its sentence down with it. Both sides are normalised — a brief pasted from an email
   * wraps where the mail client wrapped it, and the model's copy of a sentence does not.
   */
  const quoted = (items: Quoted[]): Quoted[] =>
    items.filter((item) => {
      const quote = normalizeWs(item.quote)
      return quote !== '' && quote.length <= QUOTE_CAP && haystack.includes(quote)
    })

  /**
   * A "reported" sentence with no ids is a sentence nobody reported, so it goes. One that names
   * an id we never handed over is a different failure — the model invented a source rather than
   * forgetting to cite — and that is worth telling it about, so it is a problem and the item is
   * left where it is for the correction to show.
   *
   * The ids that survive are deduplicated, because the count under a sentence is what a reader
   * weighs it by: one digest named twice is one person saying it, not two. Repaired here, where
   * the record is written, so every later reader of the stored guide counts it the same way.
   */
  const cited = (items: Cited[]): Cited[] =>
    items.flatMap((item) => {
      for (const id of item.sourceIds) {
        if (!sourceIds.has(id)) {
          problems.push(`${JSON.stringify(item.text)} cites ${id}, which was not provided`)
        }
      }
      if (item.sourceIds.length === 0) return []
      return [{ ...item, sourceIds: [...new Set(item.sourceIds)] }]
    })

  const timeLimit = guide.brief.timeLimit ? quoted([guide.brief.timeLimit])[0] : undefined

  if (normalizeWs(guide.brief.task) === '') {
    problems.push('brief.task is empty; restate the assignment in one paragraph, in your words')
  }
  if (guide.plan.length > MAX_PLAN_STEPS) {
    problems.push(`the plan has ${guide.plan.length} steps; at most ${MAX_PLAN_STEPS} are allowed`)
  }

  return {
    guide: {
      brief: {
        task: guide.brief.task,
        ...(timeLimit ? { timeLimit } : {}),
        deliverables: quoted(guide.brief.deliverables),
        constraints: quoted(guide.brief.constraints),
        evaluation: quoted(guide.brief.evaluation),
      },
      reported: {
        tasks: cited(guide.reported.tasks),
        evaluation: cited(guide.reported.evaluation),
        pitfalls: cited(guide.reported.pitfalls),
        time: cited(guide.reported.time),
      },
      plan: guide.plan,
      askRecruiter: guide.askRecruiter,
      caveats: guide.caveats,
    },
    // One invented id cited from four places is one thing to fix, not four.
    problems: [...new Set(problems)],
  }
}
