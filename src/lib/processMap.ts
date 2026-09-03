import type { InterviewRound, ProcessMap, ProcessStage, StageKind } from '@/lib/types'

/**
 * Where a logged round sits on the reported loop. Rounds and stages share their kinds, so a
 * round claims the first stage of its kind that an earlier-logged round has not already
 * taken — two coding rounds land on the first and second coding stages in the order they
 * were booked. An "other" round claims nothing: the notice could not say what it was, and
 * guessing a place for it would be guessing.
 */
export const STAGE_LABEL: Record<StageKind, string> = {
  'recruiter-screen': 'Recruiter screen',
  technical: 'Technical',
  'system-design': 'System design',
  behavioral: 'Behavioral',
  panel: 'Panel',
  onsite: 'Onsite',
  'take-home': 'Take-home',
  other: 'Other',
}

export function mapRoundToStage(round: InterviewRound, rounds: InterviewRound[], map: ProcessMap): ProcessStage | null {
  if (round.roundType === 'other') return null
  const claimed = new Set<number>()
  const ordered = [...rounds].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const r of ordered) {
    if (r.roundType === 'other') continue
    const stage = map.stages.find((s) => s.kind === r.roundType && !claimed.has(s.order))
    if (!stage) {
      if (r.id === round.id) return null
      continue
    }
    claimed.add(stage.order)
    if (r.id === round.id) return stage
  }
  return null
}

export function stagePosition(stage: ProcessStage, map: ProcessMap): string {
  return `Stage ${stage.order} of ${map.stages.length}`
}

export function nextStage(stage: ProcessStage, map: ProcessMap): ProcessStage | null {
  return map.stages.find((s) => s.order === stage.order + 1) ?? null
}
