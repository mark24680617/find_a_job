import type { ProcessStage, TakeHome } from '@/lib/types'

/**
 * What the synthesis may not do, checked in code after the model has done its part — the
 * same discipline as the citation guard on a draft. A stage that cites a source we never
 * handed over, a confident stage nobody reported, a take-home asserted on no evidence: each
 * is a sentence the reader would trust for the wrong reason, so each is a rejection the flow
 * carries back to the model once, and a failure after that.
 *
 * One rule repairs the map instead of rejecting it — the take-home's uncited "no", for the
 * reason given where it is applied. So the caller has to go on with the object it handed in
 * rather than a second copy of the model's output.
 */
export interface SynthesizedMap {
  stages: ProcessStage[]
  takeHome: TakeHome
  timeline?: string
  askRecruiter: string[]
  caveats: string[]
}

export function guardProcessMap(map: SynthesizedMap, sourceIds: Set<string>): string[] {
  const problems: string[] = []
  if (map.stages.length === 0) problems.push('the loop has no stages')
  map.stages.forEach((stage, i) => {
    if (stage.order !== i + 1) {
      problems.push(`stage ${JSON.stringify(stage.name)} is numbered ${stage.order}; it should be ${i + 1}`)
    }
    for (const id of stage.sourceIds) {
      if (!sourceIds.has(id)) problems.push(`stage ${JSON.stringify(stage.name)} cites ${id}, which was not provided`)
    }
    if (stage.sourceIds.length === 0 && stage.confidence !== 'inferred') {
      problems.push(`stage ${JSON.stringify(stage.name)} cites no source, so its confidence must be "inferred"`)
    }
    if (stage.sourceIds.length > 0 && stage.confidence === 'inferred') {
      problems.push(`stage ${JSON.stringify(stage.name)} cites sources, so it is not "inferred"`)
    }
  })
  for (const id of map.takeHome.sourceIds) {
    if (!sourceIds.has(id)) problems.push(`the take-home cites ${id}, which was not provided`)
  }
  if (map.takeHome.present === 'yes' && map.takeHome.sourceIds.length === 0) {
    problems.push('the take-home is said to exist but no source says so; use "unknown" or cite one')
  }
  // The mirror of the rule above: prompt rule 3 lets "no" stand only on a source that says
  // there is none or walks the whole loop without one, so an uncited "no" was reasoned from
  // silence, which the same rule forbids. It is walked back rather than rejected because
  // "unknown" is already the honest word for it and the other six fields of the map are
  // fine — a rejection would cost the reader all of them over one. The asymmetry that used
  // to make this the more dangerous of the two is gone now that the section shows a "no"
  // and what it rests on: an uncited one would be a verdict with nothing under it.
  if (map.takeHome.present === 'no' && !map.takeHome.sourceIds.some((id) => sourceIds.has(id))) {
    map.takeHome = { present: 'unknown', description: '', tips: [], sourceIds: [] }
    map.caveats = [...map.caveats, 'No source says there is no take-home, so whether there is one is unknown.']
  }
  return [...new Set(problems)]
}
