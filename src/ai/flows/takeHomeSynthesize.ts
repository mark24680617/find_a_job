import { FlowOutputError, generateStructured, type GenerateCall, type Part } from '@/ai/genkit'
import {
  buildTakeHomeSynthesizePrompt,
  type TakeHomeSynthesizePromptInput,
} from '@/ai/prompts/takeHomeSynthesize'
import { TakeHomeSynthesizeOutSchema, type TakeHomeSynthesizeOut } from '@/ai/schemas'
import { guardTakeHomeGuide, type SynthesizedGuide } from '@/lib/research/takeHomeGuard'

/**
 * The judgment call of this feature: reading one brief closely enough to quote it correctly,
 * reconciling what strangers report about the same assignment, and laying out a plan that fits
 * inside the brief's own limits — while keeping those three kinds of sentence apart. The same
 * budget the process map's synthesis gets, for the same reason.
 */
const THINKING_BUDGET = 2048

// The guide's shape lives with the guard that checks it, as `SynthesizedMap` lives in
// `src/lib/research/guard.ts`. Re-exported here because this flow is what produces one, and a
// caller holding the flow should not have to know which module the type was declared in.
export type { SynthesizedGuide } from '@/lib/research/takeHomeGuard'

/**
 * Nullable on the wire, optional on the record — the shape the rest of the product uses, and
 * the shape the guard checks. A stored `timeLimit: null` would render as an empty quotation
 * under "Within:", and a stored `budget: null` as a blank column beside a step.
 */
function toGuide(out: TakeHomeSynthesizeOut): SynthesizedGuide {
  return {
    brief: {
      task: out.brief.task,
      ...(out.brief.timeLimit ? { timeLimit: out.brief.timeLimit } : {}),
      deliverables: out.brief.deliverables,
      constraints: out.brief.constraints,
      evaluation: out.brief.evaluation,
    },
    reported: out.reported,
    plan: out.plan.map((s) => ({ step: s.step, ...(s.budget ? { budget: s.budget } : {}) })),
    askRecruiter: out.askRecruiter,
    caveats: out.caveats,
  }
}

const correction = (previous: TakeHomeSynthesizeOut, problems: string[]): Part => ({
  text: [
    'Your previous guide was rejected.',
    '',
    'What you wrote:',
    JSON.stringify(previous),
    '',
    'What was wrong with it:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Write the guide again, fixing every point above. Cite only the source ids you were given,',
    'and quote only words that are in the brief.',
  ].join('\n'),
})

/**
 * The brief and the evidence in — the guide out, guarded once, corrected once, refused after
 * that. The guide the guard returns is the guide that ships, not a second conversion of the
 * same output: the guard drops a sentence whose quote is not in the brief and a "reported"
 * sentence nobody reported, and handing the reader `toGuide(out)` instead would hand them the
 * sentences it just withdrew. What goes back to the model in the correction is the other one —
 * its own output, unrepaired, because that is the thing it has to fix.
 */
export async function runTakeHomeSynthesize(
  input: TakeHomeSynthesizePromptInput,
  generate?: GenerateCall,
): Promise<SynthesizedGuide> {
  const { system, parts } = buildTakeHomeSynthesizePrompt(input)
  const ids = new Set(input.sourceIds)
  const opts = { system, schema: TakeHomeSynthesizeOutSchema, thinkingBudget: THINKING_BUDGET }
  // `input.brief` is the haystack, and it is the same string the prompt laid out under "The
  // brief, in its own words:". One field rather than two: a second copy of the brief carried
  // beside the first is a second chance for them to differ, and a guide checked against a text
  // the model was never shown would fail every quote for a reason nobody could see.
  const brief = input.brief

  const first = await generateStructured({ ...opts, parts }, generate)
  const firstPass = guardTakeHomeGuide(toGuide(first), ids, brief)
  if (firstPass.problems.length === 0) return firstPass.guide

  const second = await generateStructured(
    { ...opts, parts: [...parts, correction(first, firstPass.problems)] },
    generate,
  )
  const secondPass = guardTakeHomeGuide(toGuide(second), ids, brief)
  if (secondPass.problems.length === 0) return secondPass.guide

  throw new FlowOutputError(
    `takeHomeSynthesize: the guide failed its guard twice: ${secondPass.problems.join('; ')}`,
  )
}
