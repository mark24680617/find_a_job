import { FlowOutputError, generateStructured, type GenerateCall, type ThinkingLevel } from '@/ai/genkit'
import { buildAssignmentTranscribePrompt } from '@/ai/prompts/assignmentTranscribe'
import { AssignmentTranscribeOutSchema } from '@/ai/schemas'

/**
 * This one copies a document out in order. It is set to LOW because the 2026-09-14 evaluation
 * found no measurable gain from thinking here
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'LOW'

/** A take-home brief as a PDF in, its text out — trimmed, and never empty. */
export async function runAssignmentTranscribe(
  input: { pdfBase64: string },
  generate?: GenerateCall,
): Promise<{ text: string }> {
  const { system, parts } = buildAssignmentTranscribePrompt(input)
  const out = await generateStructured(
    { parts, system, schema: AssignmentTranscribeOutSchema, thinkingLevel: THINKING_LEVEL },
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
