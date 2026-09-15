import { FlowOutputError, generateStructured, type GenerateCall, type Part, type ThinkingLevel } from '@/ai/genkit'
import { buildClarifyDraftPrompt, type ClarifyDraftInput } from '@/ai/prompts/clarifyDraft'
import { ClarifyDraftOutSchema, type ClarifyDraftOut } from '@/ai/schemas'

/**
 * The model has to read what the role screens for out of the posting, then find where the
 * candidate's facts leave the answer open. It is at MEDIUM for the letter path, where no thinking
 * pre-ticked a forbidden UK/visa promise in 3 of 4 rounds and MEDIUM in 0 of 4. On the form path
 * it is a hedge: the little evidence there (n = 2) went against MEDIUM (docs/notes/deps.md,
 * "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

/**
 * What the schema cannot see — both checks are relationships between fields, not shapes.
 *
 * `recommended` must name one of that question's option values: a recommendation the UI cannot
 * map onto any real option is a default that silently does nothing.
 *
 * Ids must be unique within the round. The draft route keys stored answers back by id
 * (`mergeClarify`), so two questions sharing an id collide there — one answer silently
 * overwriting or dropping the other. The schema fixes each id's SHAPE (`c<n>`) but cannot see
 * that two of them are the same.
 *
 * Each problem is phrased as a clause that works twice: appended to the prompt it tells the
 * model exactly what to fix, and joined into the error it tells the person what went wrong.
 */
function problemsWith(out: ClarifyDraftOut): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const q of out.questions) {
    if (seen.has(q.id)) {
      problems.push(`question id ${q.id} appears more than once — ids must be unique within a round`)
    }
    seen.add(q.id)
    const values = new Set(q.options.map((o) => o.value))
    if (!values.has(q.recommended)) {
      const shown = [...values].map((v) => JSON.stringify(v)).join(', ')
      problems.push(
        `question ${q.id} recommends ${JSON.stringify(q.recommended)}, which is not one of its options (${shown})`,
      )
    }
  }
  return [...new Set(problems)]
}

/**
 * The correction, carrying the rejected round back with it: without it the model is asked to
 * repair questions it cannot see. Phrased as answerDraft's correction is, and closing on the
 * whole structured output so a retry cannot pass by returning less.
 */
const correction = (previous: ClarifyDraftOut, problems: string[]): Part => ({
  text: [
    'Your previous questions were rejected.',
    '',
    'What you asked:',
    ...previous.questions.map(
      (q) => `- ${q.id}: recommended ${JSON.stringify(q.recommended)} of [${q.options.map((o) => JSON.stringify(o.value)).join(', ')}]`,
    ),
    '',
    'Why they were rejected:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Ask again with every one of those fixed. Return the full structured output — each',
    'question with its options and a recommended option that is one of them.',
  ].join('\n'),
})

/**
 * One question in, up to four positioning questions out — or none, when the facts already
 * settle the answer. The model gets exactly one correction, carrying the specifics; still
 * wrong after that is a real failure, surfaced to the person as a FlowOutputError.
 */
export async function runClarifyDraft(
  input: ClarifyDraftInput,
  generate?: GenerateCall,
): Promise<ClarifyDraftOut> {
  const { system, parts } = buildClarifyDraftPrompt(input)
  const ask = (prompt: Part[]) =>
    generateStructured(
      { parts: prompt, system, schema: ClarifyDraftOutSchema, thinkingLevel: THINKING_LEVEL },
      generate,
    )

  const first = await ask(parts)
  const problems = problemsWith(first)
  if (problems.length === 0) return first

  const second = await ask([...parts, correction(first, problems)])
  const remaining = problemsWith(second)
  if (remaining.length === 0) return second

  throw new FlowOutputError(
    `The clarifying questions were still wrong after one correction — ${remaining.join('; ')}`,
  )
}
