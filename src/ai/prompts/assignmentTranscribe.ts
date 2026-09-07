/**
 * The assignmentTranscribe prompt: a take-home brief as a PDF in, the instructions that turn it
 * into plain text out. The system text below is the design spec's, word for word — the whole
 * honesty of a transcription is in the sentence that forbids summarising it, so it is quoted
 * rather than rewritten, and `tests/flows.assignmentTranscribe.test.ts` holds a copy that fails
 * the build if this one drifts.
 *
 * It is exported, unlike profileIngest's, because the guide's caveats and the round page both
 * lean on what it promises: the brief on the record is the model's reading of the file, and
 * every quote drawn from it later is checked against this text and not against the PDF.
 */
import type { Part } from '@/ai/genkit'

export const TRANSCRIBE_SYSTEM = `Transcribe this document into plain text. Keep every sentence, list item and heading in
order; keep numbers, dates and names exactly; drop only page furniture (headers, footers,
page numbers). Add nothing, summarise nothing, translate nothing. Output the text alone.`

/**
 * One media part and no text part at all. The document is the whole prompt: anything we wrote
 * beside it — the company, the round, what we hope it says — would be context the model could
 * fill a gap with, and a filled gap in a transcription is indistinguishable from the file.
 * Inlined as a base64 data URL exactly as `profileIngest` sends a resume.
 */
export function buildAssignmentTranscribePrompt(input: { pdfBase64: string }): {
  system: string
  parts: Part[]
} {
  return {
    system: TRANSCRIBE_SYSTEM,
    parts: [
      {
        media: {
          url: `data:application/pdf;base64,${input.pdfBase64}`,
          contentType: 'application/pdf',
        },
      },
    ],
  }
}
