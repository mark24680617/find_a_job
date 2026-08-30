import { FlowOutputError, generateStructured, type GenerateCall, type Part } from '@/ai/genkit'
import { buildReconcileFactsPrompt, type ReconcileFactsInput } from '@/ai/prompts/reconcileFacts'
import { ReconcileOutSchema, type ReconcileOut } from '@/ai/schemas'

/**
 * Reasoning-heavy for the same reason clarifyDraft is: the model has to hold two sets of claims
 * side by side and decide, claim by claim, whether they are the same thing said twice. 1024 is
 * the budget that leaves room for that comparison; the extraction it reads was itself worth 512.
 */
const THINKING_BUDGET = 1024

/**
 * What the schema cannot see — the same two relationships clarifyDraft checks, for the same two
 * reasons, because these are the same questions rendered by the same cards.
 *
 * `recommended` must name one of that question's option values: a recommendation the UI cannot
 * map onto a real option is a default that silently does nothing.
 *
 * Ids must be unique within the round. The panel keys a card's live selection by id, so two
 * questions sharing one collide there — one answer overwriting the other on its way back into
 * the next reconcile. The schema fixes each id's SHAPE (`c<n>`) but cannot see that two are the
 * same.
 *
 * What is NOT checked here: that an update's id names a real fact. The bank this changeset will
 * be applied to is read again at apply time and may have moved on since, so the only check worth
 * making is the one made against the live bank — `POST /api/profile/apply` makes it.
 *
 * Each problem is phrased as a clause that works twice: appended to the prompt it tells the
 * model exactly what to fix, and joined into the error it tells the person what went wrong.
 */
function problemsWith(out: ReconcileOut): string[] {
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
 * The correction, carrying the rejected questions back with it: without it the model is asked to
 * repair questions it cannot see. It closes on the whole structured output, not just the
 * questions, so a retry cannot pass by returning a round of questions and dropping the changeset.
 */
const correction = (previous: ReconcileOut, problems: string[]): Part => ({
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
    'Answer again with every one of those fixed. Return the full structured output — the whole',
    'changeset as well as the questions, each question with a recommended option that is one of',
    'its own options.',
  ].join('\n'),
})

/**
 * One extraction against one bank, a changeset out — plus, when a match genuinely cannot be
 * settled from the documents, up to four questions for the candidate. The model gets exactly one
 * correction, carrying the specifics; still wrong after that is a real failure, surfaced to the
 * person as a FlowOutputError.
 *
 * Nothing here writes. The changeset is a proposal until the candidate accepts it.
 */
export async function runReconcileFacts(
  input: ReconcileFactsInput,
  generate?: GenerateCall,
): Promise<ReconcileOut> {
  const { system, parts } = buildReconcileFactsPrompt(input)
  const ask = (prompt: Part[]) =>
    generateStructured(
      { parts: prompt, system, schema: ReconcileOutSchema, thinkingBudget: THINKING_BUDGET },
      generate,
    )

  const first = await ask(parts)
  const problems = problemsWith(first)
  if (problems.length === 0) return first

  const second = await ask([...parts, correction(first, problems)])
  const remaining = problemsWith(second)
  if (remaining.length === 0) return second

  throw new FlowOutputError(
    `The reconcile questions were still wrong after one correction — ${remaining.join('; ')}`,
  )
}
