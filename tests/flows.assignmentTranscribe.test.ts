import { describe, it, expect, vi } from 'vitest'
import { runAssignmentTranscribe } from '@/ai/flows/assignmentTranscribe'
import { FlowOutputError, type GenerateCall } from '@/ai/genkit'
import { TRANSCRIBE_SYSTEM } from '@/ai/prompts/assignmentTranscribe'
import { AssignmentTranscribeOutSchema } from '@/ai/schemas'

// The Genkit call is injected, so this exercises the real prompt, the real schema and the real
// retry — everything except the network.
//
// A transcription is the one model call in this feature allowed to be dull: it copies a
// document out of a PDF and does nothing else. What is worth pinning is that it is told to
// copy (the system text is the only place that is said), that it is handed the file rather
// than a description of it, that it thinks at LOW about it, and that a PDF which
// came back empty is a failure with a reason rather than a brief made of nothing.

// The spec's system text, reproduced so that a well-meaning paraphrase of the prompt is a test
// failure rather than a quiet change of contract.
const VERBATIM = `Transcribe this document into plain text. Keep every sentence, list item and heading in
order; keep numbers, dates and names exactly; drop only page furniture (headers, footers,
page numbers). Add nothing, summarise nothing, translate nothing. Output the text alone.`

const pdfBase64 = 'JVBERi0xLjQKJcOkw7zDtsOfCg=='

interface SentRequest {
  system?: string
  prompt: unknown[]
  output: { schema: unknown }
  config: { temperature: number; thinkingConfig: { thinkingLevel: string } }
}

const returning = (text: string) => vi.fn<GenerateCall>(() => Promise.resolve({ output: { text } }))

describe('runAssignmentTranscribe', () => {
  it('carries the spec system text verbatim', () => {
    expect(TRANSCRIBE_SYSTEM).toBe(VERBATIM)
  })

  it('sends the PDF as a media part, and sends nothing else', async () => {
    const generate = returning('The assignment.')
    await runAssignmentTranscribe({ pdfBase64 }, generate)

    const req = generate.mock.calls[0][0] as unknown as SentRequest
    expect(req.prompt).toEqual([
      {
        media: {
          url: `data:application/pdf;base64,${pdfBase64}`,
          contentType: 'application/pdf',
        },
      },
    ])
    expect(req.system).toBe(TRANSCRIBE_SYSTEM)
  })

  it('thinks at LOW, at temperature 0, against the transcript schema', async () => {
    const generate = returning('The assignment.')
    await runAssignmentTranscribe({ pdfBase64 }, generate)

    const req = generate.mock.calls[0][0] as unknown as SentRequest
    expect(req.config).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: 'LOW' } })
    expect(req.output).toEqual({ schema: AssignmentTranscribeOutSchema })
  })

  it('returns the transcription trimmed', async () => {
    const generate = returning('\n\n  Build a ledger service.  \n')
    await expect(runAssignmentTranscribe({ pdfBase64 }, generate)).resolves.toEqual({
      text: 'Build a ledger service.',
    })
  })

  it('hands back a short transcription — how long is long enough is the route’s rule', async () => {
    // A two-line PDF is a real answer about a real file. Refusing it here would refuse it in
    // different words from a two-line paste, and the route's one length rule exists so that
    // the three ways in are refused identically.
    const generate = returning('Ship a CSV parser.')
    await expect(runAssignmentTranscribe({ pdfBase64 }, generate)).resolves.toEqual({
      text: 'Ship a CSV parser.',
    })
  })

  it('refuses an empty transcription rather than storing a brief made of nothing', async () => {
    const generate = returning('')
    await expect(runAssignmentTranscribe({ pdfBase64 }, generate)).rejects.toThrow(
      new FlowOutputError('the PDF transcribed to nothing — paste the brief’s text instead'),
    )
    // The schema was satisfied, so the retry never fired: this is our refusal, not Genkit's.
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('treats a page of whitespace as empty too — a scanned PDF reads as one', async () => {
    const generate = returning('   \n\t\n  ')
    await expect(runAssignmentTranscribe({ pdfBase64 }, generate)).rejects.toBeInstanceOf(
      FlowOutputError,
    )
  })
})
