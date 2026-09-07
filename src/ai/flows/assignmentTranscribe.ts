import { FlowOutputError, generateStructured, type GenerateCall } from '@/ai/genkit'
import { buildAssignmentTranscribePrompt } from '@/ai/prompts/assignmentTranscribe'
import { AssignmentTranscribeOutSchema } from '@/ai/schemas'

/**
 * Nothing. Every other flow in this product weighs something — which gate is unmet, which stage
 * a round is, what a write-up is really saying. This one copies a document out in order, and
 * thinking tokens spent on a copy buy a paraphrase.
 */
const THINKING_BUDGET = 0

/** A take-home brief as a PDF in, its text out — trimmed, and never empty. */
export async function runAssignmentTranscribe(
  input: { pdfBase64: string },
  generate?: GenerateCall,
): Promise<{ text: string }> {
  const { system, parts } = buildAssignmentTranscribePrompt(input)
  const out = await generateStructured(
    { parts, system, schema: AssignmentTranscribeOutSchema, thinkingBudget: THINKING_BUDGET },
    generate,
  )
  const text = out.text.trim()
  // A PDF that transcribes to nothing is a scan, an image-only export or a file the model could
  // not open — and the one thing that must not follow is a stored brief with no words in it,
  // which every later quote would then be checked against and every later quote would fail.
  // Thrown rather than returned empty: the message is what the panel shows, and it says the one
  // thing that works. A SHORT transcription is not this — that falls to the route's length rule
  // like any other text, in the same words as a short paste.
  if (text === '') {
    throw new FlowOutputError('the PDF transcribed to nothing — paste the brief’s text instead')
  }
  return { text }
}
