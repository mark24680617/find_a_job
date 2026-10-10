import { FlowOutputError, generateStructured, type GenerateCall, type Part, type ThinkingLevel } from '@/ai/genkit'
import { BANNED_PHRASES, bannedIn, buildBulletRewritePrompt } from '@/ai/prompts/bulletRewrite'   // bannedIn: R33
import { BulletRewriteOutSchema, type BulletRewriteOut } from '@/ai/schemas'
import type { AnsweredAsk, Fact } from '@/lib/types'

/**
 * MEDIUM, on the same deps.md evidence as the letter: with no thinking, 8 of 8 replay letters
 * invented claims about the candidate, and at MEDIUM none did ("Thinking levels per flow —
 * evaluated 2026-09-14"). Inventing a claim about the candidate is exactly the failure a
 * rewritten bullet is exposed to, and it is the one the Y rule below cannot always catch: a
 * fabricated action carries no digit.
 */
const THINKING_LEVEL: ThinkingLevel = 'MEDIUM'

export interface BulletRewriteInput {
  resumeText: string
  bullets: { id: string; text: string; entryLine: string }[]   // failing bullets only
  facts: Fact[]
  voiceRules: string[]
  asks: AnsweredAsk[]
  today: string
}

/**
 * A number as this flow reads one: a digit and whatever digits, commas and full stops follow it.
 * The trailing separators come off afterwards, because the pattern deliberately swallows a
 * sentence-final full stop and 12,000 is not a different number for standing at the end of a
 * sentence. Nothing else is normalised: 12000 and 12,000 are different strings and the rule is
 * that the model writes the number the source wrote.
 *
 * (amended 2026-09-24, R43) Exported: Task E5b's fourth guard re-runs this exact rule from
 * outside the flow, so the smoke and the flow read a number the same way.
 *
 * The trailing run is looked for only where a run of separators starts: tried from every
 * separator of a run that does not end the number, `[.,]+$` read the rest of the run again each
 * time, and a "number" 40,000 separators long in a resume or a cited fact took 5 s (security
 * review, 2026-10-08).
 */
const DIGITS = /\d[\d,.]*/g
export function digitTokens(text: string): string[] {
  return [...text.matchAll(DIGITS)].map((m) => m[0].replace(/(?<![.,])[.,]+$/, ''))
}

// (amended 2026-09-24, R33) `bannedIn` and `escapeRe` moved to `src/ai/prompts/bulletRewrite.ts`
// (Task E1), beside the list they match against, and are imported above.

/**
 * What the schema cannot see. Genkit checks the SHAPE — a bullet id looks like `b7`, a citation
 * is three strings — and shape is where its knowledge ends. It cannot know that `f9` names no
 * fact in this bank, that a claimSpan appears nowhere in the sentence it claims to mark, or
 * that 18,000 came from nowhere at all.
 *
 * Each problem names a bullet id and a position and NEVER a span of the resume, of the bank or
 * of the model's own text: these strings become the `FlowOutputError` message, and anything
 * escaping a handler is logged by the platform with its message and its stack (spec §8). That
 * is the one way this flow's problem strings differ from `answerDraft`'s, which quote freely.
 */
function problemsWith(out: BulletRewriteOut, input: BulletRewriteInput): string[] {
  const problems: string[] = []
  const known = new Set(input.facts.map((f) => f.id))
  const byId = new Map(input.bullets.map((b) => [b.id, b]))
  const answers = input.asks.map((a) => a.answer).join('\n')

  // One proposal per bullet handed over. Without this a model that returned nothing would pass
  // every check below by having nothing to check, and the route would answer 200 with an empty
  // proposal — the invariant failing through its own success path.
  const returned = out.rewrites.map((r) => r.bulletId)
  for (const b of input.bullets) {
    const n = returned.filter((id) => id === b.id).length
    if (n !== 1) problems.push(`${b.id} must appear exactly once in the rewrites, and appeared ${n} times`)
  }

  for (const [i, r] of out.rewrites.entries()) {
    const bullet = byId.get(r.bulletId)
    if (!bullet) {
      problems.push(`rewrite ${i + 1} names ${r.bulletId}, which is not one of the bullets to rewrite`)
      continue
    }
    // A skip is not a rewrite, so the rewrite guards have nothing to judge — but a skip that
    // changed the line is a rewrite wearing a skip's clothes, and would reach the page with no
    // citation behind it.
    if (r.skipped) {
      if (r.text !== bullet.text) {
        problems.push(`${r.bulletId} is marked skipped but its text was changed — a skip returns the bullet unchanged`)
      }
      continue
    }

    const cited: string[] = []
    for (const [j, c] of r.citations.entries()) {
      const where = `${r.bulletId} citation ${j + 1}`
      if (c.claimSpan.trim() === '') {
        // Checked before `includes`, which the empty string passes against any text: a citation
        // spanning no words underlines nothing, so the reader never learns it exists.
        problems.push(`${where} carries an empty span, which marks nothing in the bullet`)
      } else if (!r.text.includes(c.claimSpan)) {
        problems.push(`${where} does not appear verbatim in the rewritten bullet`)
      }
      if (c.factId === null && c.resumeSpan === null) {
        problems.push(`${where} carries neither a factId nor a resumeSpan`)
      }
      if (c.factId !== null) {
        if (known.has(c.factId)) cited.push(c.factId)
        else problems.push(`${where} names a fact that is not one of the facts provided`)
      }
      if (c.resumeSpan !== null && !input.resumeText.includes(c.resumeSpan)) {
        problems.push(`${where} cites a resume span that does not appear verbatim in the stored resume`)
      }
    }

    // THE Y RULE. Three sources and no fourth: the stored resume, the facts THIS bullet cites,
    // and what the candidate answered when asked. Compared as numbers rather than as substrings,
    // because "840ms to 210ms" contains "40" and would otherwise license a figure nobody wrote.
    const sources = [
      input.resumeText,
      ...input.facts.filter((f) => cited.includes(f.id)).map((f) => `${f.claim}\n${f.sourceSnippet}`),
      answers,
    ].join('\n')
    const sourceNumbers = new Set(digitTokens(sources))
    for (const token of digitTokens(r.text)) {
      if (!sourceNumbers.has(token)) {
        problems.push(
          `${r.bulletId} states a number that is in neither the resume, a fact it cites, nor an answer the candidate gave`,
        )
      }
    }

    for (const { phrase } of BANNED_PHRASES) {
      if (bannedIn(r.text, phrase)) {
        problems.push(`${r.bulletId} uses "${phrase}", which this product does not write`)
      }
    }
  }

  // Two citations onto the same missing fact are one problem, said once — the list is read by a
  // model as instructions and by a person as an explanation, and both suffer repetition. It is
  // also what collapses a bullet that states the same unsourced number twice.
  return [...new Set(problems)]
}

/**
 * The correction, carrying the rejected attempt back with it. Without it the model is asked to
 * repair text it cannot see. This is the one place the rejected text travels, and it travels
 * into the prompt rather than into an error: the prompt is not logged.
 */
const correction = (previous: BulletRewriteOut, problems: string[]): Part => ({
  text: [
    'Your previous rewrites were rejected.',
    '',
    'What you wrote:',
    ...(previous.rewrites.length === 0
      ? ['(nothing)']
      : previous.rewrites.map((r) => `- ${r.bulletId}: ${r.text}`)),
    '',
    'Why they were rejected:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Write every rewrite again with each of those fixed. Return the full structured output —',
    'the bullets, their citations, anything you must ask, and any skip with its reason.',
  ].join('\n'),
})

/**
 * The failing bullets in, a proposal out — or an error, never a proposal that breaks the
 * invariant. One correction, carrying the specifics; still wrong after that is a real failure,
 * surfaced to the person, whose document it is.
 */
export async function runBulletRewrite(
  input: BulletRewriteInput,
  generate?: GenerateCall,
): Promise<BulletRewriteOut> {
  const { system, parts } = buildBulletRewritePrompt(input)
  const ask = (prompt: Part[]) =>
    generateStructured(
      { parts: prompt, system, schema: BulletRewriteOutSchema, thinkingLevel: THINKING_LEVEL },
      generate,
    )

  const first = await ask(parts)
  const problems = problemsWith(first, input)
  if (problems.length === 0) return first

  const second = await ask([...parts, correction(first, problems)])
  const remaining = problemsWith(second, input)
  if (remaining.length === 0) return second

  throw new FlowOutputError(`The rewrite was still wrong after one correction — ${remaining.join('; ')}`)
}
