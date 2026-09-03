import { FlowOutputError, generateStructured, type GenerateCall, type Part } from '@/ai/genkit'
import { buildProcessSynthesizePrompt, type ProcessSynthesizePromptInput } from '@/ai/prompts/processSynthesize'
import { ProcessSynthesizeOutSchema, type ProcessSynthesizeOut } from '@/ai/schemas'
import { guardProcessMap, type SynthesizedMap } from '@/lib/research/guard'

/**
 * This is the judgment call of the feature: reconciling five searches and six write-ups into
 * one ordered loop, deciding what is reported and what is merely usual, and citing each
 * stage to what actually says so. The highest budget any flow here gets.
 */
const THINKING_BUDGET = 2048

/** Nullable on the wire, optional on the record — the shape the rest of the product uses. */
function toMap(out: ProcessSynthesizeOut): SynthesizedMap {
  return {
    stages: out.stages.map((s) => ({
      order: s.order, name: s.name, kind: s.kind, format: s.format,
      ...(s.duration ? { duration: s.duration } : {}),
      whatItProbes: s.whatItProbes, tips: s.tips, sourceIds: s.sourceIds, confidence: s.confidence,
    })),
    takeHome: {
      present: out.takeHome.present, description: out.takeHome.description,
      ...(out.takeHome.timeBudget ? { timeBudget: out.takeHome.timeBudget } : {}),
      tips: out.takeHome.tips, sourceIds: out.takeHome.sourceIds,
    },
    ...(out.timeline ? { timeline: out.timeline } : {}),
    askRecruiter: out.askRecruiter,
    caveats: out.caveats,
  }
}

const correction = (previous: ProcessSynthesizeOut, problems: string[]): Part => ({
  text: [
    'Your previous map was rejected.',
    '',
    'What you wrote:',
    JSON.stringify(previous),
    '',
    'What was wrong with it:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Draw the loop again, fixing every point above. Cite only the source ids you were given.',
  ].join('\n'),
})

/** All the evidence in — the loop out, guarded once, corrected once, refused after that. */
export async function runProcessSynthesize(input: ProcessSynthesizePromptInput, generate?: GenerateCall): Promise<SynthesizedMap> {
  const { system, parts } = buildProcessSynthesizePrompt(input)
  const ids = new Set(input.sourceIds)
  const opts = { system, schema: ProcessSynthesizeOutSchema, thinkingBudget: THINKING_BUDGET }

  // The map the guard saw is the map that ships: one of its rules walks an uncited "no" on
  // the take-home back to "unknown" in place, and a second `toMap` of the same output would
  // hand the reader the sentence the guard just withdrew.
  const first = await generateStructured({ ...opts, parts }, generate)
  const firstMap = toMap(first)
  const firstProblems = guardProcessMap(firstMap, ids)
  if (firstProblems.length === 0) return firstMap

  const second = await generateStructured({ ...opts, parts: [...parts, correction(first, firstProblems)] }, generate)
  const secondMap = toMap(second)
  const secondProblems = guardProcessMap(secondMap, ids)
  if (secondProblems.length === 0) return secondMap

  throw new FlowOutputError(`processSynthesize: the map failed its guard twice: ${secondProblems.join('; ')}`)
}
