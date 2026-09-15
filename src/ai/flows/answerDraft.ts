import { FlowOutputError, generateStructured, type GenerateCall, type Part, type ThinkingLevel } from '@/ai/genkit'
import { buildAnswerDraftPrompt, statedLimit, type AnswerDraftInput } from '@/ai/prompts/answerDraft'
import { AnswerDraftOutSchema, type AnswerDraftOut } from '@/ai/schemas'
import { countUnits } from '@/lib/countText'
import { letterProblems } from '@/lib/letter/guard'

/**
 * One of the flows that has to reason, and the only one whose output a human signs their name
 * to: it has to pick which story answers THIS question, keep every claim tied to a fact, count
 * its own words, and decide what it cannot know. It is at MEDIUM because, where the facts left a
 * hole, no thinking wrote a story around it in about 6–7 of 9 samples and MEDIUM in 0 of 6
 * (docs/notes/deps.md, "Thinking levels per flow — evaluated 2026-09-14").
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

/**
 * A cover letter is three times the length of a form answer, it has a shape to hold across three
 * or four blocks, and it has to choose whether there is anything to bridge at all — none of which
 * is reasoning the letter's rules can do for it. It is at MEDIUM because with no thinking 8 of 8
 * replay letters invented claims about the candidate, and at MEDIUM none did. It keeps its own
 * constant because a MEDIUM-vs-HIGH letter test settled it separately: HIGH did not
 * beat MEDIUM consistently, and it attached supported facts to an unsupported employer or stack
 * more often, at roughly twice the wait (docs/notes/deps.md, "Thinking levels per flow — evaluated
 * 2026-09-14").
 */
const LETTER_THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

/**
 * What the schema cannot see. Genkit checks the SHAPE of the output — a citation is a string
 * pair, a factId looks like `f<n>` — and shape is where its knowledge ends. It cannot know
 * that `f9` names no fact in this profile, that a claimSpan appears nowhere in the answer, or
 * that ninety words is ten too many. Those are the product's invariant, so they are enforced
 * in code, not asked for in a prompt: a citation the reader cannot follow is worse than none,
 * because it reads as verified.
 *
 * Each problem is phrased as a clause that works twice over: appended to the prompt it tells
 * the model exactly what to fix, and thrown to the UI it tells the person what went wrong.
 */
function problemsWith(out: AnswerDraftOut, input: AnswerDraftInput): string[] {
  const problems: string[] = []

  const stated = statedLimit(input.question.constraints)
  if (stated) {
    const count = countUnits(out.text, stated.unit)
    if (count > stated.limit) {
      problems.push(
        `over the limit: ${count} ${stated.unit} against a limit of ${stated.limit} ${stated.unit}`,
      )
    }
  }

  const known = new Set(input.facts.map((f) => f.id))
  for (const citation of out.citations) {
    if (citation.claimSpan.trim() === '') {
      // Checked before `includes`, which the empty string passes against any text: a
      // citation spanning no words underlines nothing, so the reader never learns it exists.
      problems.push('a citation carries an empty span, which marks nothing in the answer')
    } else if (!out.text.includes(citation.claimSpan)) {
      problems.push(
        `the cited span ${JSON.stringify(citation.claimSpan)} does not appear verbatim in the answer`,
      )
    }
    if (!known.has(citation.factId)) {
      problems.push(`the citation names ${citation.factId}, which is not one of the facts provided`)
    }
  }
  // A letter is checked for the two things a reader sees before they read a word — who it is
  // addressed to, who signed it — and for the ceiling that keeps it to one page. The letterhead
  // is what those are judged against, and a letter drafted before one was ever typed is judged
  // against a blank one: "Dear Hiring Manager," and no signature is the correct letter then.
  if (input.question.kind === 'cover-letter') {
    problems.push(...letterProblems(out.text, input.letter ?? { name: '', recipient: '' }))
  }

  // Two citations onto the same missing fact are one problem, said once — the list is read
  // by a model as instructions and by a person as an explanation, and both suffer repetition.
  return [...new Set(problems)]
}

/**
 * The correction, which has to carry the rejected attempt back with it. Without it the model
 * is asked to repair text it cannot see: nothing in the original prompt says what it wrote,
 * and "the cited span X does not appear verbatim" is unactionable when X's near-miss is the
 * one thing missing from the conversation. The tokens are worth it — this is the round that
 * decides between a good draft and a 422.
 *
 * The closing line asks for the whole structured output, not "only the answer". This is a
 * structured-output call, and "the answer" reads as the text field alone: a retry that came
 * back with `citations: []` would pass every check by having nothing left to check, and ship
 * an uncited draft — the invariant failing through its own correction. Phrased as
 * `generateStructured`'s own retry phrases it.
 */
const correction = (previous: AnswerDraftOut, problems: string[]): Part => ({
  text: [
    'Your previous answer was rejected.',
    '',
    'What you wrote:',
    previous.text,
    '',
    'The citations you attached:',
    ...(previous.citations.length === 0
      ? ['(none)']
      : previous.citations.map((c) => `- ${c.factId} -> ${JSON.stringify(c.claimSpan)}`)),
    '',
    'Why it was rejected:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Write the whole answer again with every one of those fixed. Return the full structured',
    'output — the answer, its citations, and anything you must ask.',
  ].join('\n'),
})

/**
 * One question in, a cited draft out — or an error, never a draft that breaks the invariant.
 *
 * The model gets exactly one correction, carrying the specifics rather than a re-run of the
 * same request: told "you wrote 118 words, the limit is 100" it usually lands it, and a
 * second identical ask would only buy the same mistake at the same price. Still wrong after
 * that is a real failure — surfaced verbatim to the person, whose call it then is.
 */
export async function runAnswerDraft(
  input: AnswerDraftInput,
  generate?: GenerateCall,
): Promise<AnswerDraftOut> {
  const { system, parts } = buildAnswerDraftPrompt(input)
  const ask = (prompt: Part[]) =>
    generateStructured(
      {
        parts: prompt,
        system,
        schema: AnswerDraftOutSchema,
        thinkingLevel:
          input.question.kind === 'cover-letter' ? LETTER_THINKING_LEVEL : THINKING_LEVEL,
      },
      generate,
    )

  const first = await ask(parts)
  const problems = problemsWith(first, input)
  if (problems.length === 0) return first

  const second = await ask([...parts, correction(first, problems)])
  const remaining = problemsWith(second, input)
  if (remaining.length === 0) return second

  throw new FlowOutputError(`The draft was still wrong after one correction — ${remaining.join('; ')}`)
}
